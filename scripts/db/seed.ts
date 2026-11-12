/**
 * Idempotently creates the initial administrator.
 * Usage: SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... pnpm db:seed
 */
import { RegisterUser } from '@/modules/identity/application';
import { Argon2PasswordHasher } from '@/modules/identity/infrastructure/argon2-password-hasher';
import { DrizzleUserRepository } from '@/modules/identity/infrastructure/drizzle-user-repository';
import { Email } from '@/modules/identity/domain';
import { DrizzleAuditPublisher } from '@/shared/infrastructure/audit/drizzle-audit-publisher';
import { getEnv } from '@/shared/infrastructure/config/env';
import { AesGcmEncryptor } from '@/shared/infrastructure/crypto/aes-gcm-encryptor';
import { createDatabase } from '@/shared/infrastructure/db/client';
import { createLogger } from '@/shared/infrastructure/logging/pino-logger';
import { SystemClock } from '@/shared/infrastructure/system/system-clock';
import { UuidV7Generator } from '@/shared/infrastructure/system/uuid-v7';
import { loadDotEnv } from '../load-env';

async function main(): Promise<void> {
  loadDotEnv();
  const env = getEnv();
  const email = process.env['SEED_ADMIN_EMAIL'];
  const password = process.env['SEED_ADMIN_PASSWORD'];
  if (!email || !password) throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are required');

  const logger = createLogger({ level: 'info', service: 'seed', env: env.APP_ENV, version: 'seed' });
  const handle = createDatabase({
    url: env.DATABASE_URL,
    max: 1,
    prepare: env.DATABASE_PREPARE,
    appName: 'sipocot-iam-seed',
  });
  try {
    const clock = new SystemClock();
    const ids = new UuidV7Generator();
    const users = new DrizzleUserRepository(
      handle.db,
      new AesGcmEncryptor(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY_ID),
    );
    const hasher = new Argon2PasswordHasher(
      env.PASSWORD_PEPPER ? Buffer.from(env.PASSWORD_PEPPER, 'base64') : undefined,
    );
    const events = new DrizzleAuditPublisher(handle.db, ids, logger);

    const parsed = Email.create(email);
    if (!parsed.ok) throw parsed.error;
    let user = await users.findByEmail(parsed.value);
    if (!user) {
      const r = await new RegisterUser({ users, hasher, events, clock, ids }).execute({
        email,
        password,
        displayName: 'Administrator',
        meta: { requestId: 'seed', ip: undefined, userAgent: 'seed-script' },
      });
      if (!r.ok) throw r.error;
      user = await users.findByEmail(parsed.value);
    }
    if (!user) throw new Error('admin user missing after creation');
    if (!user.roles.has('admin')) {
      user.assignRole('admin', clock.now());
      await users.save(user);
      await events.publish(user.pullEvents(), { actorId: user.id, requestId: 'seed' });
    }
    logger.info('admin ready', { userId: user.id });
  } finally {
    await handle.close();
  }
}

main().catch((e: unknown) => {
  console.error((e as Error).message);
  process.exit(1);
});
