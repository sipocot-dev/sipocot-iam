import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, err, ok, type Result } from '@/shared/domain';
import { MemoryRateLimiter } from '@/shared/infrastructure/rate-limit/memory-rate-limiter';
import { toProblem } from '@/shared/interface/http/problem';
import { resolveClientIp } from '@/shared/interface/http/request-meta';
import { json } from '@/shared/interface/http/responses';
import { createRouteFactory, type HttpDeps } from '@/shared/interface/http/route';
import {
  clearSessionCookie,
  readBearer,
  readCookie,
  serializeSessionCookie,
} from '@/shared/interface/http/session-cookie';
import { FixedClock, SilentLogger } from '../../support/fakes';

interface P {
  actor: { userId: string };
}

const VALID_TOKEN = 'a'.repeat(43);
const ORIGIN = 'https://iam.sipocot.gov.ph';

function setup(overrides: Partial<HttpDeps<P>> = {}) {
  const logger = new SilentLogger();
  const observed: { route: string; status: number }[] = [];
  const deps: HttpDeps<P> = {
    logger,
    rateLimiter: new MemoryRateLimiter(new FixedClock()),
    authenticate: (token): Promise<Result<P, AppError>> =>
      Promise.resolve(
        token === VALID_TOKEN ? ok({ actor: { userId: 'u1' } }) : err(AppError.unauthenticated('auth.session_invalid')),
      ),
    cookie: { secure: true },
    allowedOrigins: new Set([ORIGIN]),
    trustProxy: true,
    globalRateLimit: { name: 'global', limit: 1000, windowSeconds: 60, failMode: 'open' },
    observe: (o) => observed.push(o),
    ...overrides,
  };
  return { route: createRouteFactory(() => deps), logger, observed };
}

const ctx = (params: Record<string, string> = {}) => ({ params: Promise.resolve(params) });

function req(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new NextRequest(new URL(path, ORIGIN), {
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
    ...(init.body !== undefined && { body: init.body }),
  });
}

const problem = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe('route() — authentication', () => {
  it('rejects anonymous calls to protected routes with 401 problem+json and a request id', async () => {
    const { route } = setup();
    const h = route({ name: 'GET /x', auth: 'required', handler: () => Promise.resolve(json({})) });
    const res = await h(req('/x', { headers: { 'x-request-id': 'req-abc-12345' } }), ctx());
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(res.headers.get('x-request-id')).toBe('req-abc-12345');
    expect(await problem(res)).toMatchObject({ status: 401, code: 'auth.unauthenticated', requestId: 'req-abc-12345' });
  });

  it('accepts bearer tokens and session cookies; passes principal to the handler', async () => {
    const { route } = setup();
    const h = route({
      name: 'GET /me',
      auth: 'required',
      handler: ({ principal, authMethod }) => Promise.resolve(json({ id: principal.actor.userId, authMethod })),
    });
    const viaBearer = await h(req('/me', { headers: { authorization: `Bearer ${VALID_TOKEN}` } }), ctx());
    expect(await viaBearer.json()).toEqual({ id: 'u1', authMethod: 'bearer' });
    const viaCookie = await h(req('/me', { headers: { cookie: `other=1; __Host-sipocot_sid=${VALID_TOKEN}` } }), ctx());
    expect(await viaCookie.json()).toEqual({ id: 'u1', authMethod: 'cookie' });
  });

  it('optional auth tolerates invalid tokens', async () => {
    const { route } = setup();
    const h = route({
      name: 'GET /o',
      auth: 'optional',
      handler: ({ principal }) => Promise.resolve(json({ anon: principal === null })),
    });
    const res = await h(req('/o', { headers: { authorization: 'Bearer nope' } }), ctx());
    expect(await res.json()).toEqual({ anon: true });
  });
});

describe('route() — CSRF', () => {
  const spec = { name: 'POST /w', auth: 'required', handler: () => Promise.resolve(json({ ok: true })) } as const;

  it('blocks cookie-authenticated writes from foreign origins', async () => {
    const { route } = setup();
    const h = route(spec);
    const cookie = `__Host-sipocot_sid=${VALID_TOKEN}`;
    expect(
      (await h(req('/w', { method: 'POST', headers: { cookie, origin: 'https://evil.example' } }), ctx())).status,
    ).toBe(403);
    expect((await h(req('/w', { method: 'POST', headers: { cookie } }), ctx())).status).toBe(403);
    expect((await h(req('/w', { method: 'POST', headers: { cookie, origin: ORIGIN } }), ctx())).status).toBe(200);
    expect(
      (await h(req('/w', { method: 'POST', headers: { cookie, 'sec-fetch-site': 'same-origin' } }), ctx())).status,
    ).toBe(200);
  });

  it('does not apply to bearer-token clients', async () => {
    const { route } = setup();
    const res = await route(spec)(
      req('/w', { method: 'POST', headers: { authorization: `Bearer ${VALID_TOKEN}` } }),
      ctx(),
    );
    expect(res.status).toBe(200);
  });
});

