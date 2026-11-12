# Operations

## Configuration

All configuration is environment variables, validated by `src/shared/infrastructure/config/env.ts` on first use (the app refuses to serve rather than half-work). See `.env.example` for the full list. Production additionally requires `METRICS_TOKEN` and an `https://` `APP_URL`.

## Deploying to Vercel (current target)

1. **Managed services** (same region as the Vercel function region `sin1` in `vercel.json`):
   - Postgres with a pooled endpoint (Neon / Supabase / RDS + RDS Proxy). Set `DATABASE_PREPARE=false` for transaction poolers and `DATABASE_POOL_MAX=3` (each function instance holds its own pool).
   - Redis (Upstash / Redis Cloud) via `rediss://`.
   - S3 bucket with Block Public Access, SSE-KMS, versioning, and CORS allowing `POST` from your origin.
2. **Project:** import the repo in Vercel, set env vars for Production and Preview (separate databases!).
3. **Deploys:** `.github/workflows/deploy-vercel.yml` runs `db:migrate` _then_ deploys, so schema always leads code. Disable Vercel's automatic production deploys from Git to keep that order; keep preview deploys on.
4. **Cron:** `vercel.json` schedules `/api/internal/cron/purge-sessions`; set `CRON_SECRET` (Vercel sends it as a bearer token).
5. **Backups:** `.github/workflows/backup.yml` (nightly `pg_dump` → GPG → S3, followed by a restore drill). Configure the `production` environment secrets listed in that file.
6. **Observability:** logs → Vercel log drains; traces via `@vercel/otel` (or set `OTEL_EXPORTER_OTLP_ENDPOINT`).

Migration-compatibility rule: every migration must be compatible with the **currently running** code (expand → migrate → contract) because old and new instances overlap during rollout.

## Containers & Kubernetes (ready, not yet active)

```bash
docker build --target runner   -t sipocot-iam .
docker build --target migrator -t sipocot-iam-migrator .
docker build --target backup   -t sipocot-iam-backup .
docker compose --profile app up --build        # full local stack in containers
```

The runtime image is the Next.js standalone server: non-root (uid 10001), `tini` as PID 1 for signal handling, no package manager or source code.

Kustomize layout:

```
deploy/k8s/base/                 Deployment, Service, HPA, PDB, NetworkPolicies, Ingress,
                                 migrate Job, backup + purge CronJobs, ConfigMap
deploy/k8s/components/monitoring ServiceMonitor + PrometheusRule (Prometheus Operator)
deploy/k8s/overlays/staging      1–3 replicas, debug logging
deploy/k8s/overlays/production   3–10 replicas, monitoring, IRSA role
```

```bash
kubectl apply -k deploy/k8s/overlays/production            # after secrets exist
kubectl -n sipocot-iam wait --for=condition=complete job/sipocot-iam-migrate --timeout=10m
```

- Secrets come from External Secrets (`base/secret.example.yaml` lists the keys).
- S3 access via IRSA / workload identity: leave `S3_ACCESS_KEY_ID` unset.
- Pods: `readOnlyRootFilesystem`, all capabilities dropped, seccomp `RuntimeDefault`, namespace enforces Pod Security `restricted`.
- Probes: startup + liveness on `/api/health/live`, readiness on `/api/health/ready`; `preStop` sleep lets endpoints drain before SIGTERM.
- Network: default-deny; API pods accept traffic from the ingress controller, monitoring and cron pods only.
- Replace `ghcr.io/OWNER/...` image names and `iam.example.gov.ph` hosts in the base/overlays.

## Monitoring

| Signal  | Where                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Metrics | `/api/metrics` (Prometheus): `http_requests_total`, `http_request_duration_seconds`, `auth_events_total{event,outcome}`, `rate_limited_total{policy}`, Node.js process metrics |
| Alerts  | `deploy/k8s/components/monitoring/prometheusrule.yaml`: 5xx rate > 2%, p95 > 1s, login-failure spike, sustained rate limiting, failed backup job                               |
| Traces  | OpenTelemetry via `instrumentation.ts`                                                                                                                                         |
| Logs    | JSON to stdout; one `request completed` line per request with `requestId`, `route`, `status`, `durationMs`, `userId`                                                           |
| Audit   | `audit_events` table                                                                                                                                                           |
| Health  | `/api/health/live`, `/api/health/ready`                                                                                                                                        |

On Vercel, scrape `/api/metrics` is less useful (each instance has its own registry): rely on Vercel Observability + OTel traces, and use Prometheus metrics once on Kubernetes.

## Dependency scanning

| Tool                                   | When                            | Blocks?                          |
| -------------------------------------- | ------------------------------- | -------------------------------- |
| `pnpm audit --prod --audit-level high` | every PR/push, weekly           | yes                              |
| OSV-Scanner (lockfile)                 | every PR/push, weekly           | yes (reports to Security tab)    |
| Dependency Review                      | PRs                             | high severity, GPL/AGPL licenses |
| CodeQL `security-extended`             | every PR/push, weekly           | reports                          |
| gitleaks                               | every PR/push                   | yes                              |
| Grype (container)                      | CI image build                  | high+ with available fix         |
| Dependabot                             | weekly, 7-day cooldown, grouped | —                                |

## Incident quick reference

- **Credential stuffing:** check `auth_events_total` and `rate_limited_total`; tighten `RateLimits.loginByIp`; review `audit_events where type = 'identity.login_failed'`.
- **Compromised account:** `PATCH /api/v1/users/{id}/status {"status":"disabled"}` revokes all sessions instantly.
- **Leaked encryption key:** add a new key, make it active, re-encrypt (`needsReEncryption`), remove the old key, rotate DB credentials.
- **Restore data:** see [backup & restore runbook](runbooks/backup-restore.md).
