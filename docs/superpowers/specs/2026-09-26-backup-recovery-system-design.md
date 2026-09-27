# Backup and Recovery System (infra/installer)

Date: 2026-09-26
Status: Draft
Author: Claude (brainstorming session with Raul Belloso Medina)
Spec file: docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md
Plan file: docs/superpowers/plans/2026-09-26-backup-recovery-system.md (created after spec approval)

---

## 1. Feature title

Backup and Recovery System for `infra/installer` (self-hosted Supabase Postgres, Storage, and instance config).

## 2. Status

Draft

## 3. Context

Runly ERP instances installed via `infra/installer` run against a single VPS's disks: in `local`/`selfhosted` mode, Postgres and Supabase Storage live in Docker volumes on that same VPS; in `external` mode, they live on a separate Supabase host that the operator controls. Neither mode currently has any Runly-managed backup mechanism. `infra/supabase/README.md` is an explicitly deprecated stub, and no automated backup/restore path exists anywhere in `infra/installer`. A single disk failure, accidental `DROP`/bad migration, or lost VPS currently means unrecoverable data loss for any instance that hasn't set up its own ad hoc backup process outside of Runly.

## 4. Problem

There is no supported way for an operator of a Runly ERP installation to protect against permanent data loss from a damaged/lost disk, a destroyed VPS, or an operator mistake (bad migration, accidental delete). Recovering currently requires the operator to have already built their own backup tooling outside of Runly — most installations have none.

## 5. Goals

1. An operator running `infra/installer` in `local` (`selfhosted`) mode can enable automated, encrypted, off-VPS daily backups of Postgres data, Supabase Storage files, and instance configuration/secrets, with a single env var.
2. An operator running `infra/installer` in `external` mode can enable the same automated Postgres backup with the same env var; Storage/config backup in that mode is best-effort and explicitly documented as depending on the operator's own Supabase exposing an S3-compatible endpoint.
3. Backups are stored on S3-compatible remote storage (any provider: Backblaze B2, AWS S3, MinIO, etc.), never solely on the same disk as the source data.
4. Old backups are pruned automatically according to a configurable retention window, so storage cost doesn't grow unbounded.
5. An operator can verify, at any time, that the latest backup exists, is recent, and is not corrupted, without performing a full restore.
6. An operator can follow a documented, manual, step-by-step runbook to restore Postgres, Storage, and config from a backup snapshot, including the disaster-recovery case of rebuilding a destroyed VPS from scratch.
7. Enabling this feature has zero effect on any existing installation that doesn't opt in (`BACKUP_MODE=disabled` is the default, matching the existing `TRANSCRIPTION_MODE`/`MIRAI_TTS_MODE` pattern).

## 6. Non-goals

1. Automatic/unattended restore. Restore is always a deliberate, manual, human-run operation — never triggered by a script or by this feature detecting a failure.
2. Point-in-time recovery (PITR) / continuous WAL archiving. This version ships daily snapshot backups only; PITR is listed under Future enhancements.
3. Backing up LiveKit Egress recordings, the Whisper model cache, or the Collabora/Office document store — these are not `FileAsset`-tracked application data and are out of scope for v1.
4. A backup UI/dashboard inside the Runly desktop app. This is an installer/ops-level feature, configured via `.env.local`/`.env.external` like every other optional installer feature (LiveKit, transcription, TTS, Office).
5. Full Storage backup automation in `external` mode when the operator's Supabase does not expose an S3-compatible protocol endpoint — that case is documented as a manual, operator-owned responsibility.
6. Cross-region/multi-provider redundancy (backing up to two different remote providers simultaneously).
7. Any change to `prisma/schema.prisma`, RME3 modules, the API, the SDK, or the desktop app. This feature lives entirely in `infra/installer` and `apps/backup`.

## 7. User stories

