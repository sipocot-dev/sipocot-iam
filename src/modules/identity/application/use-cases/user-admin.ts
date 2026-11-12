import { requirePermission, type Actor, type RequestMeta } from '@/shared/application/actor';
import type { Page, PageRequest } from '@/shared/application/pagination';
import { err, ok, type AppError, type Result, type RoleName, type UserId } from '@/shared/domain';
import { DisplayName, PhoneNumber } from '../../domain';
import type { IdentityDeps } from '../deps';
import { toUserView, type UserView } from '../dto';
import { IdentityErrors } from '../errors';

type Deps = Pick<IdentityDeps, 'users' | 'sessions' | 'events' | 'clock'>;

export class GetUser {
  constructor(private readonly deps: Pick<IdentityDeps, 'users'>) {}

  async execute(input: { actor: Actor; userId: UserId }): Promise<Result<UserView, AppError>> {
    if (input.userId !== input.actor.userId) requirePermission(input.actor, 'users:read');
    const user = await this.deps.users.findById(input.userId);
    return user ? ok(toUserView(user)) : err(IdentityErrors.userNotFound());
  }
}

export class ListUsers {
  constructor(private readonly deps: Pick<IdentityDeps, 'users'>) {}

  async execute(input: { actor: Actor; page: PageRequest }): Promise<Result<Page<UserView>, AppError>> {
    requirePermission(input.actor, 'users:read');
    const page = await this.deps.users.list(input.page);
    return ok({ items: page.items.map(toUserView), nextCursor: page.nextCursor });
  }
}

export class UpdateProfile {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    actor: Actor;
    displayName?: string | undefined;
    phone?: string | null | undefined;
  }): Promise<Result<UserView, AppError>> {
    const user = await this.deps.users.findById(input.actor.userId);
    if (!user) return err(IdentityErrors.userNotFound());

    const changes: { displayName?: DisplayName; phone?: PhoneNumber | null } = {};
    if (input.displayName !== undefined) {
      const dn = DisplayName.create(input.displayName);
      if (!dn.ok) return dn;
      changes.displayName = dn.value;
    }
    if (input.phone !== undefined) {
      if (input.phone === null || input.phone === '') changes.phone = null;
      else {
        const p = PhoneNumber.create(input.phone);
        if (!p.ok) return p;
        changes.phone = p.value;
      }
    }
    user.updateProfile(changes, this.deps.clock.now());
    await this.deps.users.save(user);
    return ok(toUserView(user));
  }
}

export class ChangeUserRole {
  constructor(private readonly deps: Deps) {}

  async execute(input: {
    actor: Actor;
    userId: UserId;
    role: RoleName;
    action: 'assign' | 'revoke';
    meta: RequestMeta;
  }): Promise<Result<UserView, AppError>> {
    requirePermission(input.actor, 'roles:assign');
    if (input.userId === input.actor.userId && input.action === 'revoke') {
      return err(IdentityErrors.cannotModifySelf('revoke roles from'));
    }
    const user = await this.deps.users.findById(input.userId);
    if (!user) return err(IdentityErrors.userNotFound());

    const now = this.deps.clock.now();
    if (input.action === 'assign') user.assignRole(input.role, now);
    else {
      const r = user.revokeRole(input.role, now);
      if (!r.ok) return r;
    }
    await this.deps.users.save(user);
    await this.deps.events.publish(user.pullEvents(), {
      actorId: input.actor.userId,
      ip: input.meta.ip,
      requestId: input.meta.requestId,
    });
    return ok(toUserView(user));
  }
}

export class SetUserStatus {
  constructor(private readonly deps: Deps) {}

  /** Disabling a user immediately revokes all of their sessions. */
  async execute(input: {
    actor: Actor;
    userId: UserId;
    status: 'active' | 'disabled';
    meta: RequestMeta;
  }): Promise<Result<UserView, AppError>> {
    requirePermission(input.actor, 'users:write');
    if (input.userId === input.actor.userId) return err(IdentityErrors.cannotModifySelf('change the status of'));
    const user = await this.deps.users.findById(input.userId);
    if (!user) return err(IdentityErrors.userNotFound());

    const now = this.deps.clock.now();
    if (input.status === 'disabled') user.disable(now);
    else user.enable(now);
    await this.deps.users.save(user);
    if (input.status === 'disabled') await this.deps.sessions.revokeAllForUser(user.id, now);
    await this.deps.events.publish(user.pullEvents(), {
      actorId: input.actor.userId,
      ip: input.meta.ip,
      requestId: input.meta.requestId,
    });
    return ok(toUserView(user));
  }
}