describe('route() — input validation', () => {
  const { route } = setup();
  const h = route({
    name: 'POST /v/:id',
    auth: 'none',
    params: z.strictObject({ id: z.uuid() }),
    query: z.strictObject({ dry: z.enum(['true', 'false']).optional() }),
    body: z.strictObject({ n: z.number().int().max(10) }),
    maxBodyBytes: 64,
    handler: ({ body, params }) => Promise.resolve(json({ n: body.n, id: params.id })),
  });
  const id = '0190f3a4-7b1c-7000-8000-000000000001';
  const post = (
    body: string,
    headers: Record<string, string> = { 'content-type': 'application/json' },
    path = `/v/${id}`,
  ) =>
    h(
      req(path, { method: 'POST', body, headers: { origin: ORIGIN, ...headers } }),
      ctx({ id: path.split('/')[2]?.split('?')[0] ?? '' }),
    );

  it('passes typed, validated input to the handler', async () => {
    const res = await post('{"n":3}');
    expect(await res.json()).toEqual({ n: 3, id });
  });

  it('returns 422 with field-level errors for schema violations and unknown keys', async () => {
    const res = await post('{"n":99,"extra":true}');
    expect(res.status).toBe(422);
    const body = await problem(res);
    expect(body['code']).toBe('request.invalid_body');
    expect(JSON.stringify(body['errors'])).toContain('n');
  });

  it('maps malformed JSON → 400, wrong media type → 415, oversized → 413, bad params → 422', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post('{"n":1}', { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post(JSON.stringify({ n: 1, pad: 'x'.repeat(100) }))).status).toBe(413);
    expect((await post('{"n":1}', undefined, '/v/not-a-uuid')).status).toBe(422);
    expect((await post('{"n":1}', undefined, `/v/${id}?dry=maybe`)).status).toBe(422);
  });
});

describe('route() — rate limiting', () => {
  it('returns 429 with Retry-After and RateLimit headers once the route limit is exhausted', async () => {
    const limited: string[] = [];
    const { route } = setup({ onRateLimited: (p) => limited.push(p) });
    const h = route({
      name: 'GET /rl',
      auth: 'none',
      rateLimits: [
        { policy: { name: 'tiny', limit: 2, windowSeconds: 30, failMode: 'closed' }, key: (c) => c.meta.ip },
      ],
      handler: () => Promise.resolve(json({})),
    });
    const call = () => h(req('/rl', { headers: { 'x-forwarded-for': '198.51.100.4, 10.0.0.1' } }), ctx());
    expect((await call()).headers.get('ratelimit-remaining')).toBe('1');
    await call();
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(limited).toEqual(['tiny']);
  });
});

describe('route() — error boundary', () => {
  it('hides internal error details from clients but logs them with the request id', async () => {
    const { route, logger, observed } = setup();
    const h = route({
      name: 'GET /boom',
      auth: 'none',
      handler: () => Promise.reject(new Error('password=hunter2 at db.users')),
    });
    const res = await h(req('/boom'), ctx());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('hunter2');
    expect(text).toContain('internal_error');
    expect(logger.lines.some((l) => l.level === 'error' && l.msg === 'unhandled error')).toBe(true);
    expect(observed).toEqual([
      { method: 'GET', route: 'GET /boom', status: 500, durationMs: expect.any(Number) as number },
    ]);
  });

  it('maps AppError kinds to HTTP statuses and keeps safe details', () => {
    const r = toProblem(AppError.conflict('identity.email_taken', 'taken', { field: 'email' }), 'rid', '/x');
    expect(r.status).toBe(409);
    expect(toProblem(AppError.forbidden(), 'rid', '/x').status).toBe(403);
    expect(toProblem(new AppError('internal', 'x', 'secret detail'), 'rid', '/x').status).toBe(500);
  });

  it('returns 500 (not a crash) when configuration is invalid', async () => {
    const route = createRouteFactory<P>(() => {
      throw new Error('Invalid environment configuration');
    });
    const res = await route({ name: 'GET /cfg', auth: 'none', handler: () => Promise.resolve(json({})) })(
      req('/cfg'),
      ctx(),
    );
    expect(res.status).toBe(500);
  });
});

describe('cookies & headers helpers', () => {
  it('uses the __Host- prefix and secure attributes in production', () => {
    const c = serializeSessionCookie({ secure: true }, 'tok', new Date(61_000), new Date(1_000));
    expect(c).toBe('__Host-sipocot_sid=tok; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure');
    expect(clearSessionCookie({ secure: false })).toContain('sipocot_sid=; Path=/; Max-Age=0');
    expect(readCookie('a=1; b=2', 'b')).toBe('2');
    expect(readCookie(null, 'b')).toBeUndefined();
    expect(readBearer('Bearer abc.def')).toBe('abc.def');
    expect(readBearer('Basic abc')).toBeUndefined();
  });

  it('only trusts forwarding headers when configured and validates IPs', () => {
    const h = new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' });
    expect(resolveClientIp(h, true)).toBe('203.0.113.9');
    expect(resolveClientIp(h, false)).toBeUndefined();
    expect(resolveClientIp(new Headers({ 'x-forwarded-for': 'not-an-ip' }), true)).toBeUndefined();
  });
});
