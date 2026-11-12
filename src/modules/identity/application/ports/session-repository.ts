import type { SessionId, UserId } from '@/shared/domain';
import type { Session } from '../../domain';

export interface SessionRepository {
  create(session: Session): Promise<void>;
  save(session: Session): Promise<void>;
  findById(id: SessionId): Promise<Session | null>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  listActiveByUser(userId: UserId, now: Date): Promise<readonly Session[]>;
  /** Revokes every active session of the user (optionally sparing one). Returns count revoked. */
  revokeAllForUser(userId: UserId, now: Date, except?: SessionId): Promise<number>;
  /** Hard-deletes sessions that expired or were revoked before `cutoff`. Returns count. */
  purgeEndedBefore(cutoff: Date): Promise<number>;
}
