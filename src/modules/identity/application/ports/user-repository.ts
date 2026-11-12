import type { Page, PageRequest } from '@/shared/application/pagination';
import type { UserId } from '@/shared/domain';
import type { Email, User } from '../../domain';

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  /**
   * Insert (version 0) or update with optimistic locking.
   * Must throw `AppError.conflict('identity.email_taken')` on duplicate email and
   * `AppError.conflict('identity.concurrent_modification')` on version mismatch.
   */
  save(user: User): Promise<void>;
  list(page: PageRequest): Promise<Page<User>>;
}
