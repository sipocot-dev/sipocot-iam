# Sipocot IAM

Identity & Access Management service: user accounts, authentication, sessions, role-based access control, audit trail and secure file storage — exposed as a versioned REST API.

| Concern    | Choice                                                                  |
| ---------- | ----------------------------------------------------------------------- |
| Runtime    | Node.js 22, Next.js 16 (App Router route handlers), TypeScript 6 strict |
| API        | REST, JSON, `/api/v1`, RFC 9457 problem responses                       |
| Database   | PostgreSQL 17 via Drizzle ORM (postgres.js driver)                      |
| Cache      | Redis (sessions cache, rate limiting)                                   |
| Storage    | S3 (presigned POST uploads / GET downloads, SSE)                        |
| Deployment | Vercel today; `output: 'standalone'` Docker image + Kustomize for k8s   |
| Quality    | Vitest (unit + integration), ESLint strict-type-checked + layer rules   |

## Quick start

```bash
corepack enable                      # provides the pinned pnpm version
pnpm install
cp .env.example .env
pnpm keys:generate                   # paste the printed values into the empty keys in .env
docker compose up -d                 # postgres, redis, S3 (SeaweedFS)
pnpm db:migrate
SEED_ADMIN_PASSWORD='choose-a-long-passphrase' pnpm db:seed
pnpm dev                             # http://localhost:3000
```

Smoke test:

```bash
curl -s localhost:3000/api/health/ready
curl -s -X POST localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' -H 'origin: http://localhost:3000' \
  -d '{"email":"admin@sipocot.gov.ph","password":"…","tokenDelivery":"bearer"}'
```

## Scripts

| Command                 | What it does                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| `pnpm verify`           | typecheck + lint + format check + unit tests (run before a PR)               |
| `pnpm test`             | unit tests (no infrastructure needed)                                        |
| `pnpm test:coverage`    | unit tests with coverage thresholds (85% lines)                              |
| `pnpm test:integration` | adapters against real Postgres/Redis (`TEST_DATABASE_URL`, `TEST_REDIS_URL`) |
| `pnpm db:generate`      | create a migration from `src/shared/infrastructure/db/schema.ts`             |
| `pnpm db:migrate`       | apply migrations (advisory-locked, safe to run concurrently)                 |
| `pnpm db:seed`          | idempotently create the first admin                                          |
| `pnpm keys:generate`    | print fresh encryption key, pepper, metrics/cron tokens                      |
| `pnpm audit:deps`       | fail on high/critical advisories in production dependencies                  |

## Project layout

```
src/
├── app/                        Next.js delivery only: thin route files, error boundaries
├── proxy.ts                    request id + CSP nonce (runs before every request)
├── instrumentation.ts          OpenTelemetry + server error hook
├── composition/                composition root: wires ports → adapters (only place that does)
├── modules/                    bounded contexts
│   ├── identity/               users, credentials, sessions, roles
│   │   ├── domain/             entities, value objects, events — pure TypeScript
│   │   ├── application/        use cases + ports (interfaces)
│   │   ├── infrastructure/     Drizzle repos, argon2, token service, Redis cache
│   │   └── interface/http/     request schemas + REST handlers
│   └── storage/                file metadata + S3 (same four layers)
└── shared/
    ├── domain/                 Result, AppError, branded ids, permission catalogue
    ├── application/            cross-cutting ports (Clock, Logger, RateLimiter, Encryptor…)
    ├── infrastructure/         config, db, redis, crypto, logging, metrics, rate limiting
    └── interface/http/         route factory, error boundary, cookies, problem details
tests/  unit/ (in-memory fakes) · integration/ (real Postgres + Redis) · support/
drizzle/                        SQL migrations (reviewed, committed)
scripts/                        migrate, seed, keys, backup/restore
deploy/                         k8s (Kustomize base + overlays + monitoring), local S3 config
docs/                           architecture, API, security, operations, runbooks, ADRs
```

Layer boundaries are enforced by ESLint (`eslint.config.mjs`): the domain cannot import zod, frameworks or I/O; the application layer cannot import adapters; route files cannot reach adapters directly.

## Documentation

- [Architecture](docs/architecture.md) — DDD / hexagonal design, request lifecycle, adding a feature
- [API reference](docs/api.md)
- [Security model](docs/security.md) — auth, sessions, encryption, rate limits, CSRF, headers
- [Operations](docs/operations.md) — deploying to Vercel and Kubernetes, monitoring, configuration
- [Backup & restore runbook](docs/runbooks/backup-restore.md)
- [Architecture decision records](docs/adr/)
