#!/usr/bin/env bash
# Restore an encrypted backup produced by pg-backup.sh.
#
#   BACKUP_OBJECT=s3://bucket/postgres/2026/01/sipocot-iam-20260115T020000Z.dump.gpg \
#   TARGET_DATABASE_URL=postgres://... BACKUP_ENCRYPTION_PASSPHRASE=... ./pg-restore.sh
#
# Refuses to overwrite a non-empty database unless RESTORE_CONFIRM=yes-overwrite.
set -euo pipefail

: "${BACKUP_OBJECT:?BACKUP_OBJECT (s3 uri) is required}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE is required}"

work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT

aws s3 cp --only-show-errors "$BACKUP_OBJECT" "$work/b.gpg"
aws s3 cp --only-show-errors "$BACKUP_OBJECT.sha256" "$work/b.sha256"
echo "$(cat "$work/b.sha256")  $work/b.gpg" | sha256sum --check --status || { echo "checksum mismatch" >&2; exit 1; }

gpg --batch --quiet --decrypt --passphrase-fd 3 --output "$work/b.dump" "$work/b.gpg" 3<<<"$BACKUP_ENCRYPTION_PASSPHRASE"
pg_restore --list "$work/b.dump" >/dev/null # validates archive integrity

tables="$(psql "$TARGET_DATABASE_URL" -Atc "select count(*) from information_schema.tables where table_schema='public'")"
if [ "$tables" != "0" ] && [ "${RESTORE_CONFIRM:-}" != "yes-overwrite" ]; then
  echo "target database is not empty (${tables} tables). Set RESTORE_CONFIRM=yes-overwrite to replace it." >&2
  exit 2
fi

pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --jobs=4 --dbname="$TARGET_DATABASE_URL" "$work/b.dump"
echo "restore complete"
