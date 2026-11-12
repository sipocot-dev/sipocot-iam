import { describe, expect, it } from 'vitest';
import {
  ChangeUserRole,
  GetUser,
  ListSessions,
  ListUsers,
  RevokeSession,
  SetUserStatus,
  UpdateProfile,
} from '@/modules/identity/application';
import { asSessionId, asUserId, isAppError } from '@/shared/domain';
import { actorFor, actorWithRoles, identityDeps, makeUser, meta } from '../../support/fakes';

const TARGET_ID = '00000000-0000-7000-8000-00000000aaaa';

async function setup() {
  const deps = identityDeps();
  const target = makeUser({ id: TARGET_ID });
  await deps.users.save(target);
  return { deps, target };
}

const expectForbidden = async (p: Promise<unknown>) => {
  const e: unknown = await p.catch((x: unknown) => x);
  expect(isAppError(e) && e.kind).toBe('forbidden');
};

describe('authorization (RBAC)', () => {
  it('members cannot list or read other users; staff can read but not write', async () => {
    const { deps } = await setup();
    await expectForbidden(new ListUsers(deps).execute({ actor: actorWithRoles(['member']), page: { limit: 10 } }));
    await expectForbidden(
      new GetUser(deps).execute({ actor: actorWithRoles(['member']), userId: asUserId(TARGET_ID) }),
    );

    expect((await new ListUsers(deps).execute({ actor: actorWithRoles(['staff']), page: { limit: 10 } })).ok).toBe(
      true,
    );
    await expectForbidden(
      new SetUserStatus(deps).execute({
        actor: actorWithRoles(['staff']),
        userId: asUserId(TARGET_ID),
        status: 'disabled',
        meta,
      }),
    );
    await expectForbidden(
      new ChangeUserRole(deps).execute({
        actor: actorWithRoles(['staff']),
        userId: asUserId(TARGET_ID),
        role: 'admin',
        action: 'assign',
        meta,
      }),
    );
  });

  it('anyone can read their own profile', async () => {
    const { deps, target } = await setup();
    const r = await new GetUser(deps).execute({ actor: actorFor(target), userId: target.id });
    expect(r.ok && r.value.email).toBe('juan@sipocot.gov.ph');
  });
});

describe('ChangeUserRole', () => {
  it('admins assign and revoke roles; changes are audited with the admin as actor', async () => {
    const { deps } = await setup();
    const admin = actorWithRoles(['admin']);
    const uc = new ChangeUserRole(deps);
    const r = await uc.execute({ actor: admin, userId: asUserId(TARGET_ID), role: 'staff', action: 'assign', meta });
    expect(r.ok && r.value.roles).toEqual(['member', 'staff']);
    expect(deps.events.published.at(-1)?.ctx.actorId).toBe(admin.userId);
    const r2 = await uc.execute({ actor: admin, userId: asUserId(TARGET_ID), role: 'member', action: 'revoke', meta });
    expect(r2.ok && r2.value.roles).toEqual(['staff']);
  });

  it('prevents an admin from revoking their own roles (lock-out protection)', async () => {
    const { deps } = await setup();
    const admin = actorWithRoles(['admin']);
    const r = await new ChangeUserRole(deps).execute({
      actor: admin,
      userId: admin.userId,
      role: 'admin',
      action: 'revoke',
      meta,
    });
    expect(!r.ok && r.error.code).toBe('identity.self_modification');
  });

  it('returns not_found for unknown users', async () => {
    const { deps } = await setup();
    const r = await new ChangeUserRole(deps).execute({
      actor: actorWithRoles(['admin']),
      userId: asUserId('00000000-0000-7000-8000-000000000999'),
      role: 'staff',
      action: 'assign',
      meta,
    });
    expect(!r.ok && r.error.kind).toBe('not_found');
  });
});

