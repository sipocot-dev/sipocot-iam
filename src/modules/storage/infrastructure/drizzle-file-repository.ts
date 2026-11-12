import { and, desc, eq, lt } from 'drizzle-orm';
import type { Page, PageRequest } from '@/shared/application/pagination';
import { AppError, asFileId, asUserId, type FileId, type UserId } from '@/shared/domain';
import type { Database } from '@/shared/infrastructure/db/client';
import { decodeCursor, encodeCursor } from '@/shared/infrastructure/db/cursor';
import { files } from '@/shared/infrastructure/db/schema';
import type { FileRepository } from '../application/ports';
import { StoredFile, UPLOAD_POLICY, type AllowedContentType } from '../domain';

type Row = typeof files.$inferSelect;

const isAllowed = (v: string): v is AllowedContentType =>
  (UPLOAD_POLICY.allowedContentTypes as readonly string[]).includes(v);

export class DrizzleFileRepository implements FileRepository {
  constructor(private readonly db: Database) {}

  async save(file: StoredFile): Promise<void> {
    const s = file.toSnapshot();
    await this.db
      .insert(files)
      .values(s)
      .onConflictDoUpdate({ target: files.id, set: { status: s.status, uploadedAt: s.uploadedAt } });
  }

  async findById(id: FileId): Promise<StoredFile | null> {
    const [row] = await this.db.select().from(files).where(eq(files.id, id)).limit(1);
    return row ? toDomain(row) : null;
  }

  async listByOwner(ownerId: UserId, page: PageRequest): Promise<Page<StoredFile>> {
    const after = decodeCursor(page.cursor);
    const rows = await this.db
      .select()
      .from(files)
      .where(and(eq(files.ownerId, ownerId), after ? lt(files.id, after) : undefined))
      .orderBy(desc(files.id))
      .limit(page.limit + 1);
    const items = rows.slice(0, page.limit).map(toDomain);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > page.limit && last ? encodeCursor(last.id) : null };
  }
}

function toDomain(row: Row): StoredFile {
  if (!isAllowed(row.contentType))
    throw new AppError('internal', 'storage.corrupt_row', `File ${row.id} has invalid content type`);
  return StoredFile.rehydrate(asFileId(row.id), {
    ownerId: asUserId(row.ownerId),
    objectKey: row.objectKey,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt,
    uploadedAt: row.uploadedAt,
  });
}
