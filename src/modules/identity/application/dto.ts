import type { Permission, RoleName } from '@/shared/domain';
import type { Session, User, UserStatus } from '../domain';

export interface UserView {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly phone: string | null;
  readonly status: UserStatus;
  readonly roles: readonly RoleName[];
  readonly permissions: readonly Permission[];
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
}

export interface SessionView {
  readonly id: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly current: boolean;
}

export const toUserView = (u: User): UserView => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
  phone: u.phone,
  status: u.status,
  roles: [...u.roles].sort(),
  permissions: [...u.permissions].sort(),
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

export const toSessionView = (s: Session, currentSessionId?: string): SessionView => ({
  id: s.id,
  createdAt: s.createdAt.toISOString(),
  lastSeenAt: s.lastSeenAt.toISOString(),
  expiresAt: s.effectiveExpiry().toISOString(),
  ip: s.ip,
  userAgent: s.userAgent,
  current: s.id === currentSessionId,
});
