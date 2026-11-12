import { and, desc, eq, lt } from 'drizzle-orm';
import type { Page, PageRequest } from '@/shared/application/pagination';
import type { Encryptor } from '@/shared/application/ports';
import { AppError, asUserId, isRoleName, type UserId } from '@/shared/domain';
import { pgErrorCode, PG_UNIQUE_VIOLATION, type Database } from '@/shared/infrastructure/db/client';
import { decodeCursor, encodeCursor } from '@/shared/infrastructure/db/cursor';
import { users } from '@/shared/infrastructure/db/schema';
import type { UserRepository } from '../application/ports';
import { IdentityErrors } from '../application/errors';
import { DisplayName, Email, PasswordHash, PhoneNumber, User, type Email as EmailT } from '../domain';

type Row = typeof users.$inferSelect;

const phoneAad = (id: string) => `users.phone:${id}`;

export class DrizzleUserRepository implements UserRepository {
  constructor(
    private readonly db: Database,
    private readonly encryptor: Encryptor,
  ) {}

  async findById(id: UserId): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ? this.toDomain(row) : null;
  }

  async findByEmail(email: EmailT): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ? this.toDomain(row) : null;
  }

  async list(page: PageRequest): Promise<Page<User>> {
    const after = decodeCursor(page.cursor);
    const rows = await this.db
      .select()
      .from(users)
      .where(after ? lt(users.id, after) : undefined)
      .orderBy(desc(users.id))
      .limit(page.limit + 1);
    const items = rows.slice(0, page.limit).map((r) => this.toDomain(r));
    const last = items.at(-1);
    return { items, nextCursor: rows.length > page.limit && last ? encodeCursor(last.id) : null };
  }

  async save(user: User): Promise<void> {
    const s = user.toSnapshot();
    const values = {
      email: s.email,
      passwordHash: s.passwordHash,
      displayName: s.displayName,
      phoneEncrypted: s.phone ? this.encryptor.encrypt(s.phone, phoneAad(s.id)) : null,
      status: s.status,
      roles: [...s.roles].sort(),
      failedLoginAttempts: s.failedLoginAttempts,
      lockedUntil: s.lockedUntil,
      lastLoginAt: s.lastLoginAt,
      passwordChangedAt: s.passwordChangedAt,
      updatedAt: s.updatedAt,
    };
    try {
      if (s.version === 0 && !(await this.exists(s.id))) {
        await this.db.insert(users).values({ id: s.id, createdAt: s.createdAt, version: 1, ...values });
        return;
      }
      const updated = await this.db
        .update(users)
        .set({ ...values, version: s.version + 1 })
        .where(and(eq(users.id, s.id), eq(users.version, s.version)))
        .returning({ id: users.id });
      if (updated.length === 0) throw IdentityErrors.concurrentModification();
    } catch (e) {
      const pg = pgErrorCode(e);
      if (pg?.code === PG_UNIQUE_VIOLATION && pg.constraint === 'users_email_key') throw IdentityErrors.emailTaken();
      throw e;
    }
  }

  private async exists(id: string): Promise<boolean> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
    return Boolean(row);
  }

  private toDomain(row: Row): User {
    const roles = row.roles.filter(isRoleName);
    if (roles.length !== row.roles.length) {
      throw new AppError('internal', 'identity.corrupt_roles', `User ${row.id} has unknown roles`);
    }
    return User.rehydrate(asUserId(row.id), {
      email: Email.fromTrusted(row.email),
      passwordHash: PasswordHash.fromTrusted(row.passwordHash),
      displayName: DisplayName.fromTrusted(row.displayName),
      phone: row.phoneEncrypted
        ? PhoneNumber.fromTrusted(this.encryptor.decrypt(row.phoneEncrypted, phoneAad(row.id)))
        : null,
      status: row.status,
      roles: new Set(roles),
      failedLoginAttempts: row.failedLoginAttempts,
      lockedUntil: row.lockedUntil,
      lastLoginAt: row.lastLoginAt,
      passwordChangedAt: row.passwordChangedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
  }
}
