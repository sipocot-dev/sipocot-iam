# ADR 0002 — Opaque, server-side sessions instead of JWTs

- Status: accepted
- Date: 2026-11-13

## Context

An IAM service must be able to revoke access immediately (disabled user, password change, stolen device) and show users their active sessions.

## Decision

Issue 256-bit random opaque tokens. Store only their SHA-256 in Postgres (`sessions`), cache lookups in Redis (≤5 min, evicted on revoke). Deliver via `__Host-` HttpOnly cookie for browsers or bearer header for native clients.

## Alternatives considered

- **Stateless JWT access + refresh tokens** — no per-request lookup, but revocation needs a denylist anyway, tokens leak claims, key management and algorithm pitfalls add risk. Can be added later for third-party service-to-service use (e.g. OAuth2 client credentials) without changing user sessions.

## Consequences

- One Redis GET (cache hit) or one indexed Postgres read per authenticated request.
- Instant, global revocation; session listing and per-device logout are trivial.
- Redis outage degrades to Postgres reads, not to an outage.
