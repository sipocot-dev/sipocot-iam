/**
 * Runs against real Postgres + Redis. Skipped unless both URLs are provided:
 *   TEST_DATABASE_URL=postgres://sipocot:sipocot@localhost:5432/sipocot_iam_test \
 *   TEST_REDIS_URL=redis://:sipocot@localhost:6379/15 pnpm test:integration
 * The database is wiped (DROP SCHEMA) before the suite — never point it at real data.
 */
import { randomBytes } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CachedSessionRepository } from '@/modules/identity/infrastructure/cached-session-repository';
import { DrizzleSessionRepository } from '@/modules/identity/infrastructure/drizzle-session-repository';
import { DrizzleUserRepository } from '@/modules/identity/infrastructure/drizzle-user-repository';
import { DEFAULT_SESSION_POLICY, Email, PhoneNumber, Session } from '@/modules/identity/domain';
import { DrizzleFileRepository } from '@/modules/storage/infrastructure/drizzle-file-repository';
import { StoredFile } from '@/modules/storage/domain';
import { asFileId, asSessionId, isAppError } from '@/shared/domain';
import { DrizzleAuditPublisher } from '@/shared/infrastructure/audit/drizzle-audit-publisher';
import { AesGcmEncryptor } from '@/shared/infrastructure/crypto/aes-gcm-encryptor';
import { createDatabase, type DatabaseHandle } from '@/shared/infrastructure/db/client';
import { RedisRateLimiter } from '@/shared/infrastructure/rate-limit/redis-rate-limiter';
import { uuidv7 } from '@/shared/infrastructure/system/uuid-v7';
import { FixedClock, makeUser, SilentLogger } from '../support/fakes';

const DB_URL = process.env['TEST_DATABASE_URL'];
const REDIS_URL = process.env['TEST_REDIS_URL'];