- As an operator running a self-hosted Runly instance, I want to enable daily encrypted backups with one env var so that a disk failure or lost VPS doesn't mean permanent data loss.
- As an operator, I want backups pruned automatically after a configurable retention window so that remote storage cost doesn't grow forever.
- As an operator, I want a way to verify my backups are actually working (recent, uncorrupted) without doing a full restore, so silent failures (expired credentials, full disk, etc.) don't go unnoticed until it's too late.
- As an operator recovering from a lost VPS, I want a documented step-by-step runbook so I can rebuild Postgres, Storage, and instance config from the last good backup without guessing.
- As an operator running `external` mode, I want Postgres backup to work the same way it does in `local` mode, since `DATABASE_URL` is already the same shape in both `.env.local` and `.env.external`.

## 8. UX requirements

N/A — this feature has no UI. All configuration is via environment variables in `.env.local`/`.env.external` (edited by the operator, same as `LIVEKIT_*`/`TRANSCRIPTION_MODE`/`MIRAI_TTS_MODE`). All operator-facing output is installer console output (`setup-local.mjs`/`setup-external.mjs` logs) and `docker compose logs` from the backup container — both already established patterns in this codebase (see `infra/installer/README.md`, "Reporte de production readiness"). Any operator-facing warning text follows the existing installer convention of Spanish console messages.

## 9. Routes/screens

N/A — no frontend routes or screens. This is an installer-level, container-based feature.

## 10. Data model

N/A — no new Prisma models or RME3 `defineModel` entities. This feature does not touch the application data model; it captures and ships existing data (Postgres dump, Storage files, config files) to remote storage.

### Configuration surface (not a data model, but the feature's persisted state)

New env vars, persisted in `.env.local` / `.env.external` by `lib/backup-config.mjs` (same mechanism as `lib/livekit-config.mjs`, `lib/supabase-selfhosted-config.mjs`):

