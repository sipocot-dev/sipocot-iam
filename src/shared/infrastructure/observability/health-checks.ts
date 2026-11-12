import type { Redis } from 'ioredis';
import type { Sql } from 'postgres';
import type { HealthCheck } from '@/shared/application/ports';

const withTimeout = async <T>(p: Promise<T>, ms: number, name: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>(
        (_, reject) =>
          (timer = setTimeout(() => {
            reject(new Error(`${name} timed out after ${ms}ms`));
          }, ms)),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const postgresHealthCheck = (sql: Sql): HealthCheck => ({
  name: 'postgres',
  check: async () => {
    await withTimeout(sql`select 1`, 2_000, 'postgres');
  },
});

export const redisHealthCheck = (redis: Redis): HealthCheck => ({
  name: 'redis',
  check: async () => {
    await withTimeout(redis.ping(), 2_000, 'redis');
  },
});

export interface CheckResult {
  readonly status: 'ok' | 'fail';
  readonly latencyMs: number;
  readonly error?: string;
}

export interface HealthReport {
  readonly status: 'ok' | 'degraded';
  readonly checks: Readonly<Record<string, CheckResult>>;
}

export async function runHealthChecks(checks: readonly HealthCheck[]): Promise<HealthReport> {
  const results = await Promise.all(
    checks.map(async (c): Promise<readonly [string, CheckResult]> => {
      const started = performance.now();
      try {
        await c.check();
        return [c.name, { status: 'ok', latencyMs: Math.round(performance.now() - started) }];
      } catch (e) {
        return [
          c.name,
          { status: 'fail', latencyMs: Math.round(performance.now() - started), error: (e as Error).message },
        ];
      }
    }),
  );
  const out: Record<string, CheckResult> = Object.fromEntries(results);
  return { status: results.every(([, r]) => r.status === 'ok') ? 'ok' : 'degraded', checks: out };
}
