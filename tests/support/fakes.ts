import { createHash } from 'node:crypto';
import type { Actor } from '@/shared/application/actor';
import type { Page, PageRequest } from '@/shared/application/pagination';
import type { Clock, EventContext, EventPublisher, IdGenerator, LogFields, Logger } from '@/shared/application/ports';
import {
  AppError,
  asSessionId,
  asUserId,
  permissionsFor,
  type DomainEvent,
  type FileId,
  type RoleName,
  type SessionId,
  type UserId,
} from '@/shared/domain';
import type {
  IdentityDeps,
  PasswordHasher,
  SessionRepository,
  SessionTokenService,
  UserRepository,
} from '@/modules/identity/application';
import {
  DEFAULT_LOCKOUT_POLICY,
  DEFAULT_SESSION_POLICY,
  DisplayName,
  Email,
  PasswordHash,
  Session,
  User,
  type PlainPassword,
} from '@/modules/identity/domain';
import type { FileRepository, ObjectStorage, PresignedDownload, PresignedUpload } from '@/modules/storage/application';
import { StoredFile } from '@/modules/storage/domain';

export class FixedClock implements Clock {
  constructor(public current = new Date('2026-01-15T08:00:00.000Z')) {}
  now(): Date {
    return new Date(this.current);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export class SequentialIds implements IdGenerator {
  #n = 0;
  next(): string {
    this.#n += 1;
    return '00000000-0000-7000-8000-' + this.#n.toString().padStart(12, '0');
  }
}

export class RecordingEvents implements EventPublisher {
  readonly published: { event: DomainEvent; ctx: EventContext }[] = [];
  publish(events: readonly DomainEvent[], ctx: EventContext): Promise<void> {
    for (const event of events) this.published.push({ event, ctx });
    return Promise.resolve();
  }
  types(): string[] {
    return this.published.map((p) => p.event.type);
  }
}

export class SilentLogger implements Logger {
  readonly lines: { level: string; msg: string; fields?: LogFields | undefined }[] = [];
  debug(msg: string, fields?: LogFields): void {
    this.lines.push({ level: 'debug', msg, fields });
  }
  info(msg: string, fields?: LogFields): void {
    this.lines.push({ level: 'info', msg, fields });
  }
  warn(msg: string, fields?: LogFields): void {
    this.lines.push({ level: 'warn', msg, fields });
  }
  error(msg: string, fields?: LogFields): void {
    this.lines.push({ level: 'error', msg, fields });
  }
  child(): Logger {
    return this;
  }
}

/** Deterministic, fast stand-in for argon2. `old$` prefixed hashes simulate outdated parameters. */
export class FakeHasher implements PasswordHasher {
  verifyCalls = 0;
  hash(p: PlainPassword): Promise<PasswordHash> {
    return Promise.resolve(PasswordHash.fromTrusted('fake$' + p));
  }
  verify(h: PasswordHash, candidate: string): Promise<boolean> {
    this.verifyCalls += 1;
    return Promise.resolve(h === 'fake$' + candidate || h === 'old$' + candidate);
  }
  needsRehash(h: PasswordHash): boolean {
    return h.startsWith('old$');
  }
}

export class FakeTokens implements SessionTokenService {
  #n = 0;
  issue(): { token: string; hash: string } {
    this.#n += 1;
    const token = 'tok_' + this.#n.toString().padStart(40, '0');
    return { token, hash: this.hash(token) };
  }
  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}

type UserSnap = ReturnType<User['toSnapshot']>;
type SessionSnap = ReturnType<Session['toSnapshot']>;

/** Persists snapshots (not live objects) so tests catch a missing `save` call. */
export class InMemoryUsers implements UserRepository {
  readonly rows = new Map<string, UserSnap>();

  findById(id: UserId): Promise<User | null> {
    const r = this.rows.get(id);
    return Promise.resolve(r ? User.rehydrate(r.id, { ...r }) : null);
  }
  findByEmail(email: Email): Promise<User | null> {
    const r = [...this.rows.values()].find((u) => u.email === email);
    return Promise.resolve(r ? User.rehydrate(r.id, { ...r }) : null);
  }
  save(user: User): Promise<void> {
    const s = user.toSnapshot();
    const existing = this.rows.get(s.id);
    if (existing && existing.version !== s.version) {
      return Promise.reject(AppError.conflict('identity.concurrent_modification', 'conflict'));
    }
    if (!existing && [...this.rows.values()].some((u) => u.email === s.email)) {
      return Promise.reject(AppError.conflict('identity.email_taken', 'taken'));
    }
    this.rows.set(s.id, { ...s, version: s.version + 1 });
    return Promise.resolve();
  }
  list(page: PageRequest): Promise<Page<User>> {
    const all = [...this.rows.values()].sort((a, b) => (a.id < b.id ? 1 : -1));
    const start = page.cursor ? all.findIndex((u) => u.id === page.cursor) + 1 : 0;
    const items = all.slice(start, start + page.limit).map((r) => User.rehydrate(r.id, { ...r }));
    const more = all.length > start + page.limit;
    return Promise.resolve({ items, nextCursor: more ? (items.at(-1)?.id ?? null) : null });
  }
}

const loadSession = (s: SessionSnap): Session => Session.rehydrate(s.id, { ...s });

export class InMemorySessions implements SessionRepository {
  readonly rows = new Map<string, SessionSnap>();

  create(session: Session): Promise<void> {
    this.rows.set(session.id, session.toSnapshot());
    return Promise.resolve();
  }
  save(session: Session): Promise<void> {
    this.rows.set(session.id, session.toSnapshot());
    return Promise.resolve();
  }
  findById(id: SessionId): Promise<Session | null> {
    const r = this.rows.get(id);
    return Promise.resolve(r ? loadSession(r) : null);
  }
  findByTokenHash(hash: string): Promise<Session | null> {
    const r = [...this.rows.values()].find((s) => s.tokenHash === hash);
    return Promise.resolve(r ? loadSession(r) : null);
  }
  listActiveByUser(userId: UserId, now: Date): Promise<readonly Session[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((s) => s.userId === userId)
        .map(loadSession)
        .filter((s) => s.isActive(now)),
    );
  }
  revokeAllForUser(userId: UserId, now: Date, except?: SessionId): Promise<number> {
    let n = 0;
    for (const r of this.rows.values()) {
      if (r.userId === userId && r.revokedAt === null && r.id !== except) {
        this.rows.set(r.id, { ...r, revokedAt: now });
        n += 1;
      }
    }
    return Promise.resolve(n);
  }
  purgeEndedBefore(cutoff: Date): Promise<number> {
    let n = 0;
    for (const [id, r] of this.rows) {
      const ended = [r.expiresAt, r.idleExpiresAt, r.revokedAt].some((d) => d !== null && d < cutoff);
      if (ended) {
        this.rows.delete(id);
        n += 1;
      }
    }
    return Promise.resolve(n);
  }
}

export class InMemoryFiles implements FileRepository {
  readonly rows = new Map<string, StoredFile>();
  save(file: StoredFile): Promise<void> {
    this.rows.set(file.id, StoredFile.rehydrate(file.id, { ...file.toSnapshot() }));
    return Promise.resolve();
  }
  findById(id: FileId): Promise<StoredFile | null> {
    const f = this.rows.get(id);
    return Promise.resolve(f ? StoredFile.rehydrate(f.id, { ...f.toSnapshot() }) : null);
  }
  listByOwner(ownerId: UserId, page: PageRequest): Promise<Page<StoredFile>> {
    const items = [...this.rows.values()].filter((f) => f.ownerId === ownerId).slice(0, page.limit);
    return Promise.resolve({ items, nextCursor: null });
  }
}

export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { sizeBytes: number; contentType: string }>();
  presignUpload(i: { key: string; contentType: string }): Promise<PresignedUpload> {
    return Promise.resolve({
      url: 'https://s3.test/bucket',
      method: 'POST',
      fields: { key: i.key, 'Content-Type': i.contentType },
      expiresAt: new Date(),
    });
  }
  presignDownload(i: { key: string }): Promise<PresignedDownload> {
    return Promise.resolve({ url: 'https://s3.test/bucket/' + i.key + '?sig=x', expiresAt: new Date() });
  }
  head(key: string): Promise<{ sizeBytes: number; contentType: string } | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
}

