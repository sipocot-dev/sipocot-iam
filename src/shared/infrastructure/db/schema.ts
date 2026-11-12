import { sql } from 'drizzle-orm';
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull().unique('users_email_key'),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    /** AES-256-GCM ciphertext (see AesGcmEncryptor). */
    phoneEncrypted: text('phone_encrypted'),
    status: text('status', { enum: ['active', 'disabled'] })
      .notNull()
      .default('active'),
    roles: text('roles')
      .array()
      .notNull()
      .default(sql`ARRAY['member']::text[]`),
    failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
    lockedUntil: tstz('locked_until'),
    lastLoginAt: tstz('last_login_at'),
    passwordChangedAt: tstz('password_changed_at').notNull(),
    createdAt: tstz('created_at').notNull(),
    updatedAt: tstz('updated_at').notNull(),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    check('users_status_valid', sql`${t.status} in ('active', 'disabled')`),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique('sessions_token_hash_key'),
    createdAt: tstz('created_at').notNull(),
    lastSeenAt: tstz('last_seen_at').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    idleExpiresAt: tstz('idle_expires_at').notNull(),
    revokedAt: tstz('revoked_at'),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    index('sessions_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    objectKey: text('object_key').notNull().unique('files_object_key_key'),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    status: text('status', { enum: ['pending', 'available'] }).notNull(),
    createdAt: tstz('created_at').notNull(),
    uploadedAt: tstz('uploaded_at'),
  },
  (t) => [index('files_owner_idx').on(t.ownerId, t.id)],
);

/** Append-only. Grant the app role INSERT/SELECT only (see docs/security.md). */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    type: text('type').notNull(),
    aggregateId: text('aggregate_id').notNull(),
    actorId: uuid('actor_id'),
    ip: text('ip'),
    requestId: text('request_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: tstz('occurred_at').notNull(),
  },
  (t) => [
    index('audit_aggregate_idx').on(t.aggregateId, t.occurredAt),
    index('audit_type_idx').on(t.type, t.occurredAt),
  ],
);

export const schema = { users, sessions, files, auditEvents };
