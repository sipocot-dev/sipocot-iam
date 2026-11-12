import 'server-only';
import { getContainer } from '@/composition/container';
import { route } from '@/composition/http';
import { asSessionId, asUserId } from '@/shared/domain';
import { RateLimits } from '@/shared/infrastructure/rate-limit/policies';
import { json, noContent, unwrap } from '@/shared/interface/http/responses';
import { clearSessionCookie, serializeSessionCookie } from '@/shared/interface/http/session-cookie';
import { toSessionView } from '../../application';
import {
  ChangePasswordBody,
  LoginBody,
  LogoutBody,
  PageQuery,
  RegisterBody,
  SessionIdParams,
  SetStatusBody,
  UpdateProfileBody,
  UserIdParams,
  UserRoleParams,
} from './schemas';

const byIp = (ctx: { meta: { ip: string | undefined } }) => ctx.meta.ip ?? 'unknown';
const byUser = (ctx: { principal: { actor: { userId: string } } }) => ctx.principal.actor.userId;
const cookieCfg = () => ({ secure: getContainer().env.APP_URL.startsWith('https://') });

// ── /api/v1/auth ──────────────────────────────────────────────────────────────

export const register = route({
  name: 'POST /api/v1/auth/register',
  auth: 'none',
  body: RegisterBody,
  rateLimits: [{ policy: RateLimits.register, key: byIp }],
  handler: async ({ body, meta }) => {
    const user = unwrap(await getContainer().identity.register.execute({ ...body, meta }));
    return json({ data: user }, { status: 201, headers: { location: `/api/v1/users/${user.id}` } });
  },
});

export const login = route({
  name: 'POST /api/v1/auth/login',
  auth: 'none',
  body: LoginBody,
  rateLimits: [
    { policy: RateLimits.loginByIp, key: byIp },
    { policy: RateLimits.loginByAccount, key: (ctx) => ctx.body.email.toLowerCase() },
  ],
  handler: async ({ body, meta }) => {
    const c = getContainer();
    const result = await c.identity.login.execute({ email: body.email, password: body.password, meta });
    c.metrics.authEvents.inc({ event: 'login', outcome: result.ok ? 'success' : 'failure' });
    const out = unwrap(result);
    const data = { user: out.user, expiresAt: out.expiresAt.toISOString() };
    if (body.tokenDelivery === 'bearer') return json({ data: { ...data, token: out.token, tokenType: 'Bearer' } });
    return json(
      { data },
      { headers: { 'set-cookie': serializeSessionCookie(cookieCfg(), out.token, out.expiresAt, c.clock.now()) } },
    );
  },
});

export const logout = route({
  name: 'POST /api/v1/auth/logout',
  auth: 'required',
  body: LogoutBody,
  handler: async ({ body, principal }) => {
    unwrap(await getContainer().identity.logout.execute({ actor: principal.actor, allDevices: body.allDevices }));
    return noContent({ 'set-cookie': clearSessionCookie(cookieCfg()) });
  },
});

export const me = route({
  name: 'GET /api/v1/auth/me',
  auth: 'required',
  handler: async ({ principal }) => {
    const user = unwrap(
      await getContainer().identity.getUser.execute({ actor: principal.actor, userId: principal.actor.userId }),
    );
    return json({ data: { user, session: toSessionView(principal.session, principal.session.id) } });
  },
});

export const updateMe = route({
  name: 'PATCH /api/v1/auth/me',
  auth: 'required',
  body: UpdateProfileBody,
  rateLimits: [{ policy: RateLimits.sensitiveWrite, key: byUser }],
  handler: async ({ body, principal }) => {
    const user = unwrap(await getContainer().identity.updateProfile.execute({ actor: principal.actor, ...body }));
    return json({ data: user });
  },
});

export const changePassword = route({
  name: 'POST /api/v1/auth/password',
  auth: 'required',
  body: ChangePasswordBody,
  rateLimits: [{ policy: RateLimits.passwordChange, key: byUser }],
  handler: async ({ body, principal, meta }) => {
    const r = unwrap(await getContainer().identity.changePassword.execute({ actor: principal.actor, ...body, meta }));
    return json({ data: r });
  },
});

export const mySessions = route({
  name: 'GET /api/v1/auth/sessions',
  auth: 'required',
  handler: async ({ principal }) =>
    json({ data: unwrap(await getContainer().identity.listSessions.execute({ actor: principal.actor })) }),
});

export const revokeMySession = route({
  name: 'DELETE /api/v1/auth/sessions/:sessionId',
  auth: 'required',
  params: SessionIdParams,
  handler: async ({ params, principal }) => {
    unwrap(
      await getContainer().identity.revokeSession.execute({
        actor: principal.actor,
        sessionId: asSessionId(params.sessionId),
      }),
    );
    return noContent();
  },
});

// ── /api/v1/users (administration) ───────────────────────────────────────────

export const listUsers = route({
  name: 'GET /api/v1/users',
  auth: 'required',
  query: PageQuery,
  handler: async ({ query, principal }) => {
    const page = unwrap(await getContainer().identity.listUsers.execute({ actor: principal.actor, page: query }));
    return json({ data: page.items, pagination: { nextCursor: page.nextCursor } });
  },
});

export const getUser = route({
  name: 'GET /api/v1/users/:userId',
  auth: 'required',
  params: UserIdParams,
  handler: async ({ params, principal }) =>
    json({
      data: unwrap(
        await getContainer().identity.getUser.execute({ actor: principal.actor, userId: asUserId(params.userId) }),
      ),
    }),
});

export const setUserStatus = route({
  name: 'PATCH /api/v1/users/:userId/status',
  auth: 'required',
  params: UserIdParams,
  body: SetStatusBody,
  rateLimits: [{ policy: RateLimits.sensitiveWrite, key: byUser }],
  handler: async ({ params, body, principal, meta }) =>
    json({
      data: unwrap(
        await getContainer().identity.setStatus.execute({
          actor: principal.actor,
          userId: asUserId(params.userId),
          status: body.status,
          meta,
        }),
      ),
    }),
});

const changeRole = (action: 'assign' | 'revoke') =>
  route({
    name: `${action === 'assign' ? 'PUT' : 'DELETE'} /api/v1/users/:userId/roles/:role`,
    auth: 'required',
    params: UserRoleParams,
    rateLimits: [{ policy: RateLimits.sensitiveWrite, key: byUser }],
    handler: async ({ params, principal, meta }) =>
      json({
        data: unwrap(
          await getContainer().identity.changeRole.execute({
            actor: principal.actor,
            userId: asUserId(params.userId),
            role: params.role,
            action,
            meta,
          }),
        ),
      }),
  });

export const assignRole = changeRole('assign');
export const revokeRole = changeRole('revoke');

export const userSessions = route({
  name: 'GET /api/v1/users/:userId/sessions',
  auth: 'required',
  params: UserIdParams,
  handler: async ({ params, principal }) =>
    json({
      data: unwrap(
        await getContainer().identity.listSessions.execute({ actor: principal.actor, userId: asUserId(params.userId) }),
      ),
    }),
});
