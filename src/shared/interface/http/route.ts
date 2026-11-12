import type { NextRequest } from 'next/server';
import type { z } from 'zod';
import type { RequestMeta } from '@/shared/application/actor';
import type { Logger, RateLimiter, RateLimitPolicy } from '@/shared/application/ports';
import { AppError, type Result } from '@/shared/domain';
import { fallbackLog } from './fallback-log';
import { HttpError, toProblem, zodProblemErrors } from './problem';
import { REQUEST_ID_HEADER, resolveClientIp, resolveRequestId } from './request-meta';
import { readBearer, readCookie, sessionCookieName, type CookieConfig } from './session-cookie';

// ── Ports the HTTP adapter needs (satisfied by the composition root) ──────────
export interface Principal<TActor = unknown> {
  readonly actor: TActor;
}

export interface HttpDeps<P extends Principal> {
  readonly logger: Logger;
  readonly rateLimiter: RateLimiter;
  readonly authenticate: (token: string) => Promise<Result<P, AppError>>;
  readonly cookie: CookieConfig;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly trustProxy: boolean;
  readonly globalRateLimit: RateLimitPolicy;
  readonly observe?: (o: { method: string; route: string; status: number; durationMs: number }) => void;
  readonly onRateLimited?: (policy: string) => void;
}

type AuthMode = 'required' | 'optional' | 'none';
type Schema = z.ZodType;
type Out<S> = S extends z.ZodType ? z.output<S> : undefined;
type PrincipalFor<A extends AuthMode, P> = A extends 'required' ? P : A extends 'optional' ? P | null : null;

export interface HandlerContext<TBody, TQuery, TParams, TPrincipal> {
  readonly req: NextRequest;
  readonly body: TBody;
  readonly query: TQuery;
  readonly params: TParams;
  readonly principal: TPrincipal;
  readonly authMethod: 'cookie' | 'bearer' | null;
  readonly meta: RequestMeta;
  readonly log: Logger;
}

export interface KeyedRateLimit<C> {
  readonly policy: RateLimitPolicy;
  readonly key: (ctx: C) => string | undefined;
}

export interface RouteSpec<
  A extends AuthMode,
  B extends Schema | undefined,
  Q extends Schema | undefined,
  Pm extends Schema | undefined,
  P extends Principal,
> {
  /** Low-cardinality route label for logs/metrics, e.g. `POST /api/v1/auth/login`. */
  readonly name: string;
  readonly auth: A;
  readonly body?: B;
  readonly query?: Q;
  readonly params?: Pm;
  readonly maxBodyBytes?: number;
  readonly rateLimits?: readonly KeyedRateLimit<HandlerContext<Out<B>, Out<Q>, Out<Pm>, PrincipalFor<A, P>>>[];
  readonly handler: (ctx: HandlerContext<Out<B>, Out<Q>, Out<Pm>, PrincipalFor<A, P>>) => Promise<Response>;
}

export interface NextRouteContext {
  params: Promise<Record<string, string | string[] | undefined>>;
}
export type NextRouteHandler = (req: NextRequest, ctx: NextRouteContext) => Promise<Response>;

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const DEFAULT_MAX_BODY = 32 * 1024;

function rateLimitHeaders(d: { limit: number; remaining: number; resetSeconds: number }): Record<string, string> {
  return {
    'ratelimit-limit': String(d.limit),
    'ratelimit-remaining': String(d.remaining),
    'ratelimit-reset': String(d.resetSeconds),
  };
}

function parseWith<S extends Schema>(schema: S, value: unknown, where: 'body' | 'query' | 'params'): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw AppError.validation(`request.invalid_${where}`, `Request ${where} failed validation`, {
      errors: zodProblemErrors(r.error),
    });
  }
  return r.data;
}

async function readJsonBody(req: NextRequest, maxBytes: number): Promise<unknown> {
  const contentType = req.headers.get('content-type') ?? '';
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new HttpError(413, 'request.too_large', `Body exceeds ${maxBytes} bytes`);
  const text = await req.text();
  if (text.length === 0) return undefined;
  if (!/^application\/(.+\+)?json\b/i.test(contentType))
    throw new HttpError(415, 'request.unsupported_media_type', 'Content-Type must be application/json');
  if (Buffer.byteLength(text, 'utf8') > maxBytes)
    throw new HttpError(413, 'request.too_large', `Body exceeds ${maxBytes} bytes`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'request.malformed_json', 'Body is not valid JSON');
  }
}

/**
 * CSRF defence for cookie-authenticated state changes: the browser-supplied Origin
 * (or Fetch Metadata) must match an allowed origin. Bearer-token clients are not
 * vulnerable to CSRF and skip this check.
 */
