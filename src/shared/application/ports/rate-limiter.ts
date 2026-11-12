export interface RateLimitPolicy {
  /** Logical bucket, e.g. `auth:login`. */
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
  /** When the backing store is down: `open` lets traffic through, `closed` rejects it. */
  readonly failMode: 'open' | 'closed';
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Seconds until the window resets. */
  readonly resetSeconds: number;
}

export interface RateLimiter {
  consume(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision>;
}
