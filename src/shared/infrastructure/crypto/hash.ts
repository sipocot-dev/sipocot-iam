import { createHash, timingSafeEqual } from 'node:crypto';

export const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

export const safeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
};
