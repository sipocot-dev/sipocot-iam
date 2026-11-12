import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Argon2PasswordHasher } from '@/modules/identity/infrastructure/argon2-password-hasher';
import { CryptoSessionTokenService } from '@/modules/identity/infrastructure/crypto-session-token-service';
import { PasswordHash, type PlainPassword } from '@/modules/identity/domain';
import { loadEnv } from '@/shared/infrastructure/config/env';
import { AesGcmEncryptor } from '@/shared/infrastructure/crypto/aes-gcm-encryptor';
import { decodeCursor, encodeCursor } from '@/shared/infrastructure/db/cursor';
import { MemoryRateLimiter } from '@/shared/infrastructure/rate-limit/memory-rate-limiter';
import { uuidv7 } from '@/shared/infrastructure/system/uuid-v7';
import { isUuid } from '@/shared/domain';
import { FixedClock } from '../../support/fakes';

const key = () => randomBytes(32);

describe('AesGcmEncryptor', () => {
  const k1 = key();
  const k2 = key();

  it('round-trips and never produces the same ciphertext twice', () => {
    const enc = new AesGcmEncryptor(new Map([['k1', k1]]), 'k1');
    const a = enc.encrypt('+639171234567');
    const b = enc.encrypt('+639171234567');
    expect(a).not.toBe(b);
    expect(a.startsWith('enc:v1:k1:')).toBe(true);
    expect(enc.decrypt(a)).toBe('+639171234567');
  });

  it('binds ciphertext to associated data', () => {
    const enc = new AesGcmEncryptor(new Map([['k1', k1]]), 'k1');
    const c = enc.encrypt('secret', 'users.phone:A');
    expect(enc.decrypt(c, 'users.phone:A')).toBe('secret');
    expect(() => enc.decrypt(c, 'users.phone:B')).toThrow();
  });

  it('detects tampering', () => {
    const enc = new AesGcmEncryptor(new Map([['k1', k1]]), 'k1');
    const parts = enc.encrypt('secret').split(':');
    const ct = Buffer.from(parts[5] ?? '', 'base64url');
    ct[0] = (ct[0] ?? 0) ^ 0xff;
    parts[5] = ct.toString('base64url');
    expect(() => enc.decrypt(parts.join(':'))).toThrow();
    expect(() => enc.decrypt('garbage')).toThrow('Malformed ciphertext');
  });

  it('supports key rotation: old ciphertexts decrypt and are flagged for re-encryption', () => {
    const old = new AesGcmEncryptor(new Map([['k1', k1]]), 'k1').encrypt('data');
    const rotated = new AesGcmEncryptor(
      new Map([
        ['k1', k1],
        ['k2', k2],
      ]),
      'k2',
    );
    expect(rotated.decrypt(old)).toBe('data');
    expect(rotated.needsReEncryption(old)).toBe(true);
    expect(rotated.needsReEncryption(rotated.encrypt('data'))).toBe(false);
  });

  it('rejects bad key material', () => {
    expect(() => new AesGcmEncryptor(new Map([['k1', randomBytes(16)]]), 'k1')).toThrow();
    expect(() => new AesGcmEncryptor(new Map([['k1', k1]]), 'missing')).toThrow();
  });
});

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();
  const pw = 'correct horse battery staple' as PlainPassword;

  it('produces argon2id hashes that verify and are current', async () => {
    const h = await hasher.hash(pw);
    expect(h.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await hasher.verify(h, pw)).toBe(true);
    expect(await hasher.verify(h, 'wrong')).toBe(false);
    expect(hasher.needsRehash(h)).toBe(false);
  });

  it('flags weaker parameters for rehash and never authenticates malformed hashes', async () => {
    const weak = new Argon2PasswordHasher();
    // Hash created with weaker params via the library directly.
    const { hash } = await import('@node-rs/argon2');
    const old = PasswordHash.fromTrusted(await hash(pw, { memoryCost: 8192, timeCost: 1, parallelism: 1 }));
    expect(weak.needsRehash(old)).toBe(true);
    expect(await weak.verify(PasswordHash.fromTrusted('not-a-hash'), pw)).toBe(false);
  });

  it('uses the pepper: hashes do not verify without it', async () => {
    const peppered = new Argon2PasswordHasher(randomBytes(32));
    const h = await peppered.hash(pw);
    expect(await peppered.verify(h, pw)).toBe(true);
    expect(await hasher.verify(h, pw)).toBe(false);
  });
});

