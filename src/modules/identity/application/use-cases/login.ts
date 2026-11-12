import type { RequestMeta } from '@/shared/application/actor';
import { asSessionId, err, ok, type AppError, type Result } from '@/shared/domain';
import { Email, Session, type PasswordHash, type PlainPassword } from '../../domain';
import type { IdentityDeps } from '../deps';
import { toUserView, type UserView } from '../dto';
import { IdentityErrors } from '../errors';

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly meta: RequestMeta;
}

export interface LoginOutput {
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: UserView;
}

export class Login {
  #dummyHash: Promise<PasswordHash> | undefined;

  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: LoginInput): Promise<Result<LoginOutput, AppError>> {
    const { users, hasher, clock, events, sessions, tokens, ids, sessionPolicy, lockoutPolicy } = this.deps;
    const ctx = { ip: input.meta.ip, requestId: input.meta.requestId };
    const now = clock.now();

    const email = Email.create(input.email);
    const user = email.ok ? await users.findByEmail(email.value) : null;

    if (!user) {
      // Equalise timing so response latency does not reveal whether the account exists.
      await hasher.verify(await this.dummyHash(), input.password);
      return err(IdentityErrors.invalidCredentials());
    }

    const block = user.authenticationBlock(now);
    if (block) {
      await hasher.verify(await this.dummyHash(), input.password);
      user.recordBlockedLogin(block, now);
      await events.publish(user.pullEvents(), { ...ctx, actorId: user.id });
      return err(IdentityErrors.invalidCredentials());
    }

    if (!(await hasher.verify(user.passwordHash, input.password))) {
      user.recordFailedLogin(now, lockoutPolicy);
      await users.save(user);
      await events.publish(user.pullEvents(), { ...ctx, actorId: user.id });
      return err(IdentityErrors.invalidCredentials());
    }

    if (hasher.needsRehash(user.passwordHash)) {
      user.upgradePasswordHash(await hasher.hash(input.password as PlainPassword) /* verified above */, now);
    }

    const issued = tokens.issue();
    const session = Session.start({
      id: asSessionId(ids.next()),
      userId: user.id,
      tokenHash: issued.hash,
      ip: input.meta.ip ?? null,
      userAgent: input.meta.userAgent ?? null,
      now,
      policy: sessionPolicy,
    });
    await sessions.create(session);
    user.recordSuccessfulLogin(session.id, now);
    await users.save(user);
    await events.publish(user.pullEvents(), { ...ctx, actorId: user.id });

    return ok({ token: issued.token, expiresAt: session.effectiveExpiry(), user: toUserView(user) });
  }

  private dummyHash(): Promise<PasswordHash> {
    this.#dummyHash ??= this.deps.hasher.hash('timing-equalisation-dummy-password' as PlainPassword);
    return this.#dummyHash;
  }
}
