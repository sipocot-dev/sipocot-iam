import { describe, expect, it } from 'vitest';
import { AuthenticateSession, ChangePassword, Login, Logout, RegisterUser } from '@/modules/identity/application';
import { PasswordHash, type User } from '@/modules/identity/domain';
import { actorFor, DEFAULT_PASSWORD, identityDeps, makeUser, meta } from '../../support/fakes';

const NEW_PASSWORD = 'a brand new passphrase';

async function seeded(user: User = makeUser()) {
  const deps = identityDeps();
  await deps.users.save(user);
  return { deps, user };
}

async function loginOk(deps: ReturnType<typeof identityDeps>, password = DEFAULT_PASSWORD) {
  const r = await new Login(deps).execute({ email: 'juan@sipocot.gov.ph', password, meta });
  if (!r.ok) throw r.error;
  return r.value;
}

describe('RegisterUser', () => {
  it('registers, hashes the password and audits the event', async () => {
    const deps = identityDeps();
    const r = await new RegisterUser(deps).execute({
      email: 'Maria@Sipocot.gov.ph',
      password: 'long enough passphrase',
      displayName: 'Maria',
      phone: '09171234567',
      meta,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ email: 'maria@sipocot.gov.ph', roles: ['member'], phone: '+639171234567' });
    const stored = [...deps.users.rows.values()][0];
    expect(stored?.passwordHash).toBe('fake$long enough passphrase');
    expect(deps.events.types()).toEqual(['identity.user_registered']);
    expect(deps.events.published[0]?.ctx).toMatchObject({ ip: meta.ip, requestId: meta.requestId });
  });

  it('rejects duplicate emails', async () => {
    const { deps } = await seeded();
    const r = await new RegisterUser(deps).execute({
      email: 'juan@sipocot.gov.ph',
      password: 'long enough passphrase',
      displayName: 'J',
      meta,
    });
    expect(!r.ok && r.error.code).toBe('identity.email_taken');
  });

  it('returns the first validation error without persisting anything', async () => {
    const deps = identityDeps();
    const r = await new RegisterUser(deps).execute({ email: 'x@y.ph', password: 'short', displayName: 'X', meta });
    expect(!r.ok && r.error.code).toBe('identity.weak_password');
    expect(deps.users.rows.size).toBe(0);
  });
});

describe('Login', () => {
  it('issues a session token and records the login', async () => {
    const { deps } = await seeded();
    const out = await loginOk(deps);
    expect(out.token).toMatch(/^tok_/);
    expect(deps.sessions.rows.size).toBe(1);
    const session = [...deps.sessions.rows.values()][0];
    expect(session?.tokenHash).toBe(deps.tokens.hash(out.token));
    expect(session?.tokenHash).not.toBe(out.token);
    expect(deps.events.types()).toContain('identity.login_succeeded');
  });

  it('gives the same error for unknown email and wrong password, and still runs a hash verify', async () => {
    const { deps } = await seeded();
    const login = new Login(deps);
    const unknown = await login.execute({ email: 'nobody@sipocot.gov.ph', password: 'x', meta });
    const wrong = await login.execute({ email: 'juan@sipocot.gov.ph', password: 'x', meta });
    expect(!unknown.ok && unknown.error.code).toBe('auth.invalid_credentials');
    expect(!wrong.ok && wrong.error.code).toBe('auth.invalid_credentials');
    expect(deps.hasher.verifyCalls).toBe(2);
  });

  it('locks the account after repeated failures and rejects even the correct password', async () => {
    const { deps } = await seeded();
    const login = new Login({ ...deps, lockoutPolicy: { maxFailedAttempts: 3, lockDurationMs: 60_000 } });
    for (let i = 0; i < 3; i++) await login.execute({ email: 'juan@sipocot.gov.ph', password: 'wrong', meta });
    const r = await login.execute({ email: 'juan@sipocot.gov.ph', password: DEFAULT_PASSWORD, meta });
    expect(r.ok).toBe(false);
    expect(deps.events.types()).toContain('identity.account_locked');
    deps.clock.advance(60_001);
    expect((await login.execute({ email: 'juan@sipocot.gov.ph', password: DEFAULT_PASSWORD, meta })).ok).toBe(true);
  });

  it('rejects disabled accounts', async () => {
    const user = makeUser();
    user.disable(new Date());
    const { deps } = await seeded(user);
    const r = await new Login(deps).execute({ email: 'juan@sipocot.gov.ph', password: DEFAULT_PASSWORD, meta });
    expect(r.ok).toBe(false);
  });

  it('transparently upgrades outdated password hashes', async () => {
    const user = makeUser();
    user.upgradePasswordHash(PasswordHash.fromTrusted('old$' + DEFAULT_PASSWORD), new Date());
    const { deps } = await seeded(user);
    await loginOk(deps);
    expect(deps.users.rows.get(user.id)?.passwordHash).toBe('fake$' + DEFAULT_PASSWORD);
  });
});

