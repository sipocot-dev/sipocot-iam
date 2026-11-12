import {
  AggregateRoot,
  AppError,
  err,
  ok,
  permissionsFor,
  type Permission,
  type Result,
  type RoleName,
  type UserId,
} from '@/shared/domain';
import type { Email } from './email';
import type { IdentityEvent } from './events';
import type { PasswordHash } from './password';
import type { DisplayName, PhoneNumber } from './profile';

export type UserStatus = 'active' | 'disabled';

export interface LockoutPolicy {
  readonly maxFailedAttempts: number;
  readonly lockDurationMs: number;
}

export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = { maxFailedAttempts: 5, lockDurationMs: 15 * 60 * 1000 };

export interface UserProps {
  readonly email: Email;
  readonly passwordHash: PasswordHash;
  readonly displayName: DisplayName;
  readonly phone: PhoneNumber | null;
  readonly status: UserStatus;
  readonly roles: ReadonlySet<RoleName>;
  readonly failedLoginAttempts: number;
  readonly lockedUntil: Date | null;
  readonly lastLoginAt: Date | null;
  readonly passwordChangedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Optimistic concurrency token. */
  readonly version: number;
}

export type AuthenticationBlock = 'disabled' | 'locked';

export class User extends AggregateRoot<UserId> {
  #props: UserProps;

  private constructor(id: UserId, props: UserProps) {
    super(id);
    this.#props = props;
  }

  static register(input: {
    id: UserId;
    email: Email;
    passwordHash: PasswordHash;
    displayName: DisplayName;
    phone: PhoneNumber | null;
    roles?: readonly RoleName[];
    now: Date;
  }): User {
    const user = new User(input.id, {
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      phone: input.phone,
      status: 'active',
      roles: new Set(input.roles ?? ['member']),
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      passwordChangedAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
      version: 0,
    });
    user.emit({
      type: 'identity.user_registered',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: { email: input.email },
    });
    return user;
  }

  static rehydrate(id: UserId, props: UserProps): User {
    return new User(id, props);
  }

  // ── Read model ────────────────────────────────────────────────────────────
  get email(): Email {
    return this.#props.email;
  }
  get passwordHash(): PasswordHash {
    return this.#props.passwordHash;
  }
  get displayName(): DisplayName {
    return this.#props.displayName;
  }
  get phone(): PhoneNumber | null {
    return this.#props.phone;
  }
  get status(): UserStatus {
    return this.#props.status;
  }
  get roles(): ReadonlySet<RoleName> {
    return this.#props.roles;
  }
  get failedLoginAttempts(): number {
    return this.#props.failedLoginAttempts;
  }
  get lockedUntil(): Date | null {
    return this.#props.lockedUntil;
  }
  get lastLoginAt(): Date | null {
    return this.#props.lastLoginAt;
  }
  get passwordChangedAt(): Date {
    return this.#props.passwordChangedAt;
  }
  get createdAt(): Date {
    return this.#props.createdAt;
  }
  get updatedAt(): Date {
    return this.#props.updatedAt;
  }
  get version(): number {
    return this.#props.version;
  }

  get permissions(): ReadonlySet<Permission> {
    return permissionsFor(this.#props.roles);
  }

  isLocked(now: Date): boolean {
    return this.#props.lockedUntil !== null && this.#props.lockedUntil.getTime() > now.getTime();
  }

  authenticationBlock(now: Date): AuthenticationBlock | null {
    if (this.#props.status === 'disabled') return 'disabled';
    if (this.isLocked(now)) return 'locked';
    return null;
  }

  // ── Behaviour ─────────────────────────────────────────────────────────────
  recordFailedLogin(now: Date, policy: LockoutPolicy = DEFAULT_LOCKOUT_POLICY): void {
    const attempts = this.#props.failedLoginAttempts + 1;
    const shouldLock = attempts >= policy.maxFailedAttempts;
    const lockedUntil = shouldLock ? new Date(now.getTime() + policy.lockDurationMs) : this.#props.lockedUntil;
    this.#mutate({ failedLoginAttempts: shouldLock ? 0 : attempts, lockedUntil }, now);
    this.emit({
      type: 'identity.login_failed',
      aggregateId: this.id,
      occurredAt: now,
      payload: { reason: 'bad_password' },
    });
    if (shouldLock && lockedUntil) {
      this.emit({
        type: 'identity.account_locked',
        aggregateId: this.id,
        occurredAt: now,
        payload: { until: lockedUntil.toISOString() },
      });
    }
  }

  recordBlockedLogin(reason: AuthenticationBlock, now: Date): void {
    this.emit({ type: 'identity.login_failed', aggregateId: this.id, occurredAt: now, payload: { reason } });
  }

  recordSuccessfulLogin(sessionId: string, now: Date): void {
    this.#mutate({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: now }, now);
    this.emit({ type: 'identity.login_succeeded', aggregateId: this.id, occurredAt: now, payload: { sessionId } });
  }

  /** Transparent hash upgrade (e.g. after argon2 parameter changes). */
  upgradePasswordHash(hash: PasswordHash, now: Date): void {
    this.#mutate({ passwordHash: hash }, now);
  }

  changePassword(hash: PasswordHash, now: Date): void {
    this.#mutate({ passwordHash: hash, passwordChangedAt: now }, now);
    this.emit({ type: 'identity.password_changed', aggregateId: this.id, occurredAt: now, payload: {} });
  }

  updateProfile(changes: { displayName?: DisplayName; phone?: PhoneNumber | null }, now: Date): void {
    this.#mutate(
      {
        ...(changes.displayName !== undefined && { displayName: changes.displayName }),
        ...(changes.phone !== undefined && { phone: changes.phone }),
      },
      now,
    );
  }

  assignRole(role: RoleName, now: Date): void {
    if (this.#props.roles.has(role)) return;
    this.#mutate({ roles: new Set([...this.#props.roles, role]) }, now);
    this.emit({ type: 'identity.role_assigned', aggregateId: this.id, occurredAt: now, payload: { role } });
  }

  revokeRole(role: RoleName, now: Date): Result<void, AppError> {
    if (!this.#props.roles.has(role)) return ok(undefined);
    if (this.#props.roles.size === 1) {
      return err(AppError.conflict('identity.last_role', 'A user must keep at least one role'));
    }
    const roles = new Set(this.#props.roles);
    roles.delete(role);
    this.#mutate({ roles }, now);
    this.emit({ type: 'identity.role_revoked', aggregateId: this.id, occurredAt: now, payload: { role } });
    return ok(undefined);
  }

  disable(now: Date): void {
    if (this.#props.status === 'disabled') return;
    this.#mutate({ status: 'disabled' }, now);
    this.emit({ type: 'identity.user_disabled', aggregateId: this.id, occurredAt: now, payload: {} });
  }

  enable(now: Date): void {
    if (this.#props.status === 'active') return;
    this.#mutate({ status: 'active', failedLoginAttempts: 0, lockedUntil: null }, now);
    this.emit({ type: 'identity.user_enabled', aggregateId: this.id, occurredAt: now, payload: {} });
  }

  /** Snapshot for persistence adapters. */
  toSnapshot(): Readonly<UserProps> & { readonly id: UserId } {
    return { id: this.id, ...this.#props };
  }

  #mutate(patch: Partial<UserProps>, now: Date): void {
    this.#props = { ...this.#props, ...patch, updatedAt: now };
  }

  private emit(event: IdentityEvent): void {
    this.raise(event);
  }
}
