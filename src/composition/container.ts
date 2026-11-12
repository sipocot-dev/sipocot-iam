import 'server-only';
import type { Clock, EventPublisher, HealthCheck, IdGenerator, Logger, RateLimiter } from '@/shared/application/ports';
import {
  AuthenticateSession,
  ChangePassword,
  ChangeUserRole,
  GetUser,
  ListSessions,
  ListUsers,
  Login,
  PurgeEndedSessions,
  Logout,
  RegisterUser,
  RevokeSession,
  SetUserStatus,
  UpdateProfile,
  type IdentityDeps,
} from '@/modules/identity/application';
import { Argon2PasswordHasher } from '@/modules/identity/infrastructure/argon2-password-hasher';
import { CachedSessionRepository } from '@/modules/identity/infrastructure/cached-session-repository';
import { CryptoSessionTokenService } from '@/modules/identity/infrastructure/crypto-session-token-service';
import { DrizzleSessionRepository } from '@/modules/identity/infrastructure/drizzle-session-repository';
import { DrizzleUserRepository } from '@/modules/identity/infrastructure/drizzle-user-repository';
import {
  ConfirmUpload,
  GetDownloadUrl,
  ListMyFiles,
  RequestUpload,
  type StorageDeps,
} from '@/modules/storage/application';
import { DrizzleFileRepository } from '@/modules/storage/infrastructure/drizzle-file-repository';
import { S3ObjectStorage } from '@/modules/storage/infrastructure/s3-object-storage';
import { DrizzleAuditPublisher } from '@/shared/infrastructure/audit/drizzle-audit-publisher';
import { appVersion, getEnv, type Env } from '@/shared/infrastructure/config/env';
import { AesGcmEncryptor } from '@/shared/infrastructure/crypto/aes-gcm-encryptor';
import { createDatabase, type DatabaseHandle } from '@/shared/infrastructure/db/client';
import { createLogger } from '@/shared/infrastructure/logging/pino-logger';
import { postgresHealthCheck, redisHealthCheck } from '@/shared/infrastructure/observability/health-checks';
import { getMetrics, type Metrics } from '@/shared/infrastructure/observability/metrics';
import { RedisRateLimiter } from '@/shared/infrastructure/rate-limit/redis-rate-limiter';
import { createRedis } from '@/shared/infrastructure/redis/client';
import { SystemClock } from '@/shared/infrastructure/system/system-clock';
import { UuidV7Generator } from '@/shared/infrastructure/system/uuid-v7';

export interface Container {
  readonly env: Env;
  readonly version: string;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly clock: Clock;
  readonly rateLimiter: RateLimiter;
  readonly healthChecks: readonly HealthCheck[];
  readonly identity: {
    readonly register: RegisterUser;
    readonly login: Login;
    readonly authenticate: AuthenticateSession;
    readonly logout: Logout;
    readonly changePassword: ChangePassword;
    readonly getUser: GetUser;
    readonly listUsers: ListUsers;
    readonly updateProfile: UpdateProfile;
    readonly changeRole: ChangeUserRole;
    readonly setStatus: SetUserStatus;
    readonly listSessions: ListSessions;
    readonly revokeSession: RevokeSession;
    readonly purgeSessions: PurgeEndedSessions;
  };
  readonly storage: {
    readonly requestUpload: RequestUpload;
    readonly confirmUpload: ConfirmUpload;
    readonly downloadUrl: GetDownloadUrl;
    readonly listMine: ListMyFiles;
  };
  shutdown(): Promise<void>;
}

