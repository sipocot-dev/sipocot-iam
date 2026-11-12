import type { Clock, RateLimitDecision, RateLimiter, RateLimitPolicy } from '@/shared/application/ports';

/** Single-process limiter for tests and local development without Redis. */
export class MemoryRateLimiter implements RateLimiter {
  readonly #buckets = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly clock: Clock) {}

  consume(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision> {
    const now = this.clock.now().getTime();
    const id = `${policy.name}:${key}`;
    let bucket = this.#buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + policy.windowSeconds * 1000 };
      this.#buckets.set(id, bucket);
    }
    bucket.count += 1;
    return Promise.resolve({
      allowed: bucket.count <= policy.limit,
      limit: policy.limit,
      remaining: Math.max(0, policy.limit - bucket.count),
      resetSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    });
  }
}
