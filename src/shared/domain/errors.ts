/**
 * Transport-agnostic error categories. The interface layer maps each kind to a
 * protocol status (HTTP, gRPC, CLI exit code...). Domain code never sees HTTP.
 */
export type ErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'unavailable'
  | 'internal';

export type ErrorDetails = Readonly<Record<string, unknown>>;

export class AppError extends Error {
  override readonly name = 'AppError';

  constructor(
    readonly kind: ErrorKind,
    /** Stable, machine-readable code, e.g. `identity.email_taken`. */
    readonly code: string,
    message: string,
    readonly details?: ErrorDetails,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }

  static validation(code: string, message: string, details?: ErrorDetails): AppError {
    return new AppError('validation', code, message, details);
  }
  static unauthenticated(code = 'auth.unauthenticated', message = 'Authentication required'): AppError {
    return new AppError('unauthenticated', code, message);
  }
  static forbidden(code = 'auth.forbidden', message = 'You do not have permission to perform this action'): AppError {
    return new AppError('forbidden', code, message);
  }
  static notFound(code: string, message: string): AppError {
    return new AppError('not_found', code, message);
  }
  static conflict(code: string, message: string, details?: ErrorDetails): AppError {
    return new AppError('conflict', code, message, details);
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;