/** Composition root: the only place that knows concrete adapters. */
export function buildContainer(env: Env): Container {
  const version = appVersion(env);
  const logger = createLogger({
    level: env.LOG_LEVEL,
    service: env.APP_NAME,
    env: env.APP_ENV,
    version,
    pretty: env.NODE_ENV === 'development',
  });
  const metrics = getMetrics();
  const clock = new SystemClock();
  const ids: IdGenerator = new UuidV7Generator();

  const database: DatabaseHandle = createDatabase({
    url: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    prepare: env.DATABASE_PREPARE,
    appName: env.APP_NAME,
  });
  const redis = createRedis({ url: env.REDIS_URL, keyPrefix: env.REDIS_KEY_PREFIX });
  redis.on('error', (e: Error) => {
    logger.warn('redis error', { error: e.message });
  });

  const encryptor = new AesGcmEncryptor(env.ENCRYPTION_KEYS, env.ENCRYPTION_ACTIVE_KEY_ID);
  const events: EventPublisher = new DrizzleAuditPublisher(database.db, ids, logger);
  const rateLimiter = new RedisRateLimiter(redis, logger);

  const identityDeps: IdentityDeps = {
    users: new DrizzleUserRepository(database.db, encryptor),
    sessions: new CachedSessionRepository(new DrizzleSessionRepository(database.db), redis, clock, logger),
    hasher: new Argon2PasswordHasher(env.PASSWORD_PEPPER ? Buffer.from(env.PASSWORD_PEPPER, 'base64') : undefined),
    tokens: new CryptoSessionTokenService(),
    events,
    clock,
    ids,
    logger,
    sessionPolicy: {
      absoluteTtlMs: env.SESSION_ABSOLUTE_TTL_HOURS * 3_600_000,
      idleTtlMs: env.SESSION_IDLE_TTL_MINUTES * 60_000,
      touchIntervalMs: 60_000,
    },
    lockoutPolicy: {
      maxFailedAttempts: env.LOCKOUT_MAX_ATTEMPTS,
      lockDurationMs: env.LOCKOUT_DURATION_MINUTES * 60_000,
    },
  };

  const storageDeps: StorageDeps = {
    files: new DrizzleFileRepository(database.db),
    storage: new S3ObjectStorage(
      {
        bucket: env.S3_BUCKET,
        region: env.S3_REGION,
        endpoint: env.S3_ENDPOINT,
        publicEndpoint: env.S3_PUBLIC_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
        credentials:
          env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
            ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
            : undefined,
        sse: env.S3_SSE,
        kmsKeyId: env.S3_KMS_KEY_ID,
      },
      clock,
    ),
    clock,
    ids,
    urlTtlSeconds: env.S3_URL_TTL_SECONDS,
  };

  return {
    env,
    version,
    logger,
    metrics,
    clock,
    rateLimiter,
    healthChecks: [postgresHealthCheck(database.sql), redisHealthCheck(redis)],
    identity: {
      register: new RegisterUser(identityDeps),
      login: new Login(identityDeps),
      authenticate: new AuthenticateSession(identityDeps),
      logout: new Logout(identityDeps),
      changePassword: new ChangePassword(identityDeps),
      getUser: new GetUser(identityDeps),
      listUsers: new ListUsers(identityDeps),
      updateProfile: new UpdateProfile(identityDeps),
      changeRole: new ChangeUserRole(identityDeps),
      setStatus: new SetUserStatus(identityDeps),
      listSessions: new ListSessions(identityDeps),
      revokeSession: new RevokeSession(identityDeps),
      purgeSessions: new PurgeEndedSessions(identityDeps),
    },
    storage: {
      requestUpload: new RequestUpload(storageDeps),
      confirmUpload: new ConfirmUpload(storageDeps),
      downloadUrl: new GetDownloadUrl(storageDeps),
      listMine: new ListMyFiles(storageDeps),
    },
    async shutdown() {
      logger.info('shutting down');
      await Promise.allSettled([database.close(), redis.quit()]);
    },
  };
}

const g = globalThis as unknown as { __sipocotContainer?: Container };

/**
 * Lazily built on first request (so `next build` never needs secrets) and cached
 * on globalThis so dev-mode HMR and serverless warm starts reuse connections.
 */
export function getContainer(): Container {
  g.__sipocotContainer ??= buildContainer(getEnv());
  return g.__sipocotContainer;
}
