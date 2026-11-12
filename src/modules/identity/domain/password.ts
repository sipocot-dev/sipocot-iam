import { AppError, err, ok, type Brand, type Result } from '@/shared/domain';

/** A plaintext password that satisfies policy. Never persisted, never logged. */
export type PlainPassword = Brand<string, 'PlainPassword'>;
/** Output of the PasswordHasher port (argon2id PHC string). */
export type PasswordHash = Brand<string, 'PasswordHash'>;

export const PASSWORD_POLICY = { minLength: 12, maxLength: 128 } as const;

/**
 * NIST SP 800-63B aligned: length over composition rules, reject trivially weak values.
 * Breached-password checks (e.g. k-anonymity HIBP) can be added as an application port.
 */
export const PlainPassword = {
  create(raw: string, context: { email?: string } = {}): Result<PlainPassword, AppError> {
    const fail = (reason: string) =>
      err(
        AppError.validation('identity.weak_password', 'Password does not meet policy', { field: 'password', reason }),
      );

    // Count user-perceived characters (grapheme clusters), not UTF-16 code units.
    const length = Array.from(new Intl.Segmenter().segment(raw)).length;
    if (length < PASSWORD_POLICY.minLength) return fail(`must be at least ${PASSWORD_POLICY.minLength} characters`);
    if (length > PASSWORD_POLICY.maxLength) return fail(`must be at most ${PASSWORD_POLICY.maxLength} characters`);
    if (new Set(raw).size < 4) return fail('must contain more distinct characters');
    const lowered = raw.toLowerCase();
    const local = context.email?.split('@')[0];
    if (local && local.length >= 4 && lowered.includes(local)) return fail('must not contain your email address');
    return ok(raw as PlainPassword);
  },
};

export const PasswordHash = {
  fromTrusted: (value: string): PasswordHash => value as PasswordHash,
};
