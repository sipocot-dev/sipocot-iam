import { AppError } from '@/shared/domain';

export const IdentityErrors = {
  invalidCredentials: () => new AppError('unauthenticated', 'auth.invalid_credentials', 'Invalid email or password'),
  sessionInvalid: () => new AppError('unauthenticated', 'auth.session_invalid', 'Session is invalid or expired'),
  emailTaken: () => AppError.conflict('identity.email_taken', 'An account with this email already exists'),
  userNotFound: () => AppError.notFound('identity.user_not_found', 'User not found'),
  sessionNotFound: () => AppError.notFound('identity.session_not_found', 'Session not found'),
  cannotModifySelf: (what: string) =>
    AppError.conflict('identity.self_modification', `You cannot ${what} your own account`),
  concurrentModification: () =>
    AppError.conflict('identity.concurrent_modification', 'The resource was modified concurrently, retry'),
} as const;