function assertSameOrigin(req: NextRequest, allowed: ReadonlySet<string>): void {
  const origin = req.headers.get('origin');
  if (origin) {
    if (!allowed.has(origin)) throw new HttpError(403, 'request.cross_origin', 'Cross-origin request rejected');
    return;
  }
  if (req.headers.get('sec-fetch-site') !== 'same-origin')
    throw new HttpError(403, 'request.cross_origin', 'Missing Origin header');
}

export function createRouteFactory<P extends Principal>(getDeps: () => HttpDeps<P>) {
  return function route<
    A extends AuthMode,
    B extends Schema | undefined = undefined,
    Q extends Schema | undefined = undefined,
    Pm extends Schema | undefined = undefined,
  >(spec: RouteSpec<A, B, Q, Pm, P>): NextRouteHandler {
    return async (req, routeCtx) => {
      const started = performance.now();
      const requestId = resolveRequestId(req.headers);
      const instance = new URL(req.url).pathname;
      let status = 500;
      let deps: HttpDeps<P> | undefined;
      let log: Logger | undefined;
      let userId: string | undefined;
      const extraHeaders: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };

      try {
        const d = getDeps();
        deps = d;
        const ip = resolveClientIp(req.headers, deps.trustProxy);
        const meta: RequestMeta = { requestId, ip, userAgent: req.headers.get('user-agent') ?? undefined };
        log = deps.logger.child({ requestId, route: spec.name });

        const limit = async (policy: RateLimitPolicy, key: string) => {
          const decision = await d.rateLimiter.consume(policy, key);
          Object.assign(extraHeaders, rateLimitHeaders(decision));
          if (!decision.allowed) {
            d.onRateLimited?.(policy.name);
            throw new HttpError(429, 'rate_limited', 'Too many requests, slow down', {
              'retry-after': String(decision.resetSeconds),
            });
          }
        };

        // 1. Global per-IP throttle.
        await limit(deps.globalRateLimit, ip ?? 'unknown');

        // 2. Authentication (bearer header wins over cookie).
        const bearer = readBearer(req.headers.get('authorization'));
        const cookieToken = bearer ? undefined : readCookie(req.headers.get('cookie'), sessionCookieName(deps.cookie));
        const token = bearer ?? cookieToken;
        const authMethod = bearer ? 'bearer' : cookieToken ? 'cookie' : null;
        let principal: P | null = null;
        if (spec.auth !== 'none' && token) {
          const r = await deps.authenticate(token);
          if (r.ok) principal = r.value;
          else if (spec.auth === 'required') throw r.error;
        }
        if (spec.auth === 'required' && !principal) throw AppError.unauthenticated();
        userId = (principal?.actor as { userId?: string } | undefined)?.userId;

        // 3. CSRF for cookie sessions and for credential-bearing anonymous posts (login CSRF).
        if (UNSAFE_METHODS.has(req.method) && authMethod !== 'bearer') assertSameOrigin(req, deps.allowedOrigins);

        // 4. Input validation.
        const rawParams = await routeCtx.params;
        const params = spec.params ? parseWith(spec.params, rawParams, 'params') : undefined;
        const query = spec.query
          ? parseWith(spec.query, Object.fromEntries(req.nextUrl.searchParams), 'query')
          : undefined;
        let body: unknown;
        if (spec.body) {
          const raw = await readJsonBody(req, spec.maxBodyBytes ?? DEFAULT_MAX_BODY);
          body = parseWith(spec.body, raw ?? {}, 'body');
        }

        const ctx = { req, body, query, params, principal, authMethod, meta, log } as HandlerContext<
          Out<B>,
          Out<Q>,
          Out<Pm>,
          PrincipalFor<A, P>
        >;

        // 5. Route-specific rate limits (may key on validated input or principal).
        for (const rl of spec.rateLimits ?? []) {
          const key = rl.key(ctx);
          if (key !== undefined) await limit(rl.policy, key);
        }

        // 6. Handler.
        const res = await spec.handler(ctx);
        for (const [k, v] of Object.entries(extraHeaders)) if (!res.headers.has(k)) res.headers.set(k, v);
        status = res.status;
        return res;
      } catch (error) {
        const mapped = toProblem(error, requestId, instance);
        status = mapped.status;
        const logger = log ?? deps?.logger;
        if (!logger) fallbackLog('error', `request failed before logger was available (${spec.name})`, error);
        else if (mapped.expected) logger.info('request rejected', { status, code: (error as { code?: string }).code });
        else
          logger.error('unhandled error', {
            status,
            err:
              error instanceof Error ? { type: error.name, message: error.message, stack: error.stack } : String(error),
          });
        for (const [k, v] of Object.entries(extraHeaders)) mapped.response.headers.set(k, v);
        return mapped.response;
      } finally {
        const durationMs = Math.round(performance.now() - started);
        deps?.observe?.({ method: req.method, route: spec.name, status, durationMs });
        log?.info('request completed', { method: req.method, status, durationMs, userId });
      }
    };
  };
}
