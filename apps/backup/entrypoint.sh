#!/bin/bash
set -euo pipefail

# With no arguments (the normal `docker compose up` path — CMD [] in
# backup.Dockerfile means $# is 0 here), render the crontab from
# BACKUP_SCHEDULE_CRON (known only at container start, since it comes from
# .env.local/.env.external via env_file) and hand off to supercronic, which
# forwards each job's stdout/stderr into its own stdout — this is what
# `docker compose logs` shows, matching every other installer-managed
# sidecar in this repo.
#
# With arguments — e.g. `docker compose run --rm runly-backup-local
# ./run-backup.sh` or `./verify-backup.sh`, as used throughout
# docs/deployment/backup-recovery.md and infra/installer/README.md — exec
# them directly instead of starting the cron daemon. This is the same
# flexible-entrypoint pattern the base postgres:17-alpine image itself uses.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "${BACKUP_SCHEDULE_CRON:-0 3 * * *} /app/run-backup.sh" > /app/crontab
exec supercronic /app/crontab
