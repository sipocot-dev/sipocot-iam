# ADR 0001 — Next.js route handlers as the delivery mechanism

- Status: accepted
- Date: 2026-11-13

## Context

Initial deployment target is Vercel, with a requirement to move to containers / Kubernetes later. The service is API-first (REST).

## Decision

Use Next.js 16 App Router **route handlers** purely as the HTTP delivery layer. All behaviour lives in framework-free domain/application code; `src/app/**/route.ts` files are one-line re-exports of handlers built with our own `route()` factory. Build with `output: 'standalone'` so the same code runs as a plain Node server in a container.

## Consequences

- Zero-config Vercel deploys and preview environments; portable Docker image.
- Framework lock-in is limited to `src/app`, `proxy.ts`, `instrumentation.ts` and `NextRequest` in the route factory — replacing Next.js with Fastify/Hono touches only the interface layer.
- Next.js upgrade cadence must be tracked (grouped Dependabot PRs).
- Serverless implies per-instance connection pools → pooled Postgres endpoint on Vercel.