describe('CryptoSessionTokenService', () => {
  it('issues 256-bit url-safe tokens and stores only a SHA-256 digest', () => {
    const svc = new CryptoSessionTokenService();
    const { token, hash } = svc.issue();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(svc.hash(token)).toBe(hash);
    expect(svc.issue().token).not.toBe(token);
  });
});

describe('uuidv7 & cursors', () => {
  it('generates valid, time-ordered v7 ids', () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(isUuid(a)).toBe(true);
    expect(a[14]).toBe('7');
    expect(a < b).toBe(true);
  });

  it('round-trips cursors and ignores tampered values', () => {
    const id = uuidv7();
    expect(decodeCursor(encodeCursor(id))).toBe(id);
    expect(decodeCursor(Buffer.from("1' OR 1=1").toString('base64url'))).toBeUndefined();
    expect(decodeCursor(undefined)).toBeUndefined();
  });
});

describe('MemoryRateLimiter', () => {
  it('allows up to the limit per window then rejects until reset', async () => {
    const clock = new FixedClock();
    const rl = new MemoryRateLimiter(clock);
    const policy = { name: 't', limit: 2, windowSeconds: 10, failMode: 'closed' } as const;
    expect((await rl.consume(policy, 'ip')).allowed).toBe(true);
    expect((await rl.consume(policy, 'ip')).remaining).toBe(0);
    const third = await rl.consume(policy, 'ip');
    expect(third.allowed).toBe(false);
    expect(third.resetSeconds).toBe(10);
    expect((await rl.consume(policy, 'other-ip')).allowed).toBe(true);
    clock.advance(10_000);
    expect((await rl.consume(policy, 'ip')).allowed).toBe(true);
  });
});

describe('environment validation', () => {
  const valid = {
    APP_URL: 'http://localhost:3000',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    ENCRYPTION_KEYS: `k1:${key().toString('base64')}`,
    ENCRYPTION_ACTIVE_KEY_ID: 'k1',
    S3_BUCKET: 'bucket',
  };

  it('parses a minimal valid environment with defaults', () => {
    const env = loadEnv(valid);
    expect(env.SESSION_IDLE_TTL_MINUTES).toBe(120);
    expect(env.ENCRYPTION_KEYS.get('k1')).toHaveLength(32);
    expect(env.TRUST_PROXY).toBe(true);
  });

  it('fails fast listing every problem, without echoing secret values', () => {
    const secret = 'k1:' + Buffer.from('too-short').toString('base64');
    expect(() => loadEnv({ ...valid, ENCRYPTION_KEYS: secret, DATABASE_URL: 'nope' })).toThrow(
      /ENCRYPTION_KEYS[\s\S]*DATABASE_URL|DATABASE_URL[\s\S]*ENCRYPTION_KEYS/,
    );
    try {
      loadEnv({ ...valid, ENCRYPTION_KEYS: secret });
    } catch (e) {
      expect((e as Error).message).not.toContain(secret);
    }
  });

  it('enforces production-only requirements', () => {
    expect(() => loadEnv({ ...valid, APP_ENV: 'production' })).toThrow(/METRICS_TOKEN/);
    expect(() => loadEnv({ ...valid, APP_ENV: 'production', METRICS_TOKEN: 'x'.repeat(32) })).toThrow(/https/);
  });

  it('requires the active key to exist and KMS key id when SSE-KMS', () => {
    expect(() => loadEnv({ ...valid, ENCRYPTION_ACTIVE_KEY_ID: 'k9' })).toThrow(/ENCRYPTION_ACTIVE_KEY_ID/);
    expect(() => loadEnv({ ...valid, S3_SSE: 'aws:kms' })).toThrow(/S3_KMS_KEY_ID/);
  });
});
