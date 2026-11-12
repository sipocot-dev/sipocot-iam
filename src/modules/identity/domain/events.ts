import type { DomainEvent, RoleName } from '@/shared/domain';

export type IdentityEvent =
  | DomainEvent<'identity.user_registered', { email: string }>
  | DomainEvent<'identity.login_succeeded', { sessionId: string }>
  | DomainEvent<'identity.login_failed', { reason: 'bad_password' | 'locked' | 'disabled' }>
  | DomainEvent<'identity.account_locked', { until: string }>
  | DomainEvent<'identity.password_changed', Record<string, never>>
  | DomainEvent<'identity.role_assigned', { role: RoleName }>
  | DomainEvent<'identity.role_revoked', { role: RoleName }>
  | DomainEvent<'identity.user_disabled', Record<string, never>>
  | DomainEvent<'identity.user_enabled', Record<string, never>>;
