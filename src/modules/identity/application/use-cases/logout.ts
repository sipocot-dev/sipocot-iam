import type { Actor } from '@/shared/application/actor';
import { ok, type AppError, type Result } from '@/shared/domain';
import type { IdentityDeps } from '../deps';

export class Logout {
  constructor(private readonly deps: Pick<IdentityDeps, 'sessions' | 'clock'>) {}

  async execute(input: { actor: Actor; allDevices?: boolean }): Promise<Result<{ revoked: number }, AppError>> {
    const now = this.deps.clock.now();
    if (input.allDevices) {
      return ok({ revoked: await this.deps.sessions.revokeAllForUser(input.actor.userId, now) });
    }
    const session = await this.deps.sessions.findById(input.actor.sessionId);
    if (!session) return ok({ revoked: 0 });
    session.revoke(now);
    await this.deps.sessions.save(session);
    return ok({ revoked: 1 });
  }
}
