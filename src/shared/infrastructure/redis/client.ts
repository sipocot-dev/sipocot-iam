import { Redis } from 'ioredis';

export function createRedis(opts: { url: string; keyPrefix: string }): Redis {
  return new Redis(opts.url, {
    keyPrefix: opts.keyPrefix,
    lazyConnect: false,
    // Fail fast instead of queueing forever when Redis is unreachable —
    // callers decide whether to fail open or closed.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    commandTimeout: 2_000,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  });
}