describe.skipIf(!DB_URL || !REDIS_URL)('persistence adapters (Postgres + Redis)', () => {
  let handle: DatabaseHandle;
  let redis: Redis;
  const clock = new FixedClock(new Date());
  const logger = new SilentLogger();
  const encryptor = new AesGcmEncryptor(new Map([['t1', randomBytes(32)]]), 't1');

  beforeAll(async () => {
    const admin = postgres(DB_URL!, { max: 1, onnotice: () => undefined });
    await admin`drop schema if exists public cascade`;
    await admin`drop schema if exists drizzle cascade`;
    await admin`create schema public`;
    await migrate(drizzle(admin), { migrationsFolder: 'drizzle' });
    await admin.end();

    handle = createDatabase({ url: DB_URL!, max: 4, prepare: true, appName: 'integration-test' });
    redis = new Redis(REDIS_URL!, { keyPrefix: `itest:${uuidv7()}:` });
  });

  afterAll(async () => {
    await handle.close();
    redis.disconnect();
  });

  const newUser = (email: string) => makeUser({ id: uuidv7(), email, now: clock.now() });

  describe('DrizzleUserRepository', () => {
    it('round-trips a user and stores the phone encrypted with row-bound AAD', async () => {
      const repo = new DrizzleUserRepository(handle.db, encryptor);
      const user = newUser('enc@sipocot.gov.ph');
      const phone = PhoneNumber.create('09171234567');
      if (!phone.ok) throw phone.error;
      user.updateProfile({ phone: phone.value }, clock.now());
      await repo.save(user);

      const loaded = await repo.findByEmail(Email.fromTrusted('enc@sipocot.gov.ph'));
      expect(loaded?.phone).toBe('+639171234567');
      expect(loaded?.version).toBe(1);

      const [raw] = await handle.sql<
        { phone_encrypted: string }[]
      >`select phone_encrypted from users where id = ${user.id}`;
      expect(raw?.phone_encrypted.startsWith('enc:v1:t1:')).toBe(true);
      expect(raw?.phone_encrypted).not.toContain('917');
    });

    it('enforces optimistic locking', async () => {
      const repo = new DrizzleUserRepository(handle.db, encryptor);
      const user = newUser('lock@sipocot.gov.ph');
      await repo.save(user);
      const a = await repo.findById(user.id);
      const b = await repo.findById(user.id);
      a?.assignRole('staff', clock.now());
      b?.assignRole('admin', clock.now());
      await repo.save(a!);
      const e: unknown = await repo.save(b!).catch((x: unknown) => x);
      expect(isAppError(e) && e.code).toBe('identity.concurrent_modification');
    });

    it('maps the unique email violation to a domain conflict', async () => {
      const repo = new DrizzleUserRepository(handle.db, encryptor);
      await repo.save(newUser('dup@sipocot.gov.ph'));
      const e: unknown = await repo.save(newUser('dup@sipocot.gov.ph')).catch((x: unknown) => x);
      expect(isAppError(e) && e.code).toBe('identity.email_taken');
    });

    it('paginates with keyset cursors', async () => {
      const repo = new DrizzleUserRepository(handle.db, encryptor);
      for (let i = 0; i < 5; i++) await repo.save(newUser(`page${i}@sipocot.gov.ph`));
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await repo.list({ limit: 2, cursor });
        for (const u of page.items) seen.add(u.id);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      const [{ count } = { count: 0 }] = await handle.sql<
        { count: number }[]
      >`select count(*)::int as count from users`;
      expect(seen.size).toBe(count);
    });
  });

  describe('CachedSessionRepository', () => {
    it('caches lookups and evicts on revoke so every instance sees revocation', async () => {
      const users = new DrizzleUserRepository(handle.db, encryptor);
      const user = newUser('sess@sipocot.gov.ph');
      await users.save(user);
      const inner = new DrizzleSessionRepository(handle.db);
      const repo = new CachedSessionRepository(inner, redis, clock, logger);

      const s = Session.start({
        id: asSessionId(uuidv7()),
        userId: user.id,
        tokenHash: randomBytes(32).toString('hex'),
        ip: '203.0.113.1',
        userAgent: 'it',
        now: clock.now(),
        policy: DEFAULT_SESSION_POLICY,
      });
      await repo.create(s);
      expect(await redis.exists(`sess:${s.tokenHash}`)).toBe(1);
      expect((await repo.findByTokenHash(s.tokenHash))?.id).toBe(s.id);

      expect(await repo.revokeAllForUser(user.id, clock.now())).toBe(1);
      expect(await redis.exists(`sess:${s.tokenHash}`)).toBe(0);
      expect((await repo.findByTokenHash(s.tokenHash))?.isActive(clock.now())).toBe(false);
    });

    it('purges ended sessions', async () => {
      const inner = new DrizzleSessionRepository(handle.db);
      const purged = await inner.purgeEndedBefore(new Date(clock.now().getTime() + 365 * 86_400_000));
      expect(purged).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DrizzleFileRepository', () => {
    it('upserts status changes', async () => {
      const users = new DrizzleUserRepository(handle.db, encryptor);
      const owner = newUser('files@sipocot.gov.ph');
      await users.save(owner);
      const repo = new DrizzleFileRepository(handle.db);
      const f = StoredFile.request({
        id: asFileId(uuidv7()),
        ownerId: owner.id,
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 10,
        now: clock.now(),
      });
      if (!f.ok) throw f.error;
      await repo.save(f.value);
      f.value.confirm({ sizeBytes: 10, contentType: 'application/pdf' }, clock.now());
      await repo.save(f.value);
      expect((await repo.findById(f.value.id))?.status).toBe('available');
      expect((await repo.listByOwner(owner.id, { limit: 10 })).items).toHaveLength(1);
    });
  });

  describe('audit trail', () => {
    it('is append-only at the database level', async () => {
      const pub = new DrizzleAuditPublisher(handle.db, { next: uuidv7 }, logger);
      await pub.publish([{ type: 'test.event', aggregateId: 'x', occurredAt: clock.now(), payload: { a: 1 } }], {
        requestId: 'r',
      });
      await expect(handle.sql`update audit_events set type = 'tampered'`).rejects.toThrow(/append-only/);
      await expect(handle.sql`delete from audit_events`).rejects.toThrow(/append-only/);
    });
  });

  describe('RedisRateLimiter', () => {
    it('counts atomically within a window and hashes keys', async () => {
      const rl = new RedisRateLimiter(redis, logger);
      const policy = { name: `it-${uuidv7()}`, limit: 3, windowSeconds: 60, failMode: 'closed' } as const;
      const results = await Promise.all(Array.from({ length: 5 }, () => rl.consume(policy, 'juan@sipocot.gov.ph')));
      expect(results.filter((r) => r.allowed)).toHaveLength(3);
      const keys = await redis.keys(`*rl:${policy.name}:*`);
      expect(keys.join()).not.toContain('juan');
    });

    it('fails closed / open according to policy when Redis is unreachable', async () => {
      const dead = new Redis('redis://127.0.0.1:1', {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });
      const rl = new RedisRateLimiter(dead, logger);
      expect((await rl.consume({ name: 'c', limit: 1, windowSeconds: 1, failMode: 'closed' }, 'k')).allowed).toBe(
        false,
      );
      expect((await rl.consume({ name: 'o', limit: 1, windowSeconds: 1, failMode: 'open' }, 'k')).allowed).toBe(true);
      dead.disconnect();
    });
  });
});
