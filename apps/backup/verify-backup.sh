#!/bin/bash
set -euo pipefail

: "${RUNLY_INSTANCE_ID:?RUNLY_INSTANCE_ID is required}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${RESTIC_PASSWORD:?RESTIC_PASSWORD is required}"

export RESTIC_REPOSITORY="s3:${BACKUP_S3_ENDPOINT}/${BACKUP_S3_BUCKET}/${RUNLY_INSTANCE_ID}"
export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:-}"
export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:-}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
MAX_AGE_SECONDS=$(( RETENTION_DAYS * 24 * 3600 / 2 ))

echo "[verify] listing snapshots in ${RESTIC_REPOSITORY}..."
LATEST_JSON="$(restic snapshots --json --host "${RUNLY_INSTANCE_ID}" | jq -c 'sort_by(.time) | last')"

if [ -z "$LATEST_JSON" ] || [ "$LATEST_JSON" = "null" ]; then
  echo "[verify] FAILED: no snapshots found for host ${RUNLY_INSTANCE_ID}." >&2
  exit 1
fi

LATEST_TIME="$(echo "$LATEST_JSON" | jq -r '.time')"
LATEST_EPOCH="$(date -d "$LATEST_TIME" +%s)"
NOW_EPOCH="$(date +%s)"
AGE_SECONDS=$(( NOW_EPOCH - LATEST_EPOCH ))

echo "[verify] latest snapshot: $LATEST_TIME ($(( AGE_SECONDS / 3600 )) hours ago)"

if [ "$AGE_SECONDS" -gt "$MAX_AGE_SECONDS" ]; then
  echo "[verify] FAILED: latest snapshot is older than $(( MAX_AGE_SECONDS / 3600 )) hours (half the retention window)." >&2
  exit 1
fi

echo "[verify] running restic check (integrity)..."
if ! restic check; then
  echo "[verify] FAILED: restic check reported errors." >&2
  exit 1
fi

echo "[verify] OK — backup is healthy."
