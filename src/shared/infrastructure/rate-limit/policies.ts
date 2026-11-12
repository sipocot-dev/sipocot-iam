import type { RateLimitPolicy } from '@/shared/application/ports';

/** Central catalogue so limits are reviewed in one place. */
export const RateLimits = {
  /** Every API request, per client IP. */
  global: { name: 'global', limit: 300, windowSeconds: 60, failMode: 'open' },
  /** Credential stuffing defence: per IP... */
  loginByIp: { name: 'auth:login:ip', limit: 20, windowSeconds: 15 * 60, failMode: 'closed' },
  /** ...and per target account, independent of IP rotation. */
  loginByAccount: { name: 'auth:login:account', limit: 10, windowSeconds: 15 * 60, failMode: 'closed' },
  register: { name: 'auth:register', limit: 5, windowSeconds: 60 * 60, failMode: 'closed' },
  passwordChange: { name: 'auth:password', limit: 5, windowSeconds: 15 * 60, failMode: 'closed' },
  sensitiveWrite: { name: 'admin:write', limit: 60, windowSeconds: 60, failMode: 'open' },
  upload: { name: 'files:upload', limit: 30, windowSeconds: 60 * 60, failMode: 'open' },
} as const satisfies Record<string, RateLimitPolicy>;