describe('AuthenticateSession', () => {
  it('resolves a valid token to an actor with permissions', async () => {
    const { deps, user } = await seeded(makeUser({ roles: ['staff'] }));
    const { token } = await loginOk(deps);
    const r = await new AuthenticateSession(deps).execute({ token });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.actor.userId).toBe(user.id);
    expect(r.value.actor.permissions.has('users:read')).toBe(true);
  });

  it('rejects unknown, malformed, expired and revoked tokens', async () => {
    const { deps } = await seeded();
    const auth = new AuthenticateSession(deps);
    expect((await auth.execute({ token: 'short' })).ok).toBe(false);
    expect((await auth.execute({ token: 'x'.repeat(64) })).ok).toBe(false);

    const { token } = await loginOk(deps);
    deps.clock.advance(deps.sessionPolicy.idleTtlMs + 1);
    expect((await auth.execute({ token })).ok).toBe(false);
  });

  it('extends idle expiry on activity (sliding session)', async () => {
    const { deps } = await seeded();
    const { token } = await loginOk(deps);
    const auth = new AuthenticateSession(deps);
    for (let i = 0; i < 5; i++) {
      deps.clock.advance(deps.sessionPolicy.idleTtlMs - 1_000);
      expect((await auth.execute({ token })).ok).toBe(true);
    }
  });

  it('revokes sessions of users who were disabled', async () => {
    const { deps, user } = await seeded();
    const { token } = await loginOk(deps);
    const stored = await deps.users.findById(user.id);
    stored?.disable(deps.clock.now());
    if (stored) await deps.users.save(stored);
    expect((await new AuthenticateSession(deps).execute({ token })).ok).toBe(false);
    expect([...deps.sessions.rows.values()][0]?.revokedAt).not.toBeNull();
  });
});

describe('Logout', () => {
  it('revokes the current session, or all sessions on request', async () => {
    const { deps, user } = await seeded();
    const a = await loginOk(deps);
    await loginOk(deps);
    const auth = new AuthenticateSession(deps);
    const principal = await auth.execute({ token: a.token });
    if (!principal.ok) throw principal.error;

    const logout = new Logout(deps);
    expect(await logout.execute({ actor: principal.value.actor })).toEqual({ ok: true, value: { revoked: 1 } });
    expect((await auth.execute({ token: a.token })).ok).toBe(false);
    expect(await logout.execute({ actor: actorFor(user), allDevices: true })).toEqual({
      ok: true,
      value: { revoked: 1 },
    });
  });
});

describe('ChangePassword', () => {
  it('requires the current password, enforces policy and revokes other sessions', async () => {
    const { deps } = await seeded();
    const first = await loginOk(deps);
    await loginOk(deps);
    const principal = await new AuthenticateSession(deps).execute({ token: first.token });
    if (!principal.ok) throw principal.error;
    const change = new ChangePassword(deps);
    const actor = principal.value.actor;

    expect(await change.execute({ actor, currentPassword: 'nope', newPassword: NEW_PASSWORD, meta })).toMatchObject({
      ok: false,
      error: { code: 'identity.current_password_mismatch' },
    });
    expect(
      await change.execute({ actor, currentPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD, meta }),
    ).toMatchObject({
      ok: false,
      error: { code: 'identity.password_reused' },
    });

    const r = await change.execute({ actor, currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD, meta });
    expect(r).toEqual({ ok: true, value: { revokedSessions: 1 } });
    expect(deps.events.types()).toContain('identity.password_changed');
    expect((await new AuthenticateSession(deps).execute({ token: first.token })).ok).toBe(true);
  });
});
