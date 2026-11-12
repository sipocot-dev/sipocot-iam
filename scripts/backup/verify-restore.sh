#!/usr/bin/env bash
# Backup drill: restore the most recent backup into a scratch database and run
# sanity checks. Run on a schedule (see .github/workflows/backup.yml) — an
# untested backup is not a backup.
#   BACKUP_S3_URI, BACKUP_ENCRYPTION_PASSPHRASE, SCRATCH_DATABASE_URL
set -euo pipefail
: "${BACKUP_S3_URI:?}"; : "${BACKUP_ENCRYPTION_PASSPHRASE:?}"; : "${SCRATCH_DATABASE_URL:?}"

latest="$(aws s3 ls --recursive "${BACKUP_S3_URI}/" | awk '{print $4}' | grep '\.dump\.gpg$' | sort | tail -1)"
[ -n "$latest" ] || { echo "no backups found" >&2; exit 1; }
bucket="$(echo "$BACKUP_S3_URI" | sed -E 's#^(s3://[^/]+).*#\1#')"

BACKUP_OBJECT="${bucket}/${latest}" TARGET_DATABASE_URL="$SCRATCH_DATABASE_URL" RESTORE_CONFIRM=yes-overwrite \
  "$(dirname "$0")/pg-restore.sh"

psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 -At <<'SQL'
select 'users=' || count(*) from users;
select 'sessions=' || count(*) from sessions;
select 'audit_events=' || count(*) from audit_events;
select 'migrations=' || count(*) from drizzle.__drizzle_migrations;
SQL
echo "restore drill OK for ${latest}"
