import { randomBytes } from 'node:crypto';
import type { IdGenerator } from '@/shared/application/ports';

/** RFC 9562 UUIDv7: 48-bit unix ms timestamp + 74 random bits. Sortable, B-tree friendly. */
export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  b.writeUIntBE(now, 0, 6);
  b.writeUInt8((b.readUInt8(6) & 0x0f) | 0x70, 6);
  b.writeUInt8((b.readUInt8(8) & 0x3f) | 0x80, 8);
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export class UuidV7Generator implements IdGenerator {
  next(): string {
    return uuidv7();
  }
}
