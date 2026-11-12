import type { SessionId, UserId } from '@/shared/domain';

export interface SessionPolicy {
  /** Hard upper bound regardless of activity. */
  readonly absoluteTtlMs: number;
  /** Session dies after this much inactivity. */
  readonly idleTtlMs: number;
  /** Avoid a DB write on every request: only extend when this much time passed since last touch. */
  readonly touchIntervalMs: number;
}

export const DEFAULT_SESSION_POLICY: SessionPolicy = {
  absoluteTtlMs: 7 * 24 * 60 * 60 * 1000,
  idleTtlMs: 2 * 60 * 60 * 1000,
  touchIntervalMs: 60 * 1000,
};

export interface SessionProps {
  readonly userId: UserId;
  /** SHA-256 of the bearer secret. The raw token is never stored. */
  readonly tokenHash: string;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly idleExpiresAt: Date;
  readonly revokedAt: Date | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export class Session {
  #props: SessionProps;

  private constructor(
    readonly id: SessionId,
    props: SessionProps,
  ) {
    this.#props = props;
  }

  static start(input: {
    id: SessionId;
    userId: UserId;
    tokenHash: string;
    ip: string | null;
    userAgent: string | null;
    now: Date;
    policy: SessionPolicy;
  }): Session {
    const { now, policy } = input;
    return new Session(input.id, {
      userId: input.userId,
      tokenHash: input.tokenHash,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + policy.absoluteTtlMs),
      idleExpiresAt: new Date(now.getTime() + Math.min(policy.idleTtlMs, policy.absoluteTtlMs)),
      revokedAt: null,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    });
  }

  static rehydrate(id: SessionId, props: SessionProps): Session {
    return new Session(id, props);
  }

  get userId(): UserId {
    return this.#props.userId;
  }
  get tokenHash(): string {
    return this.#props.tokenHash;
  }
  get createdAt(): Date {
    return this.#props.createdAt;
  }
  get lastSeenAt(): Date {
    return this.#props.lastSeenAt;
  }
  get expiresAt(): Date {
    return this.#props.expiresAt;
  }
  get idleExpiresAt(): Date {
    return this.#props.idleExpiresAt;
  }
  get revokedAt(): Date | null {
    return this.#props.revokedAt;
  }
  get ip(): string | null {
    return this.#props.ip;
  }
  get userAgent(): string | null {
    return this.#props.userAgent;
  }

  isActive(now: Date): boolean {
    const t = now.getTime();
    return (
      this.#props.revokedAt === null && t < this.#props.expiresAt.getTime() && t < this.#props.idleExpiresAt.getTime()
    );
  }

  /** Effective expiry — whichever of absolute / idle comes first. */
  effectiveExpiry(): Date {
    return this.#props.expiresAt < this.#props.idleExpiresAt ? this.#props.expiresAt : this.#props.idleExpiresAt;
  }

  /** Sliding idle expiry. Returns true when state changed and must be persisted. */
  touch(now: Date, policy: SessionPolicy): boolean {
    if (now.getTime() - this.#props.lastSeenAt.getTime() < policy.touchIntervalMs) return false;
    const idle = Math.min(now.getTime() + policy.idleTtlMs, this.#props.expiresAt.getTime());
    this.#props = { ...this.#props, lastSeenAt: now, idleExpiresAt: new Date(idle) };
    return true;
  }

  revoke(now: Date): void {
    if (this.#props.revokedAt) return;
    this.#props = { ...this.#props, revokedAt: now };
  }

  toSnapshot(): Readonly<SessionProps> & { readonly id: SessionId } {
    return { id: this.id, ...this.#props };
  }
}
