import { isUuid } from '@/shared/domain';

/** Keyset pagination cursor over time-ordered UUIDv7 primary keys. */
export const encodeCursor = (id: string): string => Buffer.from(id, 'utf8').toString('base64url');

export const decodeCursor = (cursor: string | undefined): string | undefined => {
  if (!cursor) return undefined;
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  return isUuid(id) ? id : undefined;
};
