import type { Actor, RequestMeta } from '@/shared/application/actor';
import { AppError, err, ok, type Result } from '@/shared/domain';
import { PlainPassword } from '../../domain';
import type { IdentityDeps } from '../deps';
import { IdentityErrors } from '../errors';

export interface ChangePasswordInput {
  readonly actor: Actor;
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly meta: RequestMeta;
}

export class ChangePassword {
  constructor(private readonly deps: Pick<IdentityDeps, 'users' | 'sessions' | 'hasher' | 'events' | 'clock'>) {}

  /** Changes the password and revokes every *other* session of the user. */
  async execute(input: ChangePasswordInput): Promise<Result<{ revokedSessions: number }, AppError>> {
    const { users, sessions, hasher, events, clock } = this.deps;
    const user = await users.findById(input.actor.userId);
    if (!user) return err(IdentityErrors.userNotFound());

    if (!(await hasher.verify(user.passwordHash, input.currentPassword))) {
      return err(
        AppError.validation('identity.current_password_mismatch', 'Current password is incorrect', {
          field: 'currentPassword',
        }),
      );
    }
    const next = PlainPassword.create(input.newPassword, { email: user.email });
    if (!next.ok) return next;
    if (await hasher.verify(user.passwordHash, next.value)) {
      return err(
        AppError.validation('identity.password_reused', 'New password must differ from the current one', {
          field: 'newPassword',
        }),
      );
    }

    const now = clock.now();
    user.changePassword(await hasher.hash(next.value), now);
    await users.save(user);
    const revoked = await sessions.revokeAllForUser(user.id, now, input.actor.sessionId);
    await events.publish(user.pullEvents(), { actorId: user.id, ip: input.meta.ip, requestId: input.meta.requestId });
    return ok({ revokedSessions: revoked });
  }
}