| Variable | Meaning | Generated or operator-provided |
|---|---|---|
| `BACKUP_MODE` | `disabled` (default) \| `enabled` | Operator-set |
| `BACKUP_SCHEDULE_CRON` | Cron expression for the daily job | Operator-set, default `0 3 * * *` |
| `BACKUP_RETENTION_DAYS` | Days of daily snapshots to keep | Operator-set, default `14` |
| `BACKUP_S3_ENDPOINT` | S3-compatible endpoint for the restic repo | Operator-provided |
| `BACKUP_S3_BUCKET` | Bucket name for the restic repo | Operator-provided |
| `BACKUP_S3_REGION` | Region string (provider-dependent) | Operator-provided |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | Credentials for the restic repo bucket | Operator-provided |
| `RESTIC_PASSWORD` | Encryption password for the restic repo | Auto-generated once, persisted, **never regenerated** |
| `BACKUP_STORAGE_S3_ENDPOINT` / `_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | Read-only access to Supabase Storage's own S3-protocol endpoint, used only in `external` mode to copy files for backup | Operator-provided (optional), `external` mode only — `local` mode does not need these (see Section 20) |

The restic repository target is constructed as `s3:$BACKUP_S3_ENDPOINT/$BACKUP_S3_BUCKET/$RUNLY_INSTANCE_ID`, reusing the per-instance `RUNLY_INSTANCE_ID` that `setup-local.mjs`/`setup-external.mjs` already generate and persist (see `infra/installer/README.md`, "Multiples instancias de Runly en el mismo host"). This lets two Runly instances safely share one bucket without colliding, and resolves Edge case 8 below.

## 11. Prisma impact

New models: N/A
Modified models: N/A
New migration required: No
Migration safety notes: N/A

## 12. API contract

N/A — no HTTP endpoints. All operations are triggered by cron inside the `runly-backup-*` container or run manually via `docker compose run`.

## 13. SDK contract

N/A — no `@runly/sdk` changes.

## 14. Validator contract

N/A — no `@runly/validators` changes. `lib/backup-config.mjs` validates its own env vars internally (plain JS checks), matching the pattern already used by `lib/livekit-config.mjs`/`lib/supabase-selfhosted-config.mjs`, none of which use Zod either (those are installer-time config files, not API request bodies).

## 15. Module manifest impact

N/A — not an RME3 module. No `module.manifest.js`, no `defineRunlyModule`, no dependency on `runly.core`/`runly.identity`. This feature is infra tooling, not an ERP feature module, and is not installed/enabled/disabled through `POST /modules/*`.

## 16. Navigation impact

N/A — no navigation items, no desktop app changes.

## 17. Blueprint impact

N/A

## 18. RBAC/permissions

N/A — no `Permission`/`Role` rows, no `requirePermission` guards. Access control for this feature is entirely at the infra level: whoever can edit `.env.local`/`.env.external` and run `docker compose` on the VPS controls it, same as every other installer-level setting (`LIVEKIT_API_SECRET`, `JWT_SECRET`, etc.).

## 19. Multi-company behavior

N/A — backups operate at the whole-database/whole-bucket level, below the `Company`/`Membership` tenancy layer. A restore brings back all companies in that instance as of the snapshot time; there is no per-company backup/restore in this version (a shared-instance deployment with multiple companies restores all of them together, which matches how a single Postgres/Storage instance already works today).

## 20. Files/storage impact

This feature reads (never writes, in normal operation) from Supabase Storage:
- **Local/selfhosted mode:** the `runly-backup-local` container mounts the existing `supabase-storage-data` Docker volume read-only (same Compose project/volume namespace as `infra/installer/supabase/docker-compose.supabase.yml`) and copies its contents directly — a plain file-tree copy, not an API/S3 call. This backs up every bucket (`runly-files`, `runly-website`, and any future one) without needing to enumerate bucket names or hold Storage credentials at all.
- **External mode:** no shared volume is possible (Storage lives on a different host), so this mode instead reads via Supabase Storage's own S3-protocol endpoint (`STORAGE_BACKEND: file` with `S3_PROTOCOL_ACCESS_KEY_ID/SECRET`, the same mechanism `infra/installer/supabase/docker-compose.supabase.yml` already enables for LiveKit Egress), syncing the known bucket names (`runly-files`, `runly-website`) with `rclone`. This only runs if the operator supplies `BACKUP_STORAGE_S3_*`; otherwise this step is skipped with a clear log line, and DB + config backup still proceed normally.

No `FileAsset` metadata is read or written — the backup operates on the physical Storage bucket contents, not through the Runly API.

## 21. Export/import requirements

N/A — not a user-facing export/import feature. (The backup snapshot itself is conceptually an export, but it is a restic-managed binary repository, not a PDF/Excel/CSV artifact.)

## 22. Audit log requirements

N/A — no `AuditLog` rows. Backup runs and their outcomes are recorded in `docker compose logs runly-backup-*` (via the container's stdout, captured by `supercronic`), which is the existing convention for all installer-managed background services in this repo (LiveKit, transcriber, TTS all log to stdout, no `AuditLog` table entries).

## 23. Edge cases

1. `BACKUP_MODE=enabled` but one or more required `BACKUP_S3_*` vars are missing → `lib/backup-config.mjs` fails the setup script with a clear error, rather than starting a container that will fail silently every night.
2. `BACKUP_STORAGE_S3_*` not available (external mode, operator didn't configure their Supabase's S3 protocol) → storage step is skipped with an explicit log line; DB and config backups still run and succeed. (Local mode never depends on this — see Section 20.)
3. Restic repository doesn't exist yet at the target bucket path → first run auto-initializes it (`restic init` if `restic snapshots` fails with "repository does not exist").
4. Backup container restarts mid-run (VPS reboot, OOM) → next scheduled run simply creates a new snapshot; restic's own repository locking prevents a concurrent partial run from corrupting the repo. A stale lock left by a hard-killed process is cleared with `restic unlock` before each run.
5. `RESTIC_PASSWORD` lost by the operator → explicitly unrecoverable; this is why the setup script prints a one-time, loud, impossible-to-miss warning the first time it generates this secret, telling the operator to store it outside the VPS (password manager), the same way `LIVEKIT_API_SECRET` generation is already handled without one — this is the first secret in this installer where losing it destroys otherwise-intact remote data, so the warning text must say that explicitly.
6. Retention pruning (`restic forget --prune`) runs immediately after every backup, so a backup that succeeds but produces a corrupt/incomplete snapshot could have older good snapshots pruned before the problem is noticed → mitigated by `restic check` running as part of the same job before pruning; if `check` fails, the job aborts and skips the `forget --prune` step for that run, leaving all previous snapshots intact.
7. Operator changes `BACKUP_S3_BUCKET`/`BACKUP_S3_ENDPOINT` after backups already exist → the container will initialize a brand-new empty repo at the new location; this is a deliberate operator action and is documented, not auto-migrated.
8. Two Runly instances on the same host (per `infra/installer/README.md`'s "Multiples instancias" section) both enable backup, potentially pointed at the same `BACKUP_S3_BUCKET` → each instance's restic repository path is namespaced by its own `RUNLY_INSTANCE_ID` (Section 10), so they never collide even sharing one bucket.
9. `BACKUP_MODE=enabled` in `local` mode while `RUNLY_SUPABASE_MODE=cli-dev` → rejected with a clear error at setup time. The `supabase-storage-data` Docker volume that local-mode backup mounts (Section 20) only exists in the Compose project when `RUNLY_SUPABASE_MODE=selfhosted`; `cli-dev` runs Storage through a separate Supabase-CLI-managed stack outside this project entirely. Since `cli-dev` is already documented as dev-only/"no usar en produccion", this is not a supported combination — the operator must migrate to `selfhosted` first (`infra/installer/README.md`, "Migrar de `cli-dev` a `selfhosted`").

## 24. Risks

1. Risk: `RESTIC_PASSWORD` loss makes all existing remote backups permanently unreadable. Mitigation: one-time loud warning at generation time (see Edge case 5); documented prominently in the runbook and `infra/installer/README.md`.
2. Risk: Silent backup failures go unnoticed until a restore is actually needed. Mitigation: `verify-backup.sh` command (Section 26) that checks snapshot recency and repo integrity, meant to be wired into whatever external monitoring/alerting the operator already uses.
3. Risk: Storage backup silently produces an incomplete copy if Storage is being written to heavily during the sync window. Mitigation: v1 accepts this (daily snapshot, not point-in-time-consistent across DB+Storage); documented as a known limitation, not solved in this version (see Future enhancements for app-level quiesce).
4. Risk: Adding `restic` + `postgresql-client` to a new container image increases the installer's total pulled image size/attack surface. Mitigation: dedicated minimal image (`apps/backup` + `infra/docker/backup.Dockerfile`, Alpine-based), only pulled/run when `BACKUP_MODE=enabled`.
5. Risk: A misconfigured `BACKUP_S3_*` pointing at a bucket the operator doesn't fully control could leak encrypted-but-still-sensitive backup data. Mitigation: restic encrypts all data client-side before upload regardless of bucket ACLs; documented requirement that the bucket should still be operator-private as defense in depth.

## 25. Acceptance criteria

1. Given a fresh `local`/`selfhosted` install with `BACKUP_MODE=disabled` (default), when `setup-local.mjs` runs, then no backup container is created and no new required env vars block the install.
2. Given `BACKUP_MODE=enabled` with all `BACKUP_S3_*` vars set, when `setup-local.mjs` runs for the first time, then `RESTIC_PASSWORD` is generated once and the `backup-local` compose profile (with the `supabase-storage-data` volume mounted read-only) is added to `docker compose up`.
3. Given `BACKUP_MODE=enabled` but `BACKUP_S3_BUCKET` unset, when `setup-local.mjs` or `setup-external.mjs` runs, then the script exits with a clear error before starting any containers.
4. Given the `runly-backup-local` container running on schedule, when the nightly job executes successfully, then a new restic snapshot exists in the configured bucket containing the Postgres dump, the Storage files, and the config files, and snapshots older than `BACKUP_RETENTION_DAYS` are pruned.
5. Given `BACKUP_MODE=enabled` in `external` mode without `BACKUP_STORAGE_S3_*` configured, when the nightly job runs, then the Postgres dump and config are still backed up successfully, and the log clearly states Storage backup was skipped.
6. Given an existing backup repository, when an operator runs `verify-backup.sh`, then it reports the age of the latest snapshot and the result of `restic check`, exiting non-zero if the snapshot is older than half the retention window or if integrity check fails.
7. Given a completed restore following the documented runbook against a fresh Postgres instance, when the operator queries the restored database, then all `Company`/`Membership`/module data present at backup time is intact.

## 26. Verification plan

- `node --test infra/installer/lib/backup-config.test.mjs` (new) — unit tests for env var generation/validation/derivation logic in `lib/backup-config.mjs`, following the same `.test.mjs`-next-to-source convention as `lib/supabase-selfhosted-config.test.mjs`.
- `node --check infra/installer/lib/backup-config.mjs` — syntax check.
- Manual, against a real disposable S3-compatible bucket (documented with evidence in `docs/superpowers/plans/2026-09-26-backup-recovery-system.md`, same convention as `scripts/poc-transcription/RESULTS.md` and `scripts/poc-piper/RESULTS.md`):
  - Run `node setup-local.mjs` with `BACKUP_MODE=enabled` pointed at the test bucket; confirm the container starts and a manual `docker compose run --rm runly-backup-local ./run-backup.sh` produces a snapshot containing DB dump, Storage files, and config.
  - Run `verify-backup.sh` and confirm it reports the snapshot as healthy.
  - Follow the full restore runbook (Section 27 / the eventual `docs/deployment/backup-recovery.md`) against a disposable Postgres instance and confirm data integrity.
  - Confirm `BACKUP_MODE=disabled` (default) leaves an existing install's `docker compose ps` output unchanged.

## 27. Rollback plan

No database migration is involved, so there is no schema rollback. To disable the feature on an existing installation: set `BACKUP_MODE=disabled` in `.env.local`/`.env.external` and re-run `setup-local.mjs`/`setup-external.mjs` (same pattern as disabling `TRANSCRIPTION_MODE`/`MIRAI_TTS_MODE`) — this stops and removes the `runly-backup-*` container. Existing remote backups in the S3 bucket are **not** deleted by disabling the feature (they remain available for a future restore or re-enable). If the feature needs to be fully removed from the codebase, delete `apps/backup/`, `infra/docker/backup.Dockerfile`, `infra/installer/lib/backup-config.mjs` (+ test), the `runly-backup-*` service blocks in `infra/installer/docker-compose.yml`, and the `BACKUP_*`/`RESTIC_PASSWORD` entries from the `.env.*.example` files.

## 28. Future enhancements

1. Point-in-time recovery via continuous Postgres WAL archiving, instead of daily-snapshot-only.
2. Application-level quiesce/consistency point across DB + Storage during the backup window (e.g., a brief write-pause signal) so a snapshot is guaranteed point-in-time-consistent across both.
3. A `runly:backup:status` npm script surfaced in `infra/installer/README.md` that wraps `verify-backup.sh` for easier operator use without remembering the raw `docker compose run` invocation.
4. Optional second remote destination (cross-provider redundancy) for operators with stricter durability requirements.
5. Automated restore-drill scheduling (e.g., monthly automated restore into a throwaway container to prove restorability, alerting on failure) — deliberately deferred because Non-goal #1 keeps actual production restore manual-only; a drill into a disposable sandbox is a different, lower-risk operation that could be automated later.
