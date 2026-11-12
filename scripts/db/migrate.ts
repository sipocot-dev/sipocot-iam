/**
 * Applies pending migrations from ./drizzle.
 * Safe to run concurrently (k8s Job + CI): a Postgres advisory lock serialises runs.
 * Usage: pnpm db:migrate   (requires DATABASE_URL; use a DDL-capable role)
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { loadDotEnv } from '../load-env';

const LOCK_ID = 727_414_201; // arbitrary, stable

async function main(): Promise<void> {
  loadDotEnv();
  const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL (or MIGRATION_DATABASE_URL) is required');

  const sql = postgres(url, {
    max: 1,
    onnotice: () => undefined,
    connection: { application_name: 'sipocot-iam-migrate' },
  });
  const started = Date.now();
  try {
    await sql`select pg_advisory_lock(${LOCK_ID})`;
    await migrate(drizzle(sql), { migrationsFolder: 'drizzle' });
    console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', durationMs: Date.now() - started }));
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_ID})`.catch(() => undefined);
    await sql.end({ timeout: 5 });
  }
}

main().catch((e: unknown) => {
  console.error(JSON.stringify({ level: 'error', msg: 'migration failed', error: (e as Error).message }));
  process.exit(1);
});
