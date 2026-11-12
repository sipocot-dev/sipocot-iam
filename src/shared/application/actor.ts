import { AppError, type Permission, type RoleName, type SessionId, type UserId } from '@/shared/domain';

/** The authenticated principal on whose behalf a use case executes. */
export interface Actor {
  readonly userId: UserId;
  readonly sessionId: SessionId;
  readonly roles: ReadonlySet<RoleName>;
  readonly permissions: ReadonlySet<Permission>;
}

export interface RequestMeta {
  readonly requestId: string;
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

export const hasPermission = (actor: Actor, permission: Permission): boolean => actor.permissions.has(permission);

/** Throws on failure: authorisation is a precondition, not a business outcome. */
export function requirePermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor, permission)) throw AppError.forbidden();
}
