import { hash, parseOptions, verify, type Options } from '@node-rs/argon2';
import type { PasswordHasher } from '../application/ports';
import { PasswordHash, type PlainPassword } from '../domain';

// `Algorithm` is an ambient const enum (unusable under isolatedModules), so we rely on the
// library default (Argon2id) and verify it via the PHC prefix; a unit test pins this.
const ARGON2ID_PREFIX = '$argon2id$';

/** OWASP Password Storage Cheat Sheet baseline for argon2id. */
export const ARGON2_PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export class Argon2PasswordHasher implements PasswordHasher {
  readonly #options: Options;

  constructor(pepper?: Buffer) {
    this.#options = { ...ARGON2_PARAMS, ...(pepper && { secret: pepper }) };
  }

  async hash(password: PlainPassword): Promise<PasswordHash> {
    return PasswordHash.fromTrusted(await hash(password, this.#options));
  }

  async verify(hashed: PasswordHash, candidate: string): Promise<boolean> {
    try {
      return await verify(hashed, candidate, this.#options);
    } catch {
      return false; // malformed hash ⇒ never authenticate
    }
  }

  needsRehash(hashed: PasswordHash): boolean {
    try {
      const p = parseOptions(hashed);
      return (
        !hashed.startsWith(ARGON2ID_PREFIX) ||
        p.memoryCost < ARGON2_PARAMS.memoryCost ||
        p.timeCost < ARGON2_PARAMS.timeCost
      );
    } catch {
      return true;
    }
  }
}
