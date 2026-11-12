import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Encryptor } from '@/shared/application/ports';

const PREFIX = 'enc';
const FORMAT_VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

const b64u = (b: Buffer): string => b.toString('base64url');
const fromB64u = (s: string): Buffer => Buffer.from(s, 'base64url');

/**
 * AES-256-GCM envelope with key ring:
 *   enc:v1:<keyId>:<iv>:<tag>:<ciphertext>   (base64url segments)
 * - Random 96-bit IV per message.
 * - Optional associated data binds a ciphertext to its context (e.g. row id) so it
 *   cannot be copy-pasted into another row.
 * - Rotation: add a new key, switch the active id, re-encrypt lazily via `needsReEncryption`.
 */
export class AesGcmEncryptor implements Encryptor {
  constructor(
    private readonly keys: ReadonlyMap<string, Buffer>,
    private readonly activeKeyId: string,
  ) {
    for (const [id, key] of keys) if (key.length !== 32) throw new Error(`Encryption key "${id}" must be 32 bytes`);
    if (!keys.has(activeKeyId)) throw new Error(`Active encryption key "${activeKeyId}" not found`);
  }

  encrypt(plaintext: string, associatedData?: string): string {
    const key = this.keys.get(this.activeKeyId);
    if (!key) throw new Error('Active encryption key missing');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    if (associatedData !== undefined) cipher.setAAD(Buffer.from(associatedData, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [PREFIX, FORMAT_VERSION, this.activeKeyId, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join(':');
  }

  decrypt(ciphertext: string, associatedData?: string): string {
    const { keyId, iv, tag, ct } = this.parse(ciphertext);
    const key = this.keys.get(keyId);
    if (!key) throw new Error(`Unknown encryption key id "${keyId}"`);
    const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    if (associatedData !== undefined) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  needsReEncryption(ciphertext: string): boolean {
    return this.parse(ciphertext).keyId !== this.activeKeyId;
  }

  private parse(value: string): { keyId: string; iv: Buffer; tag: Buffer; ct: Buffer } {
    const parts = value.split(':');
    const [prefix, version, keyId, iv, tag, ct] = parts;
    if (
      parts.length !== 6 ||
      prefix !== PREFIX ||
      version !== FORMAT_VERSION ||
      !keyId ||
      !iv ||
      !tag ||
      ct === undefined
    ) {
      throw new Error('Malformed ciphertext');
    }
    const ivBuf = fromB64u(iv);
    const tagBuf = fromB64u(tag);
    if (ivBuf.length !== IV_BYTES || tagBuf.length !== TAG_BYTES) throw new Error('Malformed ciphertext');
    return { keyId, iv: ivBuf, tag: tagBuf, ct: fromB64u(ct) };
  }
}
