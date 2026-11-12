import { z } from 'zod';
import { ROLE_NAMES } from '@/shared/domain';

/**
 * Syntactic validation at the edge (shape, types, size bounds). Semantic rules
 * (password policy, email format, phone format) are enforced by domain value objects.
 */
const email = z.string().trim().min(3).max(254);
const password = z.string().min(1).max(256);
const uuid = z.uuid();

export const RegisterBody = z.strictObject({
  email,
  password,
  displayName: z.string().min(1).max(200),
  phone: z.string().max(32).optional(),
});

export const LoginBody = z.strictObject({
  email,
  password,
  /** `cookie` (browsers, default) or `bearer` (native / server clients). */
  tokenDelivery: z.enum(['cookie', 'bearer']).default('cookie'),
});

export const LogoutBody = z.strictObject({ allDevices: z.boolean().default(false) });

export const ChangePasswordBody = z.strictObject({ currentPassword: password, newPassword: password });

export const UpdateProfileBody = z
  .strictObject({ displayName: z.string().min(1).max(200).optional(), phone: z.string().max(32).nullable().optional() })
  .refine((b) => b.displayName !== undefined || b.phone !== undefined, 'at least one field is required');

export const PageQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export const UserIdParams = z.strictObject({ userId: uuid });
export const SessionIdParams = z.strictObject({ sessionId: uuid });
export const UserRoleParams = z.strictObject({ userId: uuid, role: z.enum(ROLE_NAMES) });
export const SetStatusBody = z.strictObject({ status: z.enum(['active', 'disabled']) });
