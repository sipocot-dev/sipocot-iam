import { describe, expect, it } from 'vitest';
import { asSessionId, asUserId } from '@/shared/domain';
import {
  DEFAULT_SESSION_POLICY,
  DisplayName,
  Email,
  PhoneNumber,
  PlainPassword,
  Session,
} from '@/modules/identity/domain';
import { makeUser } from '../../support/fakes';

describe('Email', () => {
  it('normalises case and whitespace', () => {
    const r = Email.create('  Juan.DelaCruz@Sipocot.GOV.ph ');
    expect(r.ok && r.value).toBe('juan.delacruz@sipocot.gov.ph');
  });

  it.each(['', 'no-at-sign', 'a@b', 'a b@c.ph', '@sipocot.ph', `${'x'.repeat(250)}@a.ph`])('rejects %j', (raw) => {
    const r = Email.create(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('identity.invalid_email');
  });
});

describe('PlainPassword policy', () => {
  it('accepts a long passphrase', () => {
    expect(PlainPassword.create('correct horse battery staple').ok).toBe(true);
  });

  it.each([
    ['too short', 'short1!'],
    ['too few distinct chars', 'aaaaaaaaaaaaaaab'],
    ['too long', 'x'.repeat(129) + 'abcd'],
  ])('rejects %s', (_label, pw) => {
    expect(PlainPassword.create(pw).ok).toBe(false);
  });

  it('rejects passwords containing the email local part', () => {
    const r = PlainPassword.create('my-juandelacruz-password', { email: 'juandelacruz@sipocot.ph' });
    expect(r.ok).toBe(false);
  });

  it('counts grapheme clusters, not UTF-16 code units', () => {
    // 11 family emoji (each is several code points) is still only 11 characters.
    expect(PlainPassword.create('👨‍👩‍👧'.repeat(11)).ok).toBe(false);
  });
});

describe('Profile value objects', () => {
  it('collapses whitespace in display names and rejects control characters', () => {
    const ok = DisplayName.create('  Maria   Clara ');
    expect(ok.ok && ok.value).toBe('Maria Clara');
    expect(DisplayName.create('evil\u0000name').ok).toBe(false);
    expect(DisplayName.create('   ').ok).toBe(false);
  });

  it('normalises Philippine mobile numbers to E.164', () => {
    const r = PhoneNumber.create('0917 123 4567');
    expect(r.ok && r.value).toBe('+639171234567');
    expect(PhoneNumber.create('+1 (415) 555-0100').ok).toBe(true);
    expect(PhoneNumber.create('12345').ok).toBe(false);
  });
});

describe('User aggregate', () => {
  const now = new Date('2026-02-01T00:00:00Z');

  it('raises user_registered on registration with member role by default', () => {
    const user = makeUser();
    expect(user.roles).toEqual(new Set(['member']));
    expect(user.permissions.has('files:write')).toBe(true);
    expect(user.permissions.has('users:read')).toBe(false);
  });

  it('locks the account after the configured number of failures and emits events', () => {
    const user = makeUser();
    const policy = { maxFailedAttempts: 3, lockDurationMs: 60_000 };
    user.recordFailedLogin(now, policy);
    user.recordFailedLogin(now, policy);
    expect(user.isLocked(now)).toBe(false);
    user.recordFailedLogin(now, policy);
    expect(user.isLocked(now)).toBe(true);
    expect(user.authenticationBlock(now)).toBe('locked');
    expect(user.isLocked(new Date(now.getTime() + 60_001))).toBe(false);
    expect(user.pullEvents().map((e) => e.type)).toContain('identity.account_locked');
  });

  it('resets failure counters on successful login', () => {
    const user = makeUser();
    user.recordFailedLogin(now);
    user.recordSuccessfulLogin('s1', now);
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lastLoginAt).toEqual(now);
  });

  it('refuses to remove the last role', () => {
    const user = makeUser({ roles: ['member'] });
    const r = user.revokeRole('member', now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('identity.last_role');
  });

  it('assign/revoke role is idempotent and audited', () => {
    const user = makeUser();
    user.assignRole('staff', now);
    user.assignRole('staff', now);
    expect(user.pullEvents().filter((e) => e.type === 'identity.role_assigned')).toHaveLength(1);
    expect(user.revokeRole('staff', now).ok).toBe(true);
    expect(user.roles).toEqual(new Set(['member']));
  });

  it('disabled users are blocked; enabling clears lockout', () => {
    const user = makeUser();
    user.recordFailedLogin(now, { maxFailedAttempts: 1, lockDurationMs: 60_000 });
    user.disable(now);
    expect(user.authenticationBlock(now)).toBe('disabled');
    user.enable(now);
    expect(user.authenticationBlock(now)).toBeNull();
  });
});

describe('Session', () => {
  const policy = { absoluteTtlMs: 10_000, idleTtlMs: 3_000, touchIntervalMs: 1_000 };
  const t0 = new Date('2026-03-01T00:00:00Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);
  const start = () =>
    Session.start({
      id: asSessionId('s'),
      userId: asUserId('u'),
      tokenHash: 'h',
      ip: null,
      userAgent: 'x'.repeat(600),
      now: t0,
      policy,
    });

  it('expires after idle timeout unless touched', () => {
    const s = start();
    expect(s.isActive(at(2_999))).toBe(true);
    expect(s.isActive(at(3_000))).toBe(false);
  });

  it('slides idle expiry but never beyond absolute expiry', () => {
    const s = start();
    for (let t = 2_000; t <= 9_000; t += 2_000) expect(s.touch(at(t), policy)).toBe(true);
    expect(s.idleExpiresAt.getTime()).toBe(at(10_000).getTime());
    expect(s.isActive(at(9_999))).toBe(true);
    expect(s.isActive(at(10_000))).toBe(false);
  });

  it('skips persistence when touched within the touch interval', () => {
    const s = start();
    expect(s.touch(at(500), policy)).toBe(false);
  });

  it('is inactive once revoked and truncates long user agents', () => {
    const s = start();
    s.revoke(at(1));
    expect(s.isActive(at(2))).toBe(false);
    expect(s.userAgent).toHaveLength(512);
  });

  it('default policy keeps idle shorter than absolute', () => {
    expect(DEFAULT_SESSION_POLICY.idleTtlMs).toBeLessThan(DEFAULT_SESSION_POLICY.absoluteTtlMs);
  });
});