describe('SetUserStatus', () => {
  it('disabling revokes every session of the user', async () => {
    const { deps, target } = await setup();
    const { Session } = await import('@/modules/identity/domain');
    await deps.sessions.create(
      Session.start({
        id: asSessionId('00000000-0000-7000-8000-000000000301'),
        userId: target.id,
        tokenHash: 'h1',
        ip: null,
        userAgent: null,
        now: deps.clock.now(),
        policy: deps.sessionPolicy,
      }),
    );
    const r = await new SetUserStatus(deps).execute({
      actor: actorWithRoles(['admin']),
      userId: target.id,
      status: 'disabled',
      meta,
    });
    expect(r.ok && r.value.status).toBe('disabled');
    expect(await deps.sessions.listActiveByUser(target.id, deps.clock.now())).toHaveLength(0);
    expect(deps.events.types()).toContain('identity.user_disabled');
  });

  it('admins cannot disable themselves', async () => {
    const { deps } = await setup();
    const admin = actorWithRoles(['admin']);
    const r = await new SetUserStatus(deps).execute({ actor: admin, userId: admin.userId, status: 'disabled', meta });
    expect(r.ok).toBe(false);
  });
});

describe('UpdateProfile', () => {
  it('updates display name and clears phone', async () => {
    const { deps, target } = await setup();
    const uc = new UpdateProfile(deps);
    const a = await uc.execute({ actor: actorFor(target), displayName: 'Juan D.', phone: '+639171234567' });
    expect(a.ok && a.value.phone).toBe('+639171234567');
    const b = await uc.execute({ actor: actorFor(target), phone: null });
    expect(b.ok && b.value).toMatchObject({ displayName: 'Juan D.', phone: null });
    expect((await uc.execute({ actor: actorFor(target), phone: 'bogus' })).ok).toBe(false);
  });
});

describe('Session management', () => {
  it('users cannot see or revoke sessions of others (no existence leak)', async () => {
    const { deps, target } = await setup();
    const { Session } = await import('@/modules/identity/domain');
    const sid = asSessionId('00000000-0000-7000-8000-000000000501');
    await deps.sessions.create(
      Session.start({
        id: sid,
        userId: target.id,
        tokenHash: 'h',
        ip: null,
        userAgent: null,
        now: deps.clock.now(),
        policy: deps.sessionPolicy,
      }),
    );

    const stranger = actorWithRoles(['member']);
    await expectForbidden(new ListSessions(deps).execute({ actor: stranger, userId: target.id }));
    const r = await new RevokeSession(deps).execute({ actor: stranger, sessionId: sid });
    expect(!r.ok && r.error.kind).toBe('not_found');

    const own = await new ListSessions(deps).execute({ actor: actorFor(target) });
    expect(own.ok && own.value).toHaveLength(1);
    expect((await new RevokeSession(deps).execute({ actor: actorFor(target), sessionId: sid })).ok).toBe(true);
  });

  it('cannot revoke the current session through the revoke endpoint', async () => {
    const { deps, target } = await setup();
    const { Session } = await import('@/modules/identity/domain');
    const sid = asSessionId('00000000-0000-7000-8000-000000000777');
    await deps.sessions.create(
      Session.start({
        id: sid,
        userId: target.id,
        tokenHash: 'h',
        ip: null,
        userAgent: null,
        now: deps.clock.now(),
        policy: deps.sessionPolicy,
      }),
    );
    const r = await new RevokeSession(deps).execute({ actor: actorFor(target, sid), sessionId: sid });
    expect(!r.ok && r.error.code).toBe('identity.revoke_current_session');
  });
});

describe('PurgeEndedSessions', () => {
  it('deletes only sessions that ended before the retention cutoff', async () => {
    const { deps, target } = await setup();
    const { Session } = await import('@/modules/identity/domain');
    const { PurgeEndedSessions } = await import('@/modules/identity/application');
    const mk = (id: string) =>
      Session.start({
        id: asSessionId(id),
        userId: target.id,
        tokenHash: id,
        ip: null,
        userAgent: null,
        now: deps.clock.now(),
        policy: deps.sessionPolicy,
      });

    const old = mk('00000000-0000-7000-8000-000000000a01');
    await deps.sessions.create(old);
    deps.clock.advance(40 * 86_400_000);
    const fresh = mk('00000000-0000-7000-8000-000000000a02');
    await deps.sessions.create(fresh);

    const r = await new PurgeEndedSessions(deps).execute({ retentionDays: 30 });
    expect(r).toEqual({ ok: true, value: { purged: 1 } });
    expect(deps.sessions.rows.has(fresh.id)).toBe(true);
  });
});
