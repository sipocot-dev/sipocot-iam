import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import { schema } from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  readonly db: Database;
  readonly sql: Sql;
  close(): Promise<void>;
}

export function createDatabase(opts: { url: string; max: number; prepare: boolean; appName: string }): DatabaseHandle {
  const client = postgres(opts.url, {
    max: opts.max,
    prepare: opts.prepare,
    idle_timeout: 20,
    connect_timeout: 10,
    max_lifetime: 60 * 30,
    connection: { application_name: opts.appName, statement_timeout: 15_000 },
    onnotice: () => undefined,
  });
  return {
    db: drizzle(client, { schema }),
    sql: client,
    close: () => client.end({ timeout: 5 }),
  };
}

/** PostgreSQL SQLSTATE for unique_violation. */
export const PG_UNIQUE_VIOLATION = '23505';

export const pgErrorCode = (e: unknown): { code: string; constraint: string | undefined } | null => {
  // drizzle wraps driver errors; walk the cause chain.
  for (let cur: unknown = e, depth = 0; cur && depth < 5; cur = (cur as { cause?: unknown }).cause, depth++) {
    if (typeof cur === 'object' && 'code' in cur && typeof cur.code === 'string' && /^[0-9A-Z]{5}$/.test(cur.code)) {
      const constraint =
        'constraint_name' in cur && typeof cur.constraint_name === 'string' ? cur.constraint_name : undefined;
      return { code: cur.code, constraint };
    }
  }
  return null;
};
