# Runbook: backup & restore

## What is backed up

| Store                      | Strategy                                                                                                                           | RPO                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Postgres (source of truth) | nightly encrypted `pg_dump -Fc` to S3 **plus** the provider's PITR (enable it: Neon/Supabase/RDS all offer point-in-time recovery) | PITR: minutes · dumps: 24 h |
| S3 files                   | bucket versioning + (recommended) cross-region replication; lifecycle rule expires non-current versions after 90 days              | ~0                          |
| Redis                      | **not backed up** — holds only a session cache (rebuilt from Postgres) and rate-limit counters                                     | n/a                         |

Dumps protect against logical errors and provider lock-in; PITR protects against recent mistakes. Use both.

## Schedule & retention

- Vercel phase: `.github/workflows/backup.yml` at 02:00 Asia/Manila, followed by an automatic **restore drill** into a throwaway Postgres.
- Kubernetes phase: `CronJob/sipocot-iam-backup` (same script, `backup` image target).
- Retention: S3 lifecycle on the backup bucket — e.g. keep daily 35 days, transition to Glacier after 30 days, expire after 400 days. Enable Object Lock (compliance mode) on the backup bucket to protect against ransomware/deletion.

## Required secrets

`BACKUP_DATABASE_URL` (read-only role), `BACKUP_S3_URI` (`s3://bucket/prefix`), `BACKUP_ENCRYPTION_PASSPHRASE` (store a copy offline — without it backups are unrecoverable), and AWS credentials via OIDC role (`BACKUP_AWS_ROLE_ARN`) or IRSA.

## Restore procedure

1. **Declare** the incident; stop writes if data is being corrupted (scale the deployment to 0 or put Vercel in maintenance).
2. **Pick the backup**: `aws s3 ls --recursive s3://<bucket>/postgres/ | sort | tail`.
3. **Restore into a new database** (never over the live one first):
   ```bash
   BACKUP_OBJECT=s3://<bucket>/postgres/2026/01/sipocot-iam-20260115T180000Z.dump.gpg \
   TARGET_DATABASE_URL=postgres://…/sipocot_iam_restore \
   BACKUP_ENCRYPTION_PASSPHRASE=… scripts/backup/pg-restore.sh
   ```
   The script verifies the checksum, decrypts, validates the archive and refuses to write into a non-empty database unless `RESTORE_CONFIRM=yes-overwrite`.
4. **Migrate forward** if the dump predates the current schema: `MIGRATION_DATABASE_URL=… pnpm db:migrate`.
5. **Verify**: row counts, latest `audit_events.occurred_at`, log in as a test user.
6. **Cut over**: point `DATABASE_URL` at the restored database (or rename databases), redeploy, run `/api/health/ready`.
7. **Invalidate sessions** if the restore rolled back credentials: flush the Redis cache (`redis-cli --scan --pattern 'sipocot-iam:sess:*' | xargs redis-cli del`).
8. **Post-mortem**: record RPO/RTO achieved, update this runbook.

## Drill

`scripts/backup/verify-restore.sh` restores the newest dump into `SCRATCH_DATABASE_URL` and checks key tables. It runs automatically after each scheduled backup; a failure pages via the workflow notification / `SipocotIamBackupFailed` alert.
