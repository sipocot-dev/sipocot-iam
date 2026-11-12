import type { PasswordHash, PlainPassword } from '../../domain';

export interface PasswordHasher {
  hash(password: PlainPassword): Promise<PasswordHash>;
  /** Constant-time verification. Accepts any string so login never leaks policy. */
  verify(hash: PasswordHash, candidate: string): Promise<boolean>;
  /** True when the hash was produced with outdated parameters. */
  needsRehash(hash: PasswordHash): boolean;
}
