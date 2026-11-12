import { randomBytes } from 'node:crypto';
import { sha256Hex } from '@/shared/infrastructure/crypto/hash';
import type { IssuedToken, SessionTokenService } from '../application/ports';

/**
 * Opaque 256-bit bearer tokens. Only the SHA-256 digest is stored, so a database
 * leak does not yield usable session tokens. (A slow hash is unnecessary: the
 * token has 256 bits of entropy, unlike a password.)
 */
export class CryptoSessionTokenService implements SessionTokenService {
  issue(): IssuedToken {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hash(token) };
  }

  hash(token: string): string {
    return sha256Hex(token);
  }
}
