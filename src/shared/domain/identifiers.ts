import type { Brand } from './brand';

export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type FileId = Brand<string, 'FileId'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID_RE.test(value);

/** Casts are only allowed here, at the edge of trust, after validation. */
export const asUserId = (value: string): UserId => value as UserId;
export const asSessionId = (value: string): SessionId => value as SessionId;
export const asFileId = (value: string): FileId => value as FileId;
