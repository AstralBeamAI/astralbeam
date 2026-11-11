#!/usr/bin/env bash

set -euo pipefail
umask 077

S3_URI="${1:-$S3_URI}"
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/postgres-backup.XXXXXXXX")
trap 'rm -rf -- "$work_dir"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

timestamp=$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")[:-3])')
destination="${S3_URI%/}/${timestamp:0:8}/$timestamp.dump.gpg"

pg_dump --dbname="$DATABASE_URL" --no-password --format=custom \
  --compress="${BACKUP_COMPRESSION:-zstd:3}" --lock-wait-timeout=5s --file="$work_dir/backup.dump"
gpg --batch --pinentry-mode loopback --no-symkey-cache --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --compress-algo none --output "$work_dir/backup.dump.gpg" \
  "$work_dir/backup.dump" <<< "$DATABASE_ENCRYPTION_KEY"
aws s3 cp "$work_dir/backup.dump.gpg" "$destination" --no-progress --no-cli-auto-prompt --no-cli-pager
