#!/bin/bash
set -euo pipefail

: "${RUNLY_INSTANCE_ID:?RUNLY_INSTANCE_ID is required}"
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"

# Namespaced by RUNLY_INSTANCE_ID so two instances can safely share one
# bucket (design spec, Edge case 8).
export RESTIC_REPOSITORY="s3:${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/${RUNLY_INSTANCE_ID}"
export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}"
export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"

SCRATCH_DIR="$(mktemp -d)"

# Alerts on failure only (a nightly "all good" email would just be noise).
# Reuses the same SMTP_*/RUNLY_SUPPORT_EMAIL vars the API already uses for
# bug reports (docker-compose.yml's env_file already exposes .env.local's
# vars to this container) — no new configuration needed to get alerts.
# `set -e` means any failing command (pg_dump, restic, etc.) exits the script
# immediately with a non-zero code, which this trap always sees.
send_failure_alert() {
  local exit_code=$1
  [ "$exit_code" -eq 0 ] && return 0
  if [ -z "${SMTP_HOST:-}" ]; then
    echo "[backup] SMTP_HOST not set — cannot send failure alert" >&2
    return 0
  fi
  local to="${RUNLY_SUPPORT_EMAIL:-hola@runly.mx}"
  local from="${SMTP_FROM_EMAIL:-${SMTP_USER:-runly-backup@localhost}}"
  local curl_args=(--fail --silent --show-error
    --url "smtp://${SMTP_HOST}:${SMTP_PORT:-587}"
    --mail-from "$from"
    --mail-rcpt "$to"
    --upload-file -)
  [ "${SMTP_TLS:-false}" = "true" ] && curl_args+=(--ssl-reqd)
  [ -n "${SMTP_USER:-}" ] && curl_args+=(--user "${SMTP_USER}:${SMTP_PASS:-}")
  if {
    printf 'Subject: [Runly backup] Fallo en %s\n' "${RUNLY_INSTANCE_ID}"
    printf 'From: %s\n' "$from"
    printf 'To: %s\n\n' "$to"
    printf 'El backup nocturno de la instancia %s fallo (codigo de salida %s).\n' "${RUNLY_INSTANCE_ID}" "$exit_code"
    printf 'Revisa los logs del contenedor de backup en el VPS (docker logs runly-backup-local o runly-backup-external).\n'
  } | curl "${curl_args[@]}"; then
    echo "[backup] failure alert emailed to $to"
  else
    echo "[backup] WARNING: could not send failure alert email" >&2
  fi
}
trap 'send_failure_alert $?; rm -rf "$SCRATCH_DIR"' EXIT

echo "[backup] $(date -Iseconds) starting backup run (repo: ${RESTIC_REPOSITORY})"

echo "[backup] dumping Postgres..."
pg_dump "$DATABASE_URL" -Fc -f "$SCRATCH_DIR/db.dump"

mkdir -p "$SCRATCH_DIR/storage" "$SCRATCH_DIR/config"

# Local mode: docker-compose.yml mounts supabase-storage-data read-only at
# /storage-source. A plain file-tree copy backs up every bucket without
# enumerating names or holding Storage credentials (design spec, Section 20).
if [ -d /storage-source ] && [ -n "$(ls -A /storage-source 2>/dev/null)" ]; then
  echo "[backup] copying Supabase Storage files from mounted volume..."
  cp -a /storage-source/. "$SCRATCH_DIR/storage/"
elif [ -n "${BACKUP_STORAGE_S3_ENDPOINT:-}" ] && [ -n "${BACKUP_STORAGE_S3_ACCESS_KEY_ID:-}" ] && [ -n "${BACKUP_STORAGE_S3_SECRET_ACCESS_KEY:-}" ]; then
  # External mode: no shared volume across hosts, so read via Supabase
  # Storage's own S3-protocol endpoint instead (design spec, Section 20).
  echo "[backup] syncing Supabase Storage files via S3 protocol..."
  export RCLONE_CONFIG_RUNLYSTORAGE_TYPE=s3
  export RCLONE_CONFIG_RUNLYSTORAGE_PROVIDER=Other
  export RCLONE_CONFIG_RUNLYSTORAGE_ENV_AUTH=false
  export RCLONE_CONFIG_RUNLYSTORAGE_ACCESS_KEY_ID="${BACKUP_STORAGE_S3_ACCESS_KEY_ID}"
  export RCLONE_CONFIG_RUNLYSTORAGE_SECRET_ACCESS_KEY="${BACKUP_STORAGE_S3_SECRET_ACCESS_KEY}"
  export RCLONE_CONFIG_RUNLYSTORAGE_ENDPOINT="${BACKUP_STORAGE_S3_ENDPOINT}"
  for bucket in runly-files runly-website; do
    mkdir -p "$SCRATCH_DIR/storage/$bucket"
    if ! rclone sync "runlystorage:$bucket" "$SCRATCH_DIR/storage/$bucket" --fast-list; then
      echo "[backup] WARNING: rclone sync failed for bucket $bucket (continuing)" >&2
    fi
  done
else
  echo "[backup] no Storage source available (no mounted volume, no BACKUP_STORAGE_S3_* configured) — skipping Storage backup."
fi

# docker-compose.yml bind-mounts .env.local/.env.external (and, in local
# mode, supabase/volumes/db/*.sql) read-only at /config-source.
if [ -d /config-source ]; then
  echo "[backup] copying instance config files..."
  cp -a /config-source/. "$SCRATCH_DIR/config/"
fi

if ! restic snapshots >/dev/null 2>&1; then
  echo "[backup] initializing restic repository..."
  restic init
fi
restic unlock || echo "[backup] WARNING: restic unlock failed (continuing)" >&2

echo "[backup] creating restic snapshot..."
restic backup "$SCRATCH_DIR" --tag runly --host "${RUNLY_INSTANCE_ID}"

echo "[backup] verifying repository integrity before pruning..."
if restic check; then
  echo "[backup] check OK — pruning snapshots older than ${BACKUP_RETENTION_DAYS:-14} days"
  restic forget --keep-daily "${BACKUP_RETENTION_DAYS:-14}" --prune
else
  # Do not prune on a failed check — a corrupt/incomplete run must never
  # cost us the last known-good snapshots (design spec, Edge case 6).
  echo "[backup] restic check FAILED — skipping prune to preserve existing snapshots" >&2
  exit 1
fi

echo "[backup] $(date -Iseconds) backup run complete"