/** Concrete fakes (not port types) so tests can inspect state; still satisfies IdentityDeps. */
export function identityDeps() {
  const deps = {
    users: new InMemoryUsers(),
    sessions: new InMemorySessions(),
    hasher: new FakeHasher(),
    tokens: new FakeTokens(),
    events: new RecordingEvents(),
    clock: new FixedClock(),
    ids: new SequentialIds(),
    logger: new SilentLogger(),
    sessionPolicy: DEFAULT_SESSION_POLICY,
    lockoutPolicy: DEFAULT_LOCKOUT_POLICY,
  };
  return deps satisfies IdentityDeps;
}

export const meta = { requestId: 'req-test-0001', ip: '203.0.113.7', userAgent: 'vitest' };

export const DEFAULT_PASSWORD = 'correct horse battery';

export function makeUser(
  input: { id?: string; email?: string; password?: string; roles?: RoleName[]; now?: Date } = {},
): User {
  const user = User.register({
    id: asUserId(input.id ?? '00000000-0000-7000-8000-00000000aaaa'),
    email: Email.fromTrusted(input.email ?? 'juan@sipocot.gov.ph'),
    passwordHash: PasswordHash.fromTrusted('fake$' + (input.password ?? DEFAULT_PASSWORD)),
    displayName: DisplayName.fromTrusted('Juan Dela Cruz'),
    phone: null,
    roles: input.roles ?? ['member'],
    now: input.now ?? new Date('2026-01-01T00:00:00Z'),
  });
  user.pullEvents();
  return user;
}

export function actorFor(user: User, sessionId = '00000000-0000-7000-8000-0000000000ff'): Actor {
  return {
    userId: user.id,
    sessionId: asSessionId(sessionId),
    roles: user.roles,
    permissions: permissionsFor(user.roles),
  };
}

export const actorWithRoles = (roles: RoleName[], userId = '00000000-0000-7000-8000-00000000beef'): Actor => ({
  userId: asUserId(userId),
  sessionId: asSessionId('00000000-0000-7000-8000-0000000000fe'),
  roles: new Set(roles),
  permissions: permissionsFor(roles),
});
