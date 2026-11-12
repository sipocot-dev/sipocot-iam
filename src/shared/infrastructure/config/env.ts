import { z } from 'zod';

const csv = z.string().transform((s) =>
  s
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean),
);

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be a base64-encoded 32-byte key');

/**
 * Single source of truth for configuration. Validated once, at first use, so a
 * misconfigured deployment fails fast and loudly instead of half-working.
 */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'test', 'preview', 'staging', 'production']).default('local'),
    APP_NAME: z.string().default('sipocot-iam'),
    APP_VERSION: z.string().optional(),
    APP_URL: z.url(),
    /** Origins allowed to make cookie-authenticated state-changing requests (CSRF) and CORS. */
    ALLOWED_ORIGINS: csv.optional(),
    /** Trust X-Forwarded-For / X-Real-IP (true on Vercel and behind an ingress). */
    TRUST_PROXY: z.stringbool().default(true),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    DATABASE_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /** Disable for PgBouncer / Supabase / Neon transaction poolers. */
    DATABASE_PREPARE: z.stringbool().default(true),

    REDIS_URL: z.url(),
    REDIS_KEY_PREFIX: z.string().default('sipocot-iam:'),

    /** `keyId:base64,keyId:base64` — older keys stay for decryption during rotation. */
    ENCRYPTION_KEYS: z.string().transform((raw, ctx) => {
      const map = new Map<string, Buffer>();
      for (const entry of raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)) {
        const [id, key] = entry.split(':');
        if (!id || !key || !/^[a-z0-9]{1,16}$/i.test(id) || !base64Key32.safeParse(key).success) {
          ctx.addIssue({ code: 'custom', message: `invalid key entry "${id ?? ''}"` });
          return z.NEVER;
        }
        map.set(id, Buffer.from(key, 'base64'));
      }
      if (map.size === 0) ctx.addIssue({ code: 'custom', message: 'at least one key required' });
      return map;
    }),
    ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
    /** Optional argon2 secret ("pepper"), kept outside the database. */
    PASSWORD_PEPPER: base64Key32.optional(),

    SESSION_ABSOLUTE_TTL_HOURS: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 90)
      .default(24 * 7),
    SESSION_IDLE_TTL_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(60 * 24 * 30)
      .default(120),
    LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(50).default(5),
    LOCKOUT_DURATION_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .default(15),

    S3_BUCKET: z.string().min(3),
    S3_REGION: z.string().default('ap-southeast-1'),
    /** Set for MinIO / R2 / other S3-compatible stores. */
    S3_ENDPOINT: z.url().optional(),
    /** Public endpoint used in presigned URLs when it differs from S3_ENDPOINT (e.g. MinIO in docker). */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    /** Omit to use the default AWS credential chain (IRSA / workload identity in Kubernetes). */
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_SSE: z.enum(['none', 'AES256', 'aws:kms']).default('AES256'),
    S3_KMS_KEY_ID: z.string().optional(),
    S3_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

    /** Bearer token protecting /api/metrics. Required in production. */
    METRICS_TOKEN: z.string().min(24).optional(),
    /** Bearer token for scheduled jobs (Vercel Cron sends `Authorization: Bearer $CRON_SECRET`). */
    CRON_SECRET: z.string().min(24).optional(),
    SESSION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  })
  .superRefine((env, ctx) => {
    if (!env.ENCRYPTION_KEYS.has(env.ENCRYPTION_ACTIVE_KEY_ID)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ENCRYPTION_ACTIVE_KEY_ID'],
        message: 'must reference a key in ENCRYPTION_KEYS',
      });
    }
    if (env.S3_SSE === 'aws:kms' && !env.S3_KMS_KEY_ID) {
      ctx.addIssue({ code: 'custom', path: ['S3_KMS_KEY_ID'], message: 'required when S3_SSE=aws:kms' });
    }
    if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SECRET_ACCESS_KEY'],
        message: 'set both S3 access key variables or neither',
      });
    }
    if (env.APP_ENV === 'production') {
      if (!env.METRICS_TOKEN)
        ctx.addIssue({ code: 'custom', path: ['METRICS_TOKEN'], message: 'required in production' });
      if (!env.APP_URL.startsWith('https://'))
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must be https in production' });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function loadEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Only names and messages — never values.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function getEnv(): Env {
  cached ??= loadEnv();
  return cached;
}

export const appVersion = (env: Env): string =>
  env.APP_VERSION ?? process.env['VERCEL_GIT_COMMIT_SHA']?.slice(0, 12) ?? 'dev';
