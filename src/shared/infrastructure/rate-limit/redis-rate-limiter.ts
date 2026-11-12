import type { Redis } from 'ioredis';
import type { Logger, RateLimitDecision, RateLimiter, RateLimitPolicy } from '@/shared/application/ports';
import { sha256Hex } from '../crypto/hash';

// Atomic fixed-window counter: INCR + set expiry on first hit, return count and TTL.
const SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {c, ttl}
`;

export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly logger: Logger,
  ) {}

  async consume(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision> {
    // Hash identifiers so emails / IPs are not stored in plaintext in Redis.
    const redisKey = `rl:${policy.name}:${sha256Hex(key).slice(0, 32)}`;
    try {
      const raw = await this.redis.eval(SCRIPT, 1, redisKey, String(policy.windowSeconds * 1000));
      if (!Array.isArray(raw) || typeof raw[0] !== 'number' || typeof raw[1] !== 'number')
        throw new Error('Unexpected rate-limit reply');
      const [count, ttlMs] = raw as [number, number];
      return {
        allowed: count <= policy.limit,
        limit: policy.limit,
        remaining: Math.max(0, policy.limit - count),
        resetSeconds: Math.ceil(ttlMs / 1000),
      };
    } catch (e) {
      this.logger.warn('rate limiter unavailable', {
        policy: policy.name,
        failMode: policy.failMode,
        error: (e as Error).message,
      });
      return {
        allowed: policy.failMode === 'open',
        limit: policy.limit,
        remaining: 0,
        resetSeconds: policy.windowSeconds,
      };
    }
  }
}
