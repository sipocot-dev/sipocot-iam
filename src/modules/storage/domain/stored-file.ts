import { AppError, err, ok, type FileId, type Result, type UserId } from '@/shared/domain';

export const UPLOAD_POLICY = {
  maxSizeBytes: 10 * 1024 * 1024,
  allowedContentTypes: ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const,
} as const;

export type AllowedContentType = (typeof UPLOAD_POLICY.allowedContentTypes)[number];
export type FileStatus = 'pending' | 'available';

export interface StoredFileProps {
  readonly ownerId: UserId;
  readonly objectKey: string;
  readonly fileName: string;
  readonly contentType: AllowedContentType;
  readonly sizeBytes: number;
  readonly status: FileStatus;
  readonly createdAt: Date;
  readonly uploadedAt: Date | null;
}

// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME = /[\u0000-\u001f\u007f/\\]/g;

export const sanitizeFileName = (name: string): string =>
  name.normalize('NFC').replace(UNSAFE_FILENAME, '_').replace(/^\.+/, '').slice(0, 200) || 'file';

const isAllowedContentType = (v: string): v is AllowedContentType =>
  (UPLOAD_POLICY.allowedContentTypes as readonly string[]).includes(v);

export class StoredFile {
  #props: StoredFileProps;

  private constructor(
    readonly id: FileId,
    props: StoredFileProps,
  ) {
    this.#props = props;
  }

  static request(input: {
    id: FileId;
    ownerId: UserId;
    fileName: string;
    contentType: string;
    sizeBytes: number;
    now: Date;
  }): Result<StoredFile, AppError> {
    if (!isAllowedContentType(input.contentType)) {
      return err(
        AppError.validation('storage.unsupported_type', 'File type is not allowed', {
          allowed: UPLOAD_POLICY.allowedContentTypes,
        }),
      );
    }
    if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > UPLOAD_POLICY.maxSizeBytes) {
      return err(
        AppError.validation('storage.invalid_size', 'File size is out of range', {
          maxSizeBytes: UPLOAD_POLICY.maxSizeBytes,
        }),
      );
    }
    // Object keys never contain user input → no path traversal / key collisions.
    const objectKey = `users/${input.ownerId}/${input.id}`;
    return ok(
      new StoredFile(input.id, {
        ownerId: input.ownerId,
        objectKey,
        fileName: sanitizeFileName(input.fileName),
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        status: 'pending',
        createdAt: input.now,
        uploadedAt: null,
      }),
    );
  }

  static rehydrate(id: FileId, props: StoredFileProps): StoredFile {
    return new StoredFile(id, props);
  }

  get ownerId(): UserId {
    return this.#props.ownerId;
  }
  get objectKey(): string {
    return this.#props.objectKey;
  }
  get fileName(): string {
    return this.#props.fileName;
  }
  get contentType(): AllowedContentType {
    return this.#props.contentType;
  }
  get sizeBytes(): number {
    return this.#props.sizeBytes;
  }
  get status(): FileStatus {
    return this.#props.status;
  }
  get createdAt(): Date {
    return this.#props.createdAt;
  }
  get uploadedAt(): Date | null {
    return this.#props.uploadedAt;
  }

  /** Verifies the object actually stored matches what was declared. */
  confirm(stored: { sizeBytes: number; contentType: string | undefined }, now: Date): Result<void, AppError> {
    if (this.#props.status === 'available') return ok(undefined);
    if (
      stored.sizeBytes !== this.#props.sizeBytes ||
      (stored.contentType !== undefined && stored.contentType !== this.#props.contentType)
    ) {
      return err(AppError.conflict('storage.upload_mismatch', 'Uploaded object does not match the declared metadata'));
    }
    this.#props = { ...this.#props, status: 'available', uploadedAt: now };
    return ok(undefined);
  }

  toSnapshot(): Readonly<StoredFileProps> & { readonly id: FileId } {
    return { id: this.id, ...this.#props };
  }
}
