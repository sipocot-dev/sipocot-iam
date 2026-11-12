import { AppError, err, ok, type Brand, type Result } from '@/shared/domain';

export type DisplayName = Brand<string, 'DisplayName'>;
export type PhoneNumber = Brand<string, 'PhoneNumber'>;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const E164 = /^\+[1-9]\d{6,14}$/;

export const DisplayName = {
  create(raw: string): Result<DisplayName, AppError> {
    const value = raw.trim().replace(/\s+/g, ' ');
    if (value.length < 1 || value.length > 100 || CONTROL_CHARS.test(value)) {
      return err(
        AppError.validation('identity.invalid_display_name', 'Display name must be 1-100 printable characters', {
          field: 'displayName',
        }),
      );
    }
    return ok(value as DisplayName);
  },
  fromTrusted: (value: string): DisplayName => value as DisplayName,
};

export const PhoneNumber = {
  /** Accepts E.164 (`+639171234567`) and Philippine local mobile format (`09171234567`). */
  create(raw: string): Result<PhoneNumber, AppError> {
    const compact = raw.replace(/[\s()-]/g, '');
    const normalized = /^09\d{9}$/.test(compact) ? `+63${compact.slice(1)}` : compact;
    if (!E164.test(normalized)) {
      return err(
        AppError.validation('identity.invalid_phone', 'Phone number must be in E.164 format', { field: 'phone' }),
      );
    }
    return ok(normalized as PhoneNumber);
  },
  fromTrusted: (value: string): PhoneNumber => value as PhoneNumber,
};
