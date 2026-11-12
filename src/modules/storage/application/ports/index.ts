import type { Page, PageRequest } from '@/shared/application/pagination';
import type { FileId, UserId } from '@/shared/domain';
import type { StoredFile } from '../../domain';

export interface FileRepository {
  save(file: StoredFile): Promise<void>;
  findById(id: FileId): Promise<StoredFile | null>;
  listByOwner(ownerId: UserId, page: PageRequest): Promise<Page<StoredFile>>;
}

/** Browser-compatible presigned POST: S3 itself enforces content-type and size range. */
export interface PresignedUpload {
  readonly url: string;
  readonly method: 'POST';
  /** Form fields that MUST be sent (before the `file` field) in a multipart/form-data body. */
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface PresignedDownload {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface ObjectStorage {
  presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload>;
  presignDownload(input: { key: string; fileName: string; expiresInSeconds: number }): Promise<PresignedDownload>;
  head(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null>;
}
