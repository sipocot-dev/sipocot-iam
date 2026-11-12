import { hasPermission, requirePermission, type Actor } from '@/shared/application/actor';
import { AppError, err, ok, type Result, type SessionId, type UserId } from '@/shared/domain';
import type { IdentityDeps } from '../deps';
import { toSessionView, type SessionView } from '../dto';
import { IdentityErrors } from '../errors';

type Deps = Pick<IdentityDeps, 'sessions' | 'clock'>;

export class ListSessions {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    actor: Actor;
    userId?: UserId | undefined;
  }): Promise<Result<readonly SessionView[], AppError>> {
    const target = input.userId ?? input.actor.userId;
    if (target !== input.actor.userId) requirePermission(input.actor, 'sessions:read_any');
    const list = await this.deps.sessions.listActiveByUser(target, this.deps.clock.now());
    return ok(list.map((s) => toSessionView(s, input.actor.sessionId)));
  }
}

/** Housekeeping: keep ended sessions for `retentionDays` (forensics), then delete them. */
export class PurgeEndedSessions {
  constructor(private readonly deps: Deps) {}

  async execute(input: { retentionDays: number }): Promise<Result<{ purged: number }, AppError>> {
    const cutoff = new Date(this.deps.clock.now().getTime() - input.retentionDays * 86_400_000);
    return ok({ purged: await this.deps.sessions.purgeEndedBefore(cutoff) });
  }
}

export class RevokeSession {
  constructor(private readonly deps: Deps) {}

  async execute(input: { actor: Actor; sessionId: SessionId }): Promise<Result<void, AppError>> {
    const session = await this.deps.sessions.findById(input.sessionId);
    // Do not disclose existence of other users' sessions.
    if (!session) return err(IdentityErrors.sessionNotFound());
    if (session.userId !== input.actor.userId && !hasPermission(input.actor, 'sessions:revoke_any')) {
      return err(IdentityErrors.sessionNotFound());
    }
    if (session.id === input.actor.sessionId) {
      return err(AppError.conflict('identity.revoke_current_session', 'Use logout to end the current session'));
    }
    session.revoke(this.deps.clock.now());
    await this.deps.sessions.save(session);
    return ok(undefined);
  }
}
