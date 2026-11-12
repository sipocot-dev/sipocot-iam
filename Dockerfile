# syntax=docker/dockerfile:1.7
# Multi-target image:
#   runner   (default) — Next.js standalone server, non-root, minimal
#   migrator           — runs database migrations (Kubernetes Job / CI)
#   backup             — pg_dump → gpg → S3 (Kubernetes CronJob)

ARG NODE_VERSION=22.23-alpine3.23
ARG PNPM_VERSION=10.34.8

FROM node:${NODE_VERSION} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ── dependencies (cached layer) ──────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
RUN pnpm build

# ── migrator ─────────────────────────────────────────────────────────────────
FROM deps AS migrator
COPY tsconfig.json ./
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src ./src
USER node
CMD ["node", "--import", "tsx", "scripts/db/migrate.ts"]

# ── backup ───────────────────────────────────────────────────────────────────
FROM postgres:17-alpine AS backup
RUN apk add --no-cache aws-cli gnupg bash coreutils \
 && adduser -D -u 10001 backup
COPY --chmod=0755 scripts/backup/*.sh /usr/local/bin/
USER 10001
ENTRYPOINT ["/usr/local/bin/pg-backup.sh"]

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION} NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN apk add --no-cache tini && addgroup -S -g 10001 app && adduser -S -u 10001 -G app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER 10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health/live || exit 1
# tini reaps zombies and forwards SIGTERM so in-flight requests drain on shutdown.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
