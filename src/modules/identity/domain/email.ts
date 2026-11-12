import { AppError, err, ok, type Brand, type Result } from '@/shared/domain';

export type Email = Brand<string, 'Email'>;

// Pragmatic RFC 5321 subset: local@domain.tld, no whitespace, single @.
const EMAIL_RE =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const Email = {
  create(raw: string): Result<Email, AppError> {
    const value = raw.trim().toLowerCase();
    if (value.length === 0 || value.length > 254 || !EMAIL_RE.test(value)) {
      return err(AppError.validation('identity.invalid_email', 'Email address is invalid', { field: 'email' }));
    }
    return ok(value as Email);
  },
  /** For rehydration from trusted storage only. */
  fromTrusted(value: string): Email {
    return value as Email;
  },
};
