import { hasPermission, requirePermission, type Actor } from '@/shared/application/actor';
import type { Page, PageRequest } from '@/shared/application/pagination';
import type { Clock, IdGenerator } from '@/shared/application/ports';
import { AppError, asFileId, err, ok, type FileId, type Result } from '@/shared/domain';
import { StoredFile } from '../domain';
import type { FileRepository, ObjectStorage, PresignedDownload, PresignedUpload } from './ports';

export interface StorageDeps {
  readonly files: FileRepository;
  readonly storage: ObjectStorage;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly urlTtlSeconds: number;
}

export interface FileView {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly status: string;
  readonly createdAt: string;
  readonly uploadedAt: string | null;
}

export const toFileView = (f: StoredFile): FileView => ({
  id: f.id,
  fileName: f.fileName,
  contentType: f.contentType,
  sizeBytes: f.sizeBytes,
  status: f.status,
  createdAt: f.createdAt.toISOString(),
  uploadedAt: f.uploadedAt?.toISOString() ?? null,
});

const notFound = () => AppError.notFound('storage.file_not_found', 'File not found');

export class RequestUpload {
  constructor(private readonly deps: StorageDeps) {}

  async execute(input: {
    actor: Actor;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<Result<{ file: FileView; upload: PresignedUpload }, AppError>> {
    requirePermission(input.actor, 'files:write');
    const created = StoredFile.request({
      id: asFileId(this.deps.ids.next()),
      ownerId: input.actor.userId,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      now: this.deps.clock.now(),
    });
    if (!created.ok) return created;
    const file = created.value;
    await this.deps.files.save(file);
    const upload = await this.deps.storage.presignUpload({
      key: file.objectKey,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      expiresInSeconds: this.deps.urlTtlSeconds,
    });
    return ok({ file: toFileView(file), upload });
  }
}

export class ConfirmUpload {
  constructor(private readonly deps: StorageDeps) {}

  async execute(input: { actor: Actor; fileId: FileId }): Promise<Result<FileView, AppError>> {
    const file = await this.deps.files.findById(input.fileId);
    if (file?.ownerId !== input.actor.userId) return err(notFound());
    const head = await this.deps.storage.head(file.objectKey);
    if (!head) return err(AppError.conflict('storage.upload_missing', 'Object has not been uploaded yet'));
    const confirmed = file.confirm(head, this.deps.clock.now());
    if (!confirmed.ok) return confirmed;
    await this.deps.files.save(file);
    return ok(toFileView(file));
  }
}

export class GetDownloadUrl {
  constructor(private readonly deps: StorageDeps) {}

  async execute(input: {
    actor: Actor;
    fileId: FileId;
  }): Promise<Result<{ file: FileView; download: PresignedDownload }, AppError>> {
    const file = await this.deps.files.findById(input.fileId);
    if (!file) return err(notFound());
    if (file.ownerId !== input.actor.userId && !hasPermission(input.actor, 'files:read_any')) return err(notFound());
    if (file.status !== 'available')
      return err(AppError.conflict('storage.not_available', 'File upload has not been confirmed'));
    const download = await this.deps.storage.presignDownload({
      key: file.objectKey,
      fileName: file.fileName,
      expiresInSeconds: this.deps.urlTtlSeconds,
    });
    return ok({ file: toFileView(file), download });
  }
}

export class ListMyFiles {
  constructor(private readonly deps: StorageDeps) {}

  async execute(input: { actor: Actor; page: PageRequest }): Promise<Result<Page<FileView>, AppError>> {
    const page = await this.deps.files.listByOwner(input.actor.userId, input.page);
    return ok({ items: page.items.map(toFileView), nextCursor: page.nextCursor });
  }
}
