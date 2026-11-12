import type { Clock, EventPublisher, IdGenerator, Logger } from '@/shared/application/ports';
import type { LockoutPolicy, SessionPolicy } from '../domain';
import type { PasswordHasher, SessionRepository, SessionTokenService, UserRepository } from './ports';

/** Everything the identity use cases need — wired in the composition root. */
export interface IdentityDeps {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly hasher: PasswordHasher;
  readonly tokens: SessionTokenService;
  readonly events: EventPublisher;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly logger: Logger;
  readonly sessionPolicy: SessionPolicy;
  readonly lockoutPolicy: LockoutPolicy;
}
