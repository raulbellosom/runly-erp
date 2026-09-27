# Backup and Recovery Runbook

Spec: [docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md](../superpowers/specs/2026-09-26-backup-recovery-system-design.md)

This feature is opt-in (`BACKUP_MODE=enabled` in `.env.local`/`.env.external`).
Restore is **always manual** — there is no automated restore path, by design
(see the spec's Non-goals). Follow this runbook step by step.

## Prerequisites

- Access to the same `BACKUP_S3_ENDPOINT`/`BACKUP_S3_BUCKET`/credentials the
  instance backed up to.
- The instance's `RESTIC_PASSWORD` (from `.env.local`/`.env.external`, or
  wherever you saved it externally per the one-time setup warning).
- The instance's `RUNLY_INSTANCE_ID` (same env file) — snapshots are
  namespaced by it.
- Docker, to run the `runly-backup` image as a one-off container.

## 1. List available snapshots

```bash
docker run --rm \
  -e RESTIC_REPOSITORY="s3:$BACKUP_S3_ENDPOINT/$BACKUP_S3_BUCKET/$RUNLY_INSTANCE_ID" \
  -e RESTIC_PASSWORD="$RESTIC_PASSWORD" \
  -e AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  raulbellosom/runlyerp:backup-latest \
  restic snapshots --host "$RUNLY_INSTANCE_ID"
```

Note the snapshot ID (or use `latest`) you want to restore.

## 2. Restore the snapshot to a local directory

```bash
docker run --rm \
  -e RESTIC_REPOSITORY="s3:$BACKUP_S3_ENDPOINT/$BACKUP_S3_BUCKET/$RUNLY_INSTANCE_ID" \
  -e RESTIC_PASSWORD="$RESTIC_PASSWORD" \
  -e AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID" \
  -e AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_ACCESS_KEY" \
  -v "$PWD/restore:/restore" \
  raulbellosom/runlyerp:backup-latest \
  restic restore latest --target /restore --host "$RUNLY_INSTANCE_ID"
```

This produces `./restore/<scratch-dir-name>/{db.dump, storage/, config/}` on
your machine.

## 3. Restore Postgres

Point this at the target Postgres instance (a fresh one, or the same one
after fixing the underlying disk issue):

```bash
docker run --rm \
  --network <compose-project>_default \
  -v "$PWD/restore:/restore" \
  raulbellosom/runlyerp:backup-latest \
  pg_restore --clean --if-exists -d "$DATABASE_URL" /restore/<scratch-dir-name>/db.dump
```

`--network <compose-project>_default` is only needed when `DATABASE_URL` resolves a
Docker Compose service name (local mode) — omit it when the target Postgres is
reachable directly (typical for external mode).

**Expect `pg_restore` to report hundreds of ignored errors about event triggers
(e.g. `issue_pg_cron_access`, `pgrst_ddl_watch`) — this is normal, not a failed
restore.** The dump includes Supabase's own internal event triggers, which a
fresh `supabase-db` container already creates from its own init scripts before
you ever restore anything; `pg_restore` cannot recreate them as the non-superuser
`postgres` role Supabase self-hosted uses. Verified against a real restore
(disposable Backblaze B2 bucket, 2026-09-27): despite ~750 such warnings,
`_prisma_migrations` and every Runly application table (`company`, `membership`,
`runly_module`, `permission`, `role`, etc.) restored with their exact row counts
intact. Confirm the restore actually worked by querying your own data, not by
checking `pg_restore`'s exit code.

Verify: connect and confirm `Company`/`Membership`/module tables have the
expected row counts for the snapshot's date.

## 4. Restore Supabase Storage files

- **Local mode:** copy `./restore/<scratch-dir-name>/storage/*` back into the
  `supabase-storage-data` Docker volume (e.g. via a temporary container that
  mounts that volume and `cp -a`s the restored tree into it), then restart
  `supabase-storage`.
- **External mode:** upload `./restore/<scratch-dir-name>/storage/<bucket>/*`
  back into each corresponding bucket on the target Supabase instance (via
  its Storage API, the Studio UI, or `rclone copy` against its S3-protocol
  endpoint if available).

## 5. Restore instance config (full disaster recovery only)

Only needed when rebuilding a destroyed VPS from scratch: copy
`./restore/<scratch-dir-name>/config/.env.local` (or `.env.external`) and, in
local mode, `./restore/<scratch-dir-name>/config/supabase-db-init/*` back
into a fresh `infra/installer` checkout at the same paths, **before**
running `setup-local.mjs`/`setup-external.mjs` for the first time on the new
machine.

## 6. Verify a backup without restoring anything

Run this any time (also suitable for wiring into external monitoring), from
your `infra/installer` checkout:

`docker compose` alone does not know the `supabase-storage-data` volume local
mode's `runly-backup-local` service mounts — it is declared in
`supabase/docker-compose.supabase.yml`, a separate file the installer always
passes alongside the rest. Running without it fails with `refers to
undefined volume supabase-storage-data: invalid compose project`. Pass the
same files the installer itself uses (add `-f docker-compose.linux.yml` only
if that file exists in your checkout, which it does on Linux):

```bash
# local mode
docker compose -f docker-compose.yml -f docker-compose.linux.yml -f supabase/docker-compose.supabase.yml \
  --profile backup-local run --rm runly-backup-local ./verify-backup.sh
# external mode
docker compose -f docker-compose.yml -f docker-compose.linux.yml \
  --profile backup-external run --rm runly-backup-external ./verify-backup.sh
```

Exits non-zero if the latest snapshot is older than half the retention
window, or if `restic check` finds repository corruption.
