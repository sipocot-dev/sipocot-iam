#!/usr/bin/env bash
# Encrypted logical backup of Postgres to S3.
#
# Required env:
#   DATABASE_URL                  source database (read-only role is enough)
#   BACKUP_S3_URI                 e.g. s3://sipocot-iam-backups/postgres
#   BACKUP_ENCRYPTION_PASSPHRASE  symmetric passphrase (store in secret manager)
# Optional:
#   AWS_ENDPOINT_URL              S3-compatible endpoint (MinIO, R2)
#   BACKUP_SSE                    aws:kms | AES256 (default AES256)
#
# Output objects:  <prefix>/YYYY/MM/sipocot-iam-<UTC timestamp>.dump.gpg (+ .sha256)
# Retention: configure an S3 lifecycle rule (see docs/runbooks/backup-restore.md).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_URI:?BACKUP_S3_URI is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"
SSE="${BACKUP_SSE:-AES256}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
key="$(date -u +%Y/%m)/sipocot-iam-${ts}.dump.gpg"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
out="$work/backup.dump.gpg"

log() { printf '{"level":"%s","msg":"%s","ts":"%s"}\n' "$1" "$2" "$(date -u +%FT%TZ)"; }

log info "starting pg_dump"
# -Fc: compressed custom format (parallel, selective restore). No owners/ACLs: restore into any role.
pg_dump --format=custom --compress=9 --no-owner --no-privileges --dbname="$DATABASE_URL" \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --compress-algo none \
        --passphrase-fd 3 --output "$out" 3<<<"$BACKUP_ENCRYPTION_PASSPHRASE"

size="$(wc -c <"$out" | tr -d ' ')"
if [ "$size" -lt 1024 ]; then log error "backup suspiciously small (${size} bytes)"; exit 1; fi
sha256sum "$out" | awk '{print $1}' >"$out.sha256"

log info "uploading ${size} bytes to ${BACKUP_S3_URI}/${key}"
aws s3 cp --only-show-errors --sse "$SSE" "$out" "${BACKUP_S3_URI}/${key}"
aws s3 cp --only-show-errors --sse "$SSE" "$out.sha256" "${BACKUP_S3_URI}/${key}.sha256"
log info "backup complete: ${key}"
