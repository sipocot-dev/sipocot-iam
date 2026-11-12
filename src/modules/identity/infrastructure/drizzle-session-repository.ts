import { and, desc, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import { asSessionId, asUserId, type SessionId, type UserId } from '@/shared/domain';
import type { Database } from '@/shared/infrastructure/db/client';
import { sessions } from '@/shared/infrastructure/db/schema';
import type { SessionRepository } from '../application/ports';
import { Session } from '../domain';

type Row = typeof sessions.$inferSelect;

export const sessionToDomain = (row: Row): Session =>
  Session.rehydrate(asSessionId(row.id), {
    userId: asUserId(row.userId),
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    idleExpiresAt: row.idleExpiresAt,
    revokedAt: row.revokedAt,
    ip: row.ip,
    userAgent: row.userAgent,
  });

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly db: Database) {}

  async create(session: Session): Promise<void> {
    await this.db.insert(sessions).values(session.toSnapshot());
  }

  async save(session: Session): Promise<void> {
    const s = session.toSnapshot();
    await this.db
      .update(sessions)
      .set({ lastSeenAt: s.lastSeenAt, idleExpiresAt: s.idleExpiresAt, revokedAt: s.revokedAt })
      .where(eq(sessions.id, s.id));
  }

  async findById(id: SessionId): Promise<Session | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
    return row ? sessionToDomain(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
    return row ? sessionToDomain(row) : null;
  }

  async listActiveByUser(userId: UserId, now: Date): Promise<readonly Session[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          gt(sessions.idleExpiresAt, now),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt))
      .limit(100);
    return rows.map(sessionToDomain);
  }

  async revokeAllForUser(userId: UserId, now: Date, except?: SessionId): Promise<number> {
    return (await this.revokeAllReturningHashes(userId, now, except)).length;
  }

  async purgeEndedBefore(cutoff: Date): Promise<number> {
    const rows = await this.db
      .delete(sessions)
      .where(or(lt(sessions.expiresAt, cutoff), lt(sessions.idleExpiresAt, cutoff), lt(sessions.revokedAt, cutoff)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  /** Used by the cache decorator to invalidate exactly the affected cache entries. */
  async revokeAllReturningHashes(userId: UserId, now: Date, except?: SessionId): Promise<string[]> {
    const rows = await this.db
      .update(sessions)
      .set({ revokedAt: now })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), except ? ne(sessions.id, except) : undefined))
      .returning({ tokenHash: sessions.tokenHash });
    return rows.map((r) => r.tokenHash);
  }
}
