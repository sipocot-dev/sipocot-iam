import 'server-only';
import type { AuthenticatedPrincipal } from '@/modules/identity/application';
import { RateLimits } from '@/shared/infrastructure/rate-limit/policies';
import { createRouteFactory, type HttpDeps } from '@/shared/interface/http/route';
import { getContainer } from './container';

let deps: HttpDeps<AuthenticatedPrincipal> | undefined;

function httpDeps(): HttpDeps<AuthenticatedPrincipal> {
  if (deps) return deps;
  const c = getContainer();
  deps = {
    logger: c.logger,
    rateLimiter: c.rateLimiter,
    authenticate: (token) => c.identity.authenticate.execute({ token }),
    cookie: { secure: c.env.APP_URL.startsWith('https://') },
    allowedOrigins: new Set([new URL(c.env.APP_URL).origin, ...(c.env.ALLOWED_ORIGINS ?? [])]),
    trustProxy: c.env.TRUST_PROXY,
    globalRateLimit: RateLimits.global,
    observe: ({ method, route, status, durationMs }) => {
      const labels = { method, route, status: String(status) };
      c.metrics.httpRequests.inc(labels);
      c.metrics.httpDuration.observe(labels, durationMs / 1000);
    },
    onRateLimited: (policy) => {
      c.metrics.rateLimited.inc({ policy });
    },
  };
  return deps;
}

/** `route({...})` — the single entry point every API endpoint is built with. */
export const route = createRouteFactory(httpDeps);
