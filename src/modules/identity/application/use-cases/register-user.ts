import type { RequestMeta } from '@/shared/application/actor';
import { asUserId, err, ok, type AppError, type Result } from '@/shared/domain';
import { DisplayName, Email, PhoneNumber, PlainPassword, User } from '../../domain';
import type { IdentityDeps } from '../deps';
import { toUserView, type UserView } from '../dto';
import { IdentityErrors } from '../errors';

export interface RegisterUserInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly phone?: string | undefined;
  readonly meta: RequestMeta;
}

export class RegisterUser {
  constructor(private readonly deps: Pick<IdentityDeps, 'users' | 'hasher' | 'events' | 'clock' | 'ids'>) {}

  async execute(input: RegisterUserInput): Promise<Result<UserView, AppError>> {
    const email = Email.create(input.email);
    if (!email.ok) return email;
    const password = PlainPassword.create(input.password, { email: email.value });
    if (!password.ok) return password;
    const displayName = DisplayName.create(input.displayName);
    if (!displayName.ok) return displayName;
    let phone: PhoneNumber | null = null;
    if (input.phone !== undefined && input.phone !== '') {
      const parsed = PhoneNumber.create(input.phone);
      if (!parsed.ok) return parsed;
      phone = parsed.value;
    }

    if (await this.deps.users.findByEmail(email.value)) return err(IdentityErrors.emailTaken());

    const user = User.register({
      id: asUserId(this.deps.ids.next()),
      email: email.value,
      passwordHash: await this.deps.hasher.hash(password.value),
      displayName: displayName.value,
      phone,
      now: this.deps.clock.now(),
    });
    await this.deps.users.save(user);
    await this.deps.events.publish(user.pullEvents(), {
      actorId: user.id,
      ip: input.meta.ip,
      requestId: input.meta.requestId,
    });
    return ok(toUserView(user));
  }
}
