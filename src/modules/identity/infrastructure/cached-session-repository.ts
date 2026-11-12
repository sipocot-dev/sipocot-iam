import type { Redis } from 'ioredis';
import type { Clock, Logger } from '@/shared/application/ports';
import { asSessionId, asUserId, type SessionId, type UserId } from '@/shared/domain';
import type { SessionRepository } from '../application/ports';
import { Session } from '../domain';
import type { DrizzleSessionRepository } from './drizzle-session-repository';

const MAX_CACHE_SECONDS = 300;
const key = (tokenHash: string) => `sess:${tokenHash}`;

interface CachedSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  idleExpiresAt: string;
  revokedAt: string | null;
  ip: string | null;
  userAgent: string | null;
}

/**
 * Read-through Redis cache in front of Postgres for the hot path (`findByTokenHash`
 * on every authenticated request). Postgres stays the source of truth; every write
 * invalidates/refreshes the cache so revocation is effective across all instances.
 * Redis failures degrade to direct DB reads instead of failing requests.
 */
export class CachedSessionRepository implements SessionRepository {
  constructor(
    private readonly inner: DrizzleSessionRepository,
    private readonly redis: Redis,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async create(session: Session): Promise<void> {
    await this.inner.create(session);
    await this.put(session);
  }

  async save(session: Session): Promise<void> {
    await this.inner.save(session);
    if (session.revokedAt) await this.evict([session.tokenHash]);
    else await this.put(session);
  }

  findById(id: SessionId): Promise<Session | null> {
    return this.inner.findById(id);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    try {
      const raw = await this.redis.get(key(tokenHash));
      if (raw) return this.decode(raw);
    } catch (e) {
      this.logger.warn('session cache read failed', { error: (e as Error).message });
    }
    const session = await this.inner.findByTokenHash(tokenHash);
    if (session?.isActive(this.clock.now())) await this.put(session);
    return session;
  }

  listActiveByUser(userId: UserId, now: Date): Promise<readonly Session[]> {
    return this.inner.listActiveByUser(userId, now);
  }

  async revokeAllForUser(userId: UserId, now: Date, except?: SessionId): Promise<number> {
    const hashes = await this.inner.revokeAllReturningHashes(userId, now, except);
    await this.evict(hashes);
    return hashes.length;
  }

  /** Purged sessions are already ended, so their cache entries are gone or will expire on their own. */
  purgeEndedBefore(cutoff: Date): Promise<number> {
    return this.inner.purgeEndedBefore(cutoff);
  }

  private async put(session: Session): Promise<void> {
    const ttl = Math.min(
      MAX_CACHE_SECONDS,
      Math.floor((session.effectiveExpiry().getTime() - this.clock.now().getTime()) / 1000),
    );
    if (ttl <= 0) return;
    const s = session.toSnapshot();
    const payload: CachedSession = {
      id: s.id,
      userId: s.userId,
      tokenHash: s.tokenHash,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      idleExpiresAt: s.idleExpiresAt.toISOString(),
      revokedAt: s.revokedAt?.toISOString() ?? null,
      ip: s.ip,
      userAgent: s.userAgent,
    };
    try {
      await this.redis.set(key(s.tokenHash), JSON.stringify(payload), 'EX', ttl);
    } catch (e) {
      this.logger.warn('session cache write failed', { error: (e as Error).message });
    }
  }

  private async evict(hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return;
    try {
      await this.redis.del(...hashes.map(key));
    } catch (e) {
      // A stale entry lives at most MAX_CACHE_SECONDS; log loudly so it is visible.
      this.logger.error('session cache eviction failed', { error: (e as Error).message, count: hashes.length });
    }
  }

  private decode(raw: string): Session {
    const c = JSON.parse(raw) as CachedSession;
    return Session.rehydrate(asSessionId(c.id), {
      userId: asUserId(c.userId),
      tokenHash: c.tokenHash,
      createdAt: new Date(c.createdAt),
      lastSeenAt: new Date(c.lastSeenAt),
      expiresAt: new Date(c.expiresAt),
      idleExpiresAt: new Date(c.idleExpiresAt),
      revokedAt: c.revokedAt ? new Date(c.revokedAt) : null,
      ip: c.ip,
      userAgent: c.userAgent,
    });
  }
}
