# Security model

## Authentication

| Control             | Implementation                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Password hashing    | argon2id, m=19 MiB, t=2, p=1 (OWASP baseline), optional server-side pepper (`PASSWORD_PEPPER`). Hashes with outdated parameters are upgraded transparently at next login.                                    |
| Password policy     | 12–128 characters (grapheme clusters), ≥4 distinct characters, must not contain the email's local part (NIST SP 800-63B: length over composition).                                                           |
| Account enumeration | identical `auth.invalid_credentials` for unknown email, wrong password, locked and disabled accounts; a dummy argon2 verify equalises timing.                                                                |
| Brute force         | account lockout (5 failures → 15 min, configurable) **and** rate limits per IP (20/15 min) and per account (10/15 min), both fail-closed.                                                                    |
| Session tokens      | 256-bit random, opaque; only SHA-256 stored (`sessions.token_hash`). A DB leak yields no usable tokens.                                                                                                      |
| Session lifetime    | sliding idle expiry + absolute expiry; new token on every login (no fixation); logout, logout-all, per-session revoke; password change revokes other sessions; disabling a user revokes all.                 |
| Session cache       | Redis read-through cache, max 5 min TTL, evicted on revoke so revocation is immediate across instances. Redis outage → falls back to Postgres.                                                               |
| Cookies             | `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.                                                                                                                                            |
| CSRF                | cookie-authenticated unsafe requests require `Origin` ∈ `APP_URL` + `ALLOWED_ORIGINS` (or `Sec-Fetch-Site: same-origin`). Login is protected the same way (login CSRF). Bearer clients are exempt by design. |

## Authorization

Static RBAC in the shared kernel (`shared/domain/permissions.ts`), checked **inside use cases** (`requirePermission`), not in routes — so every entry point (HTTP, scripts, future jobs) is covered. Resource access to other users' sessions/files returns `404` rather than `403` to avoid disclosing existence. Admins cannot revoke their own roles or disable themselves (lock-out protection).

## Encryption

| Data                | Protection                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In transit          | HTTPS only (HSTS preload), `upgrade-insecure-requests`; use `sslmode=require` / `rediss://` for managed DB/Redis.                                                                       |
| PII at rest (phone) | AES-256-GCM application-level encryption, random 96-bit IV, authenticated, **bound to the row** via associated data (`users.phone:<id>`) so ciphertexts cannot be swapped between rows. |
| Key rotation        | `ENCRYPTION_KEYS=k1:…,k2:…` + `ENCRYPTION_ACTIVE_KEY_ID=k2`; old ciphertexts keep decrypting; `needsReEncryption()` supports lazy/batch re-encryption; remove the old key afterwards.   |
| Files               | S3 server-side encryption (`S3_SSE=aws:kms` recommended) enforced in the presigned POST policy; bucket must block public access.                                                        |
| Backups             | client-side GPG AES-256 before upload + S3 SSE.                                                                                                                                         |
| Secrets             | never in the repo; `.env` git-ignored; Vercel env vars / External Secrets in k8s. Env validation errors print variable names, never values.                                             |

## Input validation & output safety

- zod **strict** schemas at the edge (unknown keys rejected, size bounds), domain value objects for semantics.
- Body size limit (32 KiB default) and `application/json` media type enforced before parsing.
- SQL only through Drizzle's parameterised builder; keyset cursors are validated UUIDs.
- Uploaded objects get server-generated keys (no path traversal), sanitised names, exact size/type enforced by S3, and downloads are forced to `Content-Disposition: attachment` (no stored XSS via uploads).

## Rate limiting

Redis fixed-window counters via an atomic Lua script, keys SHA-256 hashed (no IPs/emails in Redis). Policies are centralised in `shared/infrastructure/rate-limit/policies.ts`, each with an explicit fail mode: auth endpoints **fail closed**, general traffic **fails open**.

## HTTP hardening

`proxy.ts` sets a per-request nonce CSP for pages and `default-src 'none'` for the API; `next.config.ts` sets HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP; `X-Powered-By` disabled; API responses `Cache-Control: no-store`. Client IPs are only taken from forwarding headers when `TRUST_PROXY=true`.

## Logging & audit

- Structured JSON logs (pino) with **redaction** of passwords, tokens, cookies, authorization headers and phone numbers.
- Security events (registration, login success/failure, lockout, role/status changes, password changes) are written to `audit_events`, which a database trigger makes **append-only** (UPDATE/DELETE/TRUNCATE rejected).
- Recommended DB roles: `app` (DML on app tables, INSERT/SELECT on `audit_events`), `migrator` (DDL; used only by the migration job), `backup` (read-only).

## Supply chain

Exact-pinned dependencies with a committed lockfile; Dependabot with a 7-day cooldown; `pnpm audit`, OSV-Scanner, dependency-review (PRs), CodeQL, gitleaks; container images scanned with Grype and shipped with an SBOM; non-root, read-only-rootfs containers under the `restricted` Pod Security profile.

## Known gaps / next steps

- MFA (TOTP / WebAuthn) and email verification + password reset (need an email port).
- Breached-password check (HIBP k-anonymity) as an additional `PasswordPolicy` port.
- Pin GitHub Actions by commit SHA (Dependabot keeps them current).
- Fine-grained, data-driven roles if the static policy becomes limiting.
