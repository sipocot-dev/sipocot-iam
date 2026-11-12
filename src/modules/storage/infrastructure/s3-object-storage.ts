import { GetObjectCommand, HeadObjectCommand, NotFound, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Clock } from '@/shared/application/ports';
import type { ObjectStorage, PresignedDownload, PresignedUpload } from '../application/ports';

export interface S3Options {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string | undefined;
  readonly publicEndpoint?: string | undefined;
  readonly forcePathStyle: boolean;
  readonly credentials?: { accessKeyId: string; secretAccessKey: string } | undefined;
  readonly sse: 'none' | 'AES256' | 'aws:kms';
  readonly kmsKeyId?: string | undefined;
}

const clientConfig = (o: S3Options, endpoint: string | undefined): S3ClientConfig => ({
  region: o.region,
  forcePathStyle: o.forcePathStyle,
  ...(endpoint && { endpoint }),
  ...(o.credentials && { credentials: o.credentials }),
});

/** RFC 6266 attachment disposition — downloads are never rendered inline (stored-XSS defence). */
const contentDisposition = (fileName: string): string => {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
};

export class S3ObjectStorage implements ObjectStorage {
  readonly #client: S3Client;
  /** Signs URLs against the endpoint browsers can reach (differs from internal endpoint in docker / k8s). */
  readonly #signer: S3Client;

  constructor(
    private readonly options: S3Options,
    private readonly clock: Clock,
  ) {
    this.#client = new S3Client(clientConfig(options, options.endpoint));
    this.#signer = options.publicEndpoint ? new S3Client(clientConfig(options, options.publicEndpoint)) : this.#client;
  }

  async presignUpload(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload> {
    const sseFields: Record<string, string> =
      this.options.sse === 'none'
        ? {}
        : {
            'x-amz-server-side-encryption': this.options.sse,
            ...(this.options.kmsKeyId && { 'x-amz-server-side-encryption-aws-kms-key-id': this.options.kmsKeyId }),
          };
    const fields = { 'Content-Type': input.contentType, ...sseFields };
    const { url, fields: signed } = await createPresignedPost(this.#signer, {
      Bucket: this.options.bucket,
      Key: input.key,
      Expires: input.expiresInSeconds,
      Fields: fields,
      Conditions: [
        ['content-length-range', input.sizeBytes, input.sizeBytes],
        ['eq', '$Content-Type', input.contentType],
        ...Object.entries(sseFields).map(([k, v]) => ['eq', `$${k}`, v] as ['eq', string, string]),
      ],
    });
    return { url, method: 'POST', fields: signed, expiresAt: this.expiry(input.expiresInSeconds) };
  }

  async presignDownload(input: {
    key: string;
    fileName: string;
    expiresInSeconds: number;
  }): Promise<PresignedDownload> {
    const url = await getSignedUrl(
      this.#signer,
      new GetObjectCommand({
        Bucket: this.options.bucket,
        Key: input.key,
        ResponseContentDisposition: contentDisposition(input.fileName),
      }),
      { expiresIn: input.expiresInSeconds },
    );
    return { url, expiresAt: this.expiry(input.expiresInSeconds) };
  }

  async head(key: string): Promise<{ sizeBytes: number; contentType: string | undefined } | null> {
    try {
      const res = await this.#client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return { sizeBytes: res.ContentLength ?? 0, contentType: res.ContentType };
    } catch (e) {
      if (e instanceof NotFound || (e as { name?: string }).name === 'NotFound') return null;
      throw e;
    }
  }

  private expiry(seconds: number): Date {
    return new Date(this.clock.now().getTime() + seconds * 1000);
  }
}
