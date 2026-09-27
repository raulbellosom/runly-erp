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
# Absolute path is required, not just cosmetic: when the shell resolves a
# bare "supercronic" via PATH, argv[0] still gets passed to the new process
# as the literal string "supercronic" (shells don't rewrite argv[0] on PATH
# resolution). supercronic's own PID-1 reaper does a self-referential
# fork+exec using argv[0], and the kernel's exec() syscall never searches
# PATH — only shells do — so that self-exec fails with "no such file or
# directory" and the container crash-loops. Verified against a real build.
exec /usr/local/bin/supercronic /app/crontab
