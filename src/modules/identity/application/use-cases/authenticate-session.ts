import type { Actor } from '@/shared/application/actor';
import { err, ok, type AppError, type Result } from '@/shared/domain';
import type { Session, User } from '../../domain';
import type { IdentityDeps } from '../deps';
import { IdentityErrors } from '../errors';

export interface AuthenticatedPrincipal {
  readonly actor: Actor;
  readonly user: User;
  readonly session: Session;
}

/** Resolves a raw bearer/cookie token into an authenticated principal (sliding expiry). */
export class AuthenticateSession {
  constructor(private readonly deps: Pick<IdentityDeps, 'sessions' | 'users' | 'tokens' | 'clock' | 'sessionPolicy'>) {}

  async execute(input: { token: string }): Promise<Result<AuthenticatedPrincipal, AppError>> {
    const { sessions, users, tokens, clock, sessionPolicy } = this.deps;
    if (input.token.length < 32 || input.token.length > 256) return err(IdentityErrors.sessionInvalid());

    const now = clock.now();
    const session = await sessions.findByTokenHash(tokens.hash(input.token));
    if (!session?.isActive(now)) return err(IdentityErrors.sessionInvalid());

    const user = await users.findById(session.userId);
    // Disabled or deleted account: kill the session immediately.
    if (user?.status !== 'active') {
      session.revoke(now);
      await sessions.save(session);
      return err(IdentityErrors.sessionInvalid());
    }

    if (session.touch(now, sessionPolicy)) await sessions.save(session);

    return ok({
      user,
      session,
      actor: { userId: user.id, sessionId: session.id, roles: user.roles, permissions: user.permissions },
    });
  }
}
