# Backup and Recovery System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in (`BACKUP_MODE=enabled`), restic-based backup sidecar to `infra/installer` that nightly backs up Postgres, Supabase Storage, and instance config to an S3-compatible remote, with retention pruning, a manual verify command, and a documented manual restore runbook — for both `local`/`selfhosted` and `external` installer modes.

**Architecture:** A new Docker image (`apps/backup` + `infra/docker/backup.Dockerfile`, based on `postgres:17-alpine` so `pg_dump`/`pg_restore` match the Supabase Postgres major version) runs `supercronic` to execute `run-backup.sh` on a schedule. That script dumps Postgres via `DATABASE_URL` (identical in both modes), copies Supabase Storage files (direct read-only volume mount in `local` mode; `rclone` against Supabase Storage's S3-protocol endpoint in `external` mode), copies bind-mounted config files, and pushes everything as one `restic` snapshot to `$BACKUP_S3_BUCKET`, pruning snapshots older than `BACKUP_RETENTION_DAYS`. `infra/installer/lib/backup-config.mjs` resolves/validates/generates the `BACKUP_*`/`RESTIC_PASSWORD` env vars, following the exact pattern of `lib/livekit-config.mjs`; `setup-local.mjs`/`setup-external.mjs` wire it in the same way they already wire `TRANSCRIPTION_MODE`/`MIRAI_TTS_MODE`.

**Tech Stack:** Node.js (installer scripts, `node --test`), Bash (container entrypoint/scripts), Docker/Docker Compose, `restic`, `rclone`, `supercronic`, `postgres:17-alpine`.

**Spec:** `docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md`

---

## File Structure Map

| File | Action | Purpose |
|---|---|---|
| `infra/installer/lib/backup-config.mjs` | Create | Pure config resolution/validation/generation for `BACKUP_*`/`RESTIC_PASSWORD` |
| `infra/installer/lib/backup-config.test.mjs` | Create | Unit tests for the above |
| `apps/backup/entrypoint.sh` | Create | Container PID 1: renders the crontab from `BACKUP_SCHEDULE_CRON`, execs `supercronic` |
| `apps/backup/run-backup.sh` | Create | The actual nightly job: dump, copy storage, copy config, restic backup + prune |
| `apps/backup/verify-backup.sh` | Create | Manual/monitoring command: snapshot recency + `restic check` |
| `infra/docker/backup.Dockerfile` | Create | Builds the `runly-backup` image |
| `infra/docker/build-push.mjs` | Modify | Register the `backup` image in `ALL_IMAGES` |
| `package.json` (root) | Modify | Add `docker:release:backup` script |
| `infra/installer/docker-compose.yml` | Modify | Add `runly-backup-local`/`runly-backup-external` services |
| `infra/installer/.env.local.example` | Modify | Add `BACKUP_*`/`RESTIC_PASSWORD` block |
| `infra/installer/.env.external.example` | Modify | Same block |
| `infra/installer/setup-local.mjs` | Modify | Resolve backup config, render env, add profile, pull image, force-recreate |
| `infra/installer/setup-external.mjs` | Modify | Same, via the `OPTIONAL_VAR_GROUPS`/`configureBackup` pattern |
| `docs/deployment/backup-recovery.md` | Create | Manual restore runbook + `verify-backup.sh` usage |
| `infra/installer/README.md` | Modify | New "Backup y Recovery" section, same style as Transcription/TTS |

---

### Task 1: `lib/backup-config.mjs` (config resolution, TDD)

**Files:**
- Create: `infra/installer/lib/backup-config.mjs`
- Create: `infra/installer/lib/backup-config.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `infra/installer/lib/backup-config.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBackupConfig, getBackupComposeProfiles, generateResticPassword } from './backup-config.mjs';

test('generateResticPassword returns a long random base64url string', () => {
  const a = generateResticPassword();
  const b = generateResticPassword();
  assert.ok(a.length >= 32);
  assert.notEqual(a, b);
});

test('resolveBackupConfig defaults to disabled and requires no other vars', () => {
  const config = resolveBackupConfig({ deployment: 'local', supabaseMode: 'cli-dev', values: {} });
  assert.equal(config.mode, 'disabled');
  assert.equal(config.storageMountEnabled, false);
  assert.equal(config.resticPasswordGenerated, false);
});

test('resolveBackupConfig rejects an invalid BACKUP_MODE', () => {
  assert.throws(
    () => resolveBackupConfig({ deployment: 'local', supabaseMode: 'selfhosted', values: { mode: 'weird' } }),
    /BACKUP_MODE must be "disabled" or "enabled"/,
  );
});

test('resolveBackupConfig rejects enabling backup in local cli-dev mode', () => {
  assert.throws(
    () => resolveBackupConfig({
      deployment: 'local',
      supabaseMode: 'cli-dev',
      values: {
        mode: 'enabled',
        s3Endpoint: 'https://s3.example.com',
        s3Bucket: 'bucket',
        s3AccessKeyId: 'id',
        s3SecretAccessKey: 'secret',
      },
    }),
    /RUNLY_SUPABASE_MODE=selfhosted/,
  );
});

test('resolveBackupConfig requires all BACKUP_S3_* vars when enabled', () => {
  assert.throws(
    () => resolveBackupConfig({
      deployment: 'external',
      values: { mode: 'enabled', s3Endpoint: 'https://s3.example.com' },
    }),
    /requires BACKUP_S3_ENDPOINT/,
  );
});

test('resolveBackupConfig rejects a non-positive BACKUP_RETENTION_DAYS', () => {
  assert.throws(
    () => resolveBackupConfig({
      deployment: 'external',
      values: {
        mode: 'enabled',
        retentionDays: '0',
        s3Endpoint: 'https://s3.example.com',
        s3Bucket: 'bucket',
        s3AccessKeyId: 'id',
        s3SecretAccessKey: 'secret',
      },
    }),
    /BACKUP_RETENTION_DAYS must be a positive integer/,
  );
});

test('resolveBackupConfig generates RESTIC_PASSWORD once and preserves it on re-runs', () => {
  const first = resolveBackupConfig({
    deployment: 'external',
    values: {
      mode: 'enabled',
      s3Endpoint: 'https://s3.example.com',
      s3Bucket: 'bucket',
      s3AccessKeyId: 'id',
      s3SecretAccessKey: 'secret',
    },
  });
  assert.ok(first.resticPassword.length >= 32);
  assert.equal(first.resticPasswordGenerated, true);

  const again = resolveBackupConfig({
    deployment: 'external',
    values: {
      mode: 'enabled',
      s3Endpoint: 'https://s3.example.com',
      s3Bucket: 'bucket',
      s3AccessKeyId: 'id',
      s3SecretAccessKey: 'secret',
      resticPassword: first.resticPassword,
    },
  });
  assert.equal(again.resticPassword, first.resticPassword);
  assert.equal(again.resticPasswordGenerated, false);
});

test('resolveBackupConfig applies defaults for schedule/retention/region when enabled', () => {
  const config = resolveBackupConfig({
    deployment: 'local',
    supabaseMode: 'selfhosted',
    values: {
      mode: 'enabled',
      s3Endpoint: 'https://s3.example.com',
      s3Bucket: 'bucket',
      s3AccessKeyId: 'id',
      s3SecretAccessKey: 'secret',
    },
  });
  assert.equal(config.scheduleCron, '0 3 * * *');
  assert.equal(config.retentionDays, 14);
  assert.equal(config.s3Region, 'us-east-1');
  assert.equal(config.storageMountEnabled, true);
});

test('getBackupComposeProfiles returns the deployment-specific profile only when enabled', () => {
  const disabled = resolveBackupConfig({ deployment: 'local', supabaseMode: 'selfhosted', values: {} });
  assert.deepEqual(getBackupComposeProfiles(disabled, 'local'), []);

  const enabled = resolveBackupConfig({
    deployment: 'local',
    supabaseMode: 'selfhosted',
    values: {
      mode: 'enabled',
      s3Endpoint: 'https://s3.example.com',
      s3Bucket: 'bucket',
      s3AccessKeyId: 'id',
      s3SecretAccessKey: 'secret',
    },
  });
  assert.deepEqual(getBackupComposeProfiles(enabled, 'local'), ['backup-local']);
  assert.deepEqual(getBackupComposeProfiles(enabled, 'external'), ['backup-external']);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test infra/installer/lib/backup-config.test.mjs`
Expected: FAIL — `backup-config.mjs` does not exist yet (`Cannot find module`).

- [ ] **Step 3: Write the implementation**

Create `infra/installer/lib/backup-config.mjs`:

```js
import crypto from "node:crypto";

// Encryption password for the restic repository. Generated once, the same
// way lib/transcriber-db.mjs generates TRANSCRIBER_DB_PASSWORD, and NEVER
// regenerated on re-runs — losing it makes every existing remote backup
// permanently unreadable (see docs/superpowers/specs/2026-09-26-backup-
// recovery-system-design.md, Edge case 5).
export function generateResticPassword(randomBytes = crypto.randomBytes) {
  return randomBytes(32).toString("base64url");
}

function clean(value) {
  return String(value ?? "").trim();
}

// Resolves and validates the BACKUP_* / RESTIC_PASSWORD env surface for both
// setup-local.mjs and setup-external.mjs. Pure function, mirrors the shape
// of resolveLiveKitConfig in lib/livekit-config.mjs: takes already-parsed
// values, returns a plain config object, or throws a descriptive Error.
//
// `local` deployment additionally requires supabaseMode === "selfhosted"
// when enabling backup: local-mode Storage backup mounts the
// supabase-storage-data Docker volume (see docker-compose.yml), which only
// exists in this Compose project under selfhosted mode — cli-dev runs
// Storage through a separate Supabase-CLI-managed stack entirely outside
// this project. See the design spec, Edge case 9.
export function resolveBackupConfig({
  deployment,
  supabaseMode,
  values = {},
  randomBytes = crypto.randomBytes,
}) {
  if (!["local", "external"].includes(deployment)) {
    throw new Error("deployment must be local or external.");
  }

  const mode = clean(values.mode || "disabled").toLowerCase();
  if (!["disabled", "enabled"].includes(mode)) {
    throw new Error(`BACKUP_MODE must be "disabled" or "enabled" (got "${mode}").`);
  }

  const scheduleCron = clean(values.scheduleCron) || "0 3 * * *";
  const retentionDaysRaw = clean(values.retentionDays) || "14";
  const retentionDays = Number(retentionDaysRaw);
  const s3Endpoint = clean(values.s3Endpoint);
  const s3Bucket = clean(values.s3Bucket);
  const s3Region = clean(values.s3Region) || "us-east-1";
  const s3AccessKeyId = clean(values.s3AccessKeyId);
  const s3SecretAccessKey = clean(values.s3SecretAccessKey);
  let resticPassword = clean(values.resticPassword);
  const storageS3Endpoint = clean(values.storageS3Endpoint);
  const storageS3AccessKeyId = clean(values.storageS3AccessKeyId);
  const storageS3SecretAccessKey = clean(values.storageS3SecretAccessKey);

  if (mode === "disabled") {
    return {
      mode,
      scheduleCron,
      retentionDays: Number.isInteger(retentionDays) && retentionDays > 0 ? retentionDays : 14,
      s3Endpoint,
      s3Bucket,
      s3Region,
      s3AccessKeyId,
      s3SecretAccessKey,
      resticPassword,
      storageS3Endpoint,
      storageS3AccessKeyId,
      storageS3SecretAccessKey,
      storageMountEnabled: false,
      resticPasswordGenerated: false,
    };
  }

  if (deployment === "local" && supabaseMode !== "selfhosted") {
    const error = new Error(
      "BACKUP_MODE=enabled requires RUNLY_SUPABASE_MODE=selfhosted in local mode "
      + "(cli-dev does not run Supabase Storage inside this Compose project). "
      + "See infra/installer/README.md, \"Migrar de cli-dev a selfhosted\".",
    );
    error.code = "BACKUP_REQUIRES_SELFHOSTED";
    throw error;
  }

  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error(`BACKUP_RETENTION_DAYS must be a positive integer (got "${retentionDaysRaw}").`);
  }
  if (!s3Endpoint || !s3Bucket || !s3AccessKeyId || !s3SecretAccessKey) {
    throw new Error(
      "BACKUP_MODE=enabled requires BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, "
      + "BACKUP_S3_ACCESS_KEY_ID, and BACKUP_S3_SECRET_ACCESS_KEY.",
    );
  }

  const resticPasswordGenerated = !resticPassword;
  resticPassword ||= generateResticPassword(randomBytes);

  return {
    mode,
    scheduleCron,
    retentionDays,
    s3Endpoint,
    s3Bucket,
    s3Region,
    s3AccessKeyId,
    s3SecretAccessKey,
    resticPassword,
    storageS3Endpoint,
    storageS3AccessKeyId,
    storageS3SecretAccessKey,
    storageMountEnabled: deployment === "local",
    resticPasswordGenerated,
  };
}

// Mirrors getLiveKitComposeProfiles in lib/livekit-config.mjs: returns the
// Compose profile(s) to pass to `docker compose --profile ...` for this
// deployment, or [] when backup is disabled.
export function getBackupComposeProfiles(config, deployment) {
  if (config.mode !== "enabled") return [];
  return [deployment === "local" ? "backup-local" : "backup-external"];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test infra/installer/lib/backup-config.test.mjs`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add infra/installer/lib/backup-config.mjs infra/installer/lib/backup-config.test.mjs
git commit -m "feat(installer): add backup-config.mjs env resolution + tests"
```

---

### Task 2: `apps/backup` container scripts

**Files:**
- Create: `apps/backup/entrypoint.sh`
- Create: `apps/backup/run-backup.sh`
- Create: `apps/backup/verify-backup.sh`

- [ ] **Step 1: Write `entrypoint.sh`**

Create `apps/backup/entrypoint.sh`:

```bash
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
```

- [ ] **Step 2: Write `run-backup.sh`**

Create `apps/backup/run-backup.sh`:

```bash
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
trap 'rm -rf "$SCRATCH_DIR"' EXIT

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
restic unlock || true

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
```

- [ ] **Step 3: Write `verify-backup.sh`**

Create `apps/backup/verify-backup.sh`:

```bash
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
```

- [ ] **Step 4: Make the scripts executable and verify syntax**

Run:
```bash
chmod +x apps/backup/entrypoint.sh apps/backup/run-backup.sh apps/backup/verify-backup.sh
bash -n apps/backup/entrypoint.sh
bash -n apps/backup/run-backup.sh
bash -n apps/backup/verify-backup.sh
```
Expected: all three `bash -n` calls exit 0 (no syntax errors), no output.

- [ ] **Step 5: Commit**

```bash
git add apps/backup/entrypoint.sh apps/backup/run-backup.sh apps/backup/verify-backup.sh
git commit -m "feat(backup): add entrypoint, run-backup, and verify-backup scripts"
```

---

### Task 3: `backup.Dockerfile` + image release wiring

**Files:**
- Create: `infra/docker/backup.Dockerfile`
- Modify: `infra/docker/build-push.mjs`
- Modify: `package.json` (root)

- [ ] **Step 1: Write the Dockerfile**

Create `infra/docker/backup.Dockerfile`:

```dockerfile
# runly-backup — restic-based backup sidecar for Postgres, Supabase Storage,
# and instance config. See docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md.
#
# Based on the official postgres:17-alpine image (not plain alpine) so
# pg_dump/pg_restore match supabase/postgres:17.6.1.136's major version
# exactly, without guessing an Alpine postgresql-client package name.
FROM postgres:17-alpine

RUN apk add --no-cache bash coreutils tzdata curl jq restic rclone

# supercronic (cron built for containers: forwards job stdout/stderr to its
# own stdout, which is what `docker compose logs` shows) has no apk package —
# install the static binary directly. TARGETARCH is set automatically by
# docker buildx for each platform in PLATFORMS (see build-push.mjs).
ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.34
RUN case "${TARGETARCH}" in \
      amd64) SUPERCRONIC_ARCH=amd64 ;; \
      arm64) SUPERCRONIC_ARCH=arm64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl -fsSLo /usr/local/bin/supercronic \
       "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${SUPERCRONIC_ARCH}" \
    && chmod +x /usr/local/bin/supercronic

WORKDIR /app
COPY apps/backup/entrypoint.sh apps/backup/run-backup.sh apps/backup/verify-backup.sh ./
RUN chmod +x /app/*.sh

# Clear the inherited `CMD ["postgres"]` from postgres:17-alpine — this image
# never runs a Postgres server, only pg_dump/pg_restore, so passing "postgres"
# as an unused argument to entrypoint.sh would be confusing in `docker inspect`
# even though entrypoint.sh itself ignores "$@".
CMD []
ENTRYPOINT ["/app/entrypoint.sh"]
```

- [ ] **Step 2: Register the image in `build-push.mjs`**

In `infra/docker/build-push.mjs`, edit the comment block and `ALL_IMAGES` array:

```js
// Old (top comment block):
//   pnpm docker:release:tts    # multi-platform build + push tts only
```
```js
// New:
//   pnpm docker:release:tts    # multi-platform build + push tts only
//   pnpm docker:release:backup # multi-platform build + push backup only
```

```js
// Old (end of ALL_IMAGES array):
  {
    key:        "tts",
    tag:        `${REGISTRY}:tts-latest`,
    dockerfile: "infra/docker/tts.Dockerfile",
    label:      "TTS",
  },
];
```
```js
// New:
  {
    key:        "tts",
    tag:        `${REGISTRY}:tts-latest`,
    dockerfile: "infra/docker/tts.Dockerfile",
    label:      "TTS",
  },
  {
    key:        "backup",
    tag:        `${REGISTRY}:backup-latest`,
    dockerfile: "infra/docker/backup.Dockerfile",
    label:      "Backup",
  },
];
```

- [ ] **Step 3: Add the root `package.json` script**

In `package.json`, find:
```json
    "docker:release:tts": "node infra/docker/build-push.mjs --tts",
```
Add immediately after it:
```json
    "docker:release:backup": "node infra/docker/build-push.mjs --backup",
```

- [ ] **Step 4: Verify**

Run:
```bash
node --check infra/docker/build-push.mjs
node infra/docker/build-push.mjs --build --backup
```
Expected: `node --check` prints nothing (valid syntax); the build command builds `raulbellosom/runlyerp:backup-latest` locally (single-platform) without error. This requires local Docker — if Docker is unavailable in the execution environment, skip the actual build and note it as deferred to the manual verification task (Task 10), but still run `node --check`.

- [ ] **Step 5: Commit**

```bash
git add infra/docker/backup.Dockerfile infra/docker/build-push.mjs package.json
git commit -m "feat(docker): add runly-backup image and docker:release:backup script"
```

---

### Task 4: `docker-compose.yml` services

**Files:**
- Modify: `infra/installer/docker-compose.yml`

- [ ] **Step 1: Add the two service blocks**

In `infra/installer/docker-compose.yml`, immediately after the `runly-tts` service block (after its closing `restart: unless-stopped` line, before `livekit-caddy:`), insert:

```yaml
  # Backup opcional (restic) — ver docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md.
  # Split local/external por la misma razon que runly-transcriber-*: la ruta
  # de acceso a Supabase Storage difiere por completo entre modos (volumen
  # Docker compartido en local, endpoint S3 remoto en external). Todos los
  # valores (incluyendo defaults como BACKUP_SCHEDULE_CRON) ya vienen
  # resueltos en .env.local/.env.external por setup-local.mjs/setup-external.mjs,
  # asi que env_file basta — no hace falta un bloque `environment:` aparte.
  # Sin `build:` por la misma razon que runly-api-*/transcriber-*: se publica
  # via `pnpm docker:release:backup` y bootstrap-local.sh no descarga el
  # monorepo completo.
  runly-backup-local:
    image: ${RUNLY_BACKUP_IMAGE:-raulbellosom/runlyerp:backup-latest}
    container_name: ${RUNLY_CONTAINER_PREFIX:-runly}-backup-local
    profiles: ["backup-local"]
    env_file:
      - ./.env.local
    volumes:
      # Solo lectura: el backup nunca debe poder modificar Storage.
      - supabase-storage-data:/storage-source:ro
      - ./.env.local:/config-source/.env.local:ro
      - ./supabase/volumes/db:/config-source/supabase-db-init:ro
    restart: unless-stopped

  runly-backup-external:
    image: ${RUNLY_BACKUP_IMAGE:-raulbellosom/runlyerp:backup-latest}
    container_name: ${RUNLY_CONTAINER_PREFIX:-runly}-backup-external
    profiles: ["backup-external"]
    env_file:
      - ./.env.external
    volumes:
      - ./.env.external:/config-source/.env.external:ro
    restart: unless-stopped

```

- [ ] **Step 2: Verify the compose file is still valid YAML**

Run: `docker compose -f infra/installer/docker-compose.yml config --quiet`
Expected: exits 0 with no output (Compose will warn about unset `${RUNLY_BACKUP_IMAGE}`-style vars being fine since they have defaults — any hard failure means a YAML/indentation mistake to fix).

Note: this validation will fail to resolve `supabase-storage-data` as a known volume unless run together with `-f infra/installer/supabase/docker-compose.supabase.yml` (that's where it's declared) — run the fuller check instead:
```bash
docker compose -f infra/installer/docker-compose.yml -f infra/installer/supabase/docker-compose.supabase.yml config --quiet
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add infra/installer/docker-compose.yml
git commit -m "feat(installer): add runly-backup-local/external compose services"
```

---

### Task 5: `.env.local.example` / `.env.external.example`

**Files:**
- Modify: `infra/installer/.env.local.example`
- Modify: `infra/installer/.env.external.example`

- [ ] **Step 1: Append the block to `.env.local.example`**

In `infra/installer/.env.local.example`, find the end of the MirAI TTS block:
```
# TTS_CPU_LIMIT=1
# TTS_MEMORY_LIMIT=1024m
```
Replace with (adds a new block right after):
```
# TTS_CPU_LIMIT=1
# TTS_MEMORY_LIMIT=1024m

# ── Backup and Recovery (restic, optional) ───────────────────────────────────
# enabled: instala runly-backup-local — respalda Postgres + Supabase Storage +
# config cada noche, cifrado, a un bucket S3-compatible (Backblaze B2, AWS S3,
# MinIO, etc). Requiere RUNLY_SUPABASE_MODE=selfhosted.
# disabled (default): no se instala ningun contenedor de backup.
BACKUP_MODE=disabled
BACKUP_SCHEDULE_CRON=0 3 * * *
BACKUP_RETENTION_DAYS=14
BACKUP_S3_ENDPOINT=
BACKUP_S3_BUCKET=
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=
# Autogenerada la primera vez que BACKUP_MODE=enabled — nunca se regenera.
# Guardala fuera de esta VPS: perderla vuelve irrecuperables los backups ya subidos.
RESTIC_PASSWORD=
# Solo la usa external mode — local mode monta el volumen de Storage directamente.
BACKUP_STORAGE_S3_ENDPOINT=
BACKUP_STORAGE_S3_ACCESS_KEY_ID=
BACKUP_STORAGE_S3_SECRET_ACCESS_KEY=
```

- [ ] **Step 2: Append the corrected block to `.env.external.example`**

In `infra/installer/.env.external.example`, find:
```
# TTS_CPU_LIMIT=1
# TTS_MEMORY_LIMIT=1024m
```
Replace with (note: the header comment differs from Step 1's — this mode installs `runly-backup-external`, not `runly-backup-local`, and has no `RUNLY_SUPABASE_MODE` concept at all since external mode doesn't run Supabase itself):
```
# TTS_CPU_LIMIT=1
# TTS_MEMORY_LIMIT=1024m

# ── Backup and Recovery (restic, optional) ───────────────────────────────────
# enabled: instala runly-backup-external — respalda Postgres + config cada
# noche, cifrado, a un bucket S3-compatible (Backblaze B2, AWS S3, MinIO,
# etc). Storage solo se respalda si configuras BACKUP_STORAGE_S3_* abajo.
# disabled (default): no se instala ningun contenedor de backup.
BACKUP_MODE=disabled
BACKUP_SCHEDULE_CRON=0 3 * * *
BACKUP_RETENTION_DAYS=14
BACKUP_S3_ENDPOINT=
BACKUP_S3_BUCKET=
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=
# Autogenerada la primera vez que BACKUP_MODE=enabled — nunca se regenera.
# Guardala fuera de esta VPS: perderla vuelve irrecuperables los backups ya subidos.
RESTIC_PASSWORD=
# Solo la usa external mode — local mode monta el volumen de Storage directamente.
BACKUP_STORAGE_S3_ENDPOINT=
BACKUP_STORAGE_S3_ACCESS_KEY_ID=
BACKUP_STORAGE_S3_SECRET_ACCESS_KEY=
```

- [ ] **Step 3: Verify**

Run: `grep -c "BACKUP_MODE" infra/installer/.env.local.example infra/installer/.env.external.example`
Expected: `1` for each file.

- [ ] **Step 4: Commit**

```bash
git add infra/installer/.env.local.example infra/installer/.env.external.example
git commit -m "docs(installer): add BACKUP_*/RESTIC_PASSWORD vars to env examples"
```

---

### Task 6: Wire `setup-local.mjs`

**Files:**
- Modify: `infra/installer/setup-local.mjs`

- [ ] **Step 1: Import the new module and declare the image constant**

Find:
```js
import { buildTranscriberDatabaseUrl, generateTranscriberPassword } from "./lib/transcriber-db.mjs";
```
Add immediately after:
```js
import { resolveBackupConfig, getBackupComposeProfiles } from "./lib/backup-config.mjs";
```

Find:
```js
const ttsImage =
  (process.env.RUNLY_TTS_IMAGE ?? "raulbellosom/runlyerp:tts-latest");
```
Add immediately after:
```js
const backupImage =
  (process.env.RUNLY_BACKUP_IMAGE ?? "raulbellosom/runlyerp:backup-latest");
```

- [ ] **Step 2: Resolve backup config inside `writeLocalEnv`**

Find (the `miraiTtsUrl` line, right before the `officeValues` line):
```js
  const miraiTtsUrl = miraiTtsMode === "local" ? "http://runly-tts:8090" : "";

  const officeValues = withRunlyEnvAliases(parseOfficeEnv(existingEnvContent), process.env);
```
Replace with:
```js
  const miraiTtsUrl = miraiTtsMode === "local" ? "http://runly-tts:8090" : "";

  // Backup and Recovery (docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md).
  const backup = resolveBackupConfig({
    deployment: "local",
    supabaseMode: supabase.mode,
    values: {
      mode: fromLocalEnv("BACKUP_MODE"),
      scheduleCron: fromLocalEnv("BACKUP_SCHEDULE_CRON"),
      retentionDays: fromLocalEnv("BACKUP_RETENTION_DAYS"),
      s3Endpoint: fromLocalEnv("BACKUP_S3_ENDPOINT"),
      s3Bucket: fromLocalEnv("BACKUP_S3_BUCKET"),
      s3Region: fromLocalEnv("BACKUP_S3_REGION"),
      s3AccessKeyId: fromLocalEnv("BACKUP_S3_ACCESS_KEY_ID"),
      s3SecretAccessKey: fromLocalEnv("BACKUP_S3_SECRET_ACCESS_KEY"),
      resticPassword: fromLocalEnv("RESTIC_PASSWORD"),
      storageS3Endpoint: fromLocalEnv("BACKUP_STORAGE_S3_ENDPOINT"),
      storageS3AccessKeyId: fromLocalEnv("BACKUP_STORAGE_S3_ACCESS_KEY_ID"),
      storageS3SecretAccessKey: fromLocalEnv("BACKUP_STORAGE_S3_SECRET_ACCESS_KEY"),
    },
  });

  const officeValues = withRunlyEnvAliases(parseOfficeEnv(existingEnvContent), process.env);
```

- [ ] **Step 3: Render the new env block**

Find:
```js
MIRAI_TTS_MODE=${miraiTtsMode}
TTS_CPU_THREADS=${ttsCpuThreads}
TTS_CPU_LIMIT=${ttsCpuLimit}
TTS_MEMORY_LIMIT=${ttsMemoryLimit}
MIRAI_TTS_URL=${miraiTtsUrl}
`;
```
Replace with:
```js
MIRAI_TTS_MODE=${miraiTtsMode}
TTS_CPU_THREADS=${ttsCpuThreads}
TTS_CPU_LIMIT=${ttsCpuLimit}
TTS_MEMORY_LIMIT=${ttsMemoryLimit}
MIRAI_TTS_URL=${miraiTtsUrl}

# ── Backup and Recovery (restic, optional) ───────────────────────────────────
# enabled: instala runly-backup-local — respalda Postgres + Supabase Storage +
# config cada noche, cifrado, a un bucket S3-compatible. Requiere
# RUNLY_SUPABASE_MODE=selfhosted.
# disabled (default): no se instala ningun contenedor de backup.
BACKUP_MODE=${backup.mode}
BACKUP_SCHEDULE_CRON=${backup.scheduleCron}
BACKUP_RETENTION_DAYS=${backup.retentionDays}
BACKUP_S3_ENDPOINT=${backup.s3Endpoint}
BACKUP_S3_BUCKET=${backup.s3Bucket}
BACKUP_S3_REGION=${backup.s3Region}
BACKUP_S3_ACCESS_KEY_ID=${backup.s3AccessKeyId}
BACKUP_S3_SECRET_ACCESS_KEY=${backup.s3SecretAccessKey}
# Autogenerada la primera vez que BACKUP_MODE=enabled — nunca se regenera.
RESTIC_PASSWORD=${backup.resticPassword}
# Solo la usa external mode — local mode monta el volumen de Storage directamente.
BACKUP_STORAGE_S3_ENDPOINT=${backup.storageS3Endpoint}
BACKUP_STORAGE_S3_ACCESS_KEY_ID=${backup.storageS3AccessKeyId}
BACKUP_STORAGE_S3_SECRET_ACCESS_KEY=${backup.storageS3SecretAccessKey}
`;
```

- [ ] **Step 4: Warn once when `RESTIC_PASSWORD` is freshly generated, and return `backup`**

Find:
```js
  const office = await configureOffice({ envFile: localEnvFile, composeEnvFile });
  await configureFirebase({ envFile: localEnvFile });
  return { liveKit, office, supabase, transcriptionMode, miraiTtsMode };
```
Replace with:
```js
  const office = await configureOffice({ envFile: localEnvFile, composeEnvFile });
  await configureFirebase({ envFile: localEnvFile });

  if (backup.resticPasswordGenerated) {
    console.warn("");
    console.warn("[setup-local] RESTIC_PASSWORD generated for encrypted backups (BACKUP_MODE=enabled).");
    console.warn(`  Save the RESTIC_PASSWORD value from ${localEnvFile} somewhere OUTSIDE this VPS`);
    console.warn("  right now (a password manager, not another file on this same disk).");
    console.warn("  Losing it makes every existing remote backup permanently unreadable —");
    console.warn("  restic cannot recover encrypted snapshots without it.");
    console.warn("");
  }

  return { liveKit, office, supabase, transcriptionMode, miraiTtsMode, backup };
```

- [ ] **Step 5: Add `removeInactiveBackupServices`**

Find:
```js
function removeInactiveMiraiTtsServices(miraiTtsMode) {
  if (miraiTtsMode === "local") return;
  tryRun("docker", [
    "compose", ...composeFiles,
    "--profile", "mirai-tts",
    "rm", "--stop", "--force", "runly-tts",
  ]);
}
```
Add immediately after:
```js
// Same pattern as removeInactiveTranscriptionServices: stop and remove the
// container if BACKUP_MODE goes from "enabled" back to "disabled".
function removeInactiveBackupServices(backupMode) {
  if (backupMode === "enabled") return;
  tryRun("docker", [
    "compose", ...composeFiles,
    "--profile", "backup-local",
    "rm", "--stop", "--force", "runly-backup-local",
  ]);
}
```

- [ ] **Step 6: Pull the image, add the profile, force-recreate, and destructure `backup` in `main()`**

Find:
```js
  const { liveKit, office, supabase, transcriptionMode, miraiTtsMode } = await writeLocalEnv(supabaseInput, identity);
```
Replace with:
```js
  const { liveKit, office, supabase, transcriptionMode, miraiTtsMode, backup } = await writeLocalEnv(supabaseInput, identity);
```

Find:
```js
    if (transcriptionMode === "local") pullWithRetry(transcriberImage, "Transcriber");
    if (miraiTtsMode === "local") pullWithRetry(ttsImage, "TTS");
    if (supabaseMode === "selfhosted") {
```
Replace with:
```js
    if (transcriptionMode === "local") pullWithRetry(transcriberImage, "Transcriber");
    if (miraiTtsMode === "local") pullWithRetry(ttsImage, "TTS");
    if (backup.mode === "enabled") pullWithRetry(backupImage, "Backup");
    if (supabaseMode === "selfhosted") {
```

Find:
```js
  removeInactiveLiveKitServices(liveKit);
  removeInactiveTranscriptionServices(transcriptionMode);
  removeInactiveMiraiTtsServices(miraiTtsMode);
  const liveKitProfiles = getLiveKitComposeProfiles(liveKit, { recordingEnabled: liveKit.recordingEnabled })
    .flatMap((profile) => ["--profile", profile]);
  const transcriptionProfiles = transcriptionMode === "local" ? ["--profile", "transcription-local"] : [];
  const miraiTtsProfiles = miraiTtsMode === "local" ? ["--profile", "mirai-tts"] : [];
  // Limit forced restarts to Runly/Calls: an unchanged editor must keep its sessions.
  const services = ["runly-api-local", "runly-worker-local", "runly-web-local",
    ...(liveKit.mode === "embedded" ? ["livekit-redis", "livekit",
      ...(liveKit.managedTls ? ["livekit-caddy"] : []),
      ...(liveKit.recordingEnabled ? ["egress"] : [])] : []),
    ...(transcriptionMode === "local" ? ["runly-transcriber-local"] : []),
    ...(miraiTtsMode === "local" ? ["runly-tts"] : [])];
  run(
    "docker",
    ["compose", ...composeFiles, "--profile", "local", ...liveKitProfiles, ...transcriptionProfiles, ...miraiTtsProfiles, ...office.profiles, "up", "-d", "--force-recreate", ...services],
```
Replace with:
```js
  removeInactiveLiveKitServices(liveKit);
  removeInactiveTranscriptionServices(transcriptionMode);
  removeInactiveMiraiTtsServices(miraiTtsMode);
  removeInactiveBackupServices(backup.mode);
  const liveKitProfiles = getLiveKitComposeProfiles(liveKit, { recordingEnabled: liveKit.recordingEnabled })
    .flatMap((profile) => ["--profile", profile]);
  const transcriptionProfiles = transcriptionMode === "local" ? ["--profile", "transcription-local"] : [];
  const miraiTtsProfiles = miraiTtsMode === "local" ? ["--profile", "mirai-tts"] : [];
  const backupProfiles = getBackupComposeProfiles(backup, "local").flatMap((profile) => ["--profile", profile]);
  // Limit forced restarts to Runly/Calls: an unchanged editor must keep its sessions.
  const services = ["runly-api-local", "runly-worker-local", "runly-web-local",
    ...(liveKit.mode === "embedded" ? ["livekit-redis", "livekit",
      ...(liveKit.managedTls ? ["livekit-caddy"] : []),
      ...(liveKit.recordingEnabled ? ["egress"] : [])] : []),
    ...(transcriptionMode === "local" ? ["runly-transcriber-local"] : []),
    ...(miraiTtsMode === "local" ? ["runly-tts"] : []),
    ...(backup.mode === "enabled" ? ["runly-backup-local"] : [])];
  run(
    "docker",
    ["compose", ...composeFiles, "--profile", "local", ...liveKitProfiles, ...transcriptionProfiles, ...miraiTtsProfiles, ...backupProfiles, ...office.profiles, "up", "-d", "--force-recreate", ...services],
```

- [ ] **Step 7: Verify**

Run: `node --check infra/installer/setup-local.mjs`
Expected: no output (valid syntax).

Run: `node --test infra/installer/lib/backup-config.test.mjs` (regression — unaffected by this task, should still pass)
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add infra/installer/setup-local.mjs
git commit -m "feat(installer): wire BACKUP_MODE into setup-local.mjs"
```

---

### Task 7: Wire `setup-external.mjs`

**Files:**
- Modify: `infra/installer/setup-external.mjs`

- [ ] **Step 1: Import the new module and declare the image constant**

Find:
```js
import { buildTranscriberDatabaseUrl, generateTranscriberPassword } from "./lib/transcriber-db.mjs";
```
Add immediately after:
```js
import { resolveBackupConfig, getBackupComposeProfiles } from "./lib/backup-config.mjs";
```

Find:
```js
const transcriberImage = process.env.RUNLY_TRANSCRIBER_IMAGE ?? "raulbellosom/runlyerp:transcriber-latest";
const ttsImage = process.env.RUNLY_TTS_IMAGE ?? "raulbellosom/runlyerp:tts-latest";
```
Replace with:
```js
const transcriberImage = process.env.RUNLY_TRANSCRIBER_IMAGE ?? "raulbellosom/runlyerp:transcriber-latest";
const ttsImage = process.env.RUNLY_TTS_IMAGE ?? "raulbellosom/runlyerp:tts-latest";
const backupImage = process.env.RUNLY_BACKUP_IMAGE ?? "raulbellosom/runlyerp:backup-latest";
```

- [ ] **Step 2: Add the `OPTIONAL_VAR_GROUPS` entry**

Find:
```js
  {
    header: [
      "# ── MirAI text-to-speech (Piper, optional) ───────────────────────────────────",
      "# local: instala y ejecuta runly-tts en un contenedor propio en esta VPS.",
      "# disabled: no se instala ni activa ningun contenedor ni boton en la UI.",
    ],
    vars: [
      { key: "MIRAI_TTS_MODE",   placeholder: "disabled", comment: null },
      { key: "TTS_CPU_THREADS",  placeholder: "2",        comment: null },
      { key: "TTS_CPU_LIMIT",    placeholder: "1",        comment: null },
      { key: "TTS_MEMORY_LIMIT", placeholder: "1024m",    comment: "# Sube esto si /chat/mirai/tts da 502 en textos largos (el contenedor se queda sin RAM)" },
      { key: "MIRAI_TTS_URL",    placeholder: "", comment: "# Derivada automaticamente — no editar a mano" },
    ],
  },
```
Add immediately after:
```js
  {
    header: [
      "# ── Backup and Recovery (restic, optional) ───────────────────────────────────",
      "# enabled: instala runly-backup-external — respalda Postgres + Storage + config",
      "# cada noche, cifrado, a un bucket S3-compatible.",
      "# disabled (default): no se instala ningun contenedor de backup.",
    ],
    vars: [
      { key: "BACKUP_MODE",             placeholder: "disabled", comment: null },
      { key: "BACKUP_SCHEDULE_CRON",    placeholder: "0 3 * * *", comment: null },
      { key: "BACKUP_RETENTION_DAYS",   placeholder: "14",       comment: null },
      { key: "BACKUP_S3_ENDPOINT",      placeholder: "",         comment: null },
      { key: "BACKUP_S3_BUCKET",        placeholder: "",         comment: null },
      { key: "BACKUP_S3_REGION",        placeholder: "us-east-1", comment: null },
      { key: "BACKUP_S3_ACCESS_KEY_ID", placeholder: "",         comment: null },
      { key: "BACKUP_S3_SECRET_ACCESS_KEY", placeholder: "",     comment: null },
      { key: "RESTIC_PASSWORD",         placeholder: "",         comment: "# Autogenerada — no editar a mano. Perderla vuelve irrecuperables los backups." },
      { key: "BACKUP_STORAGE_S3_ENDPOINT",             placeholder: "", comment: "# Opcional: solo si tu Supabase expone el protocolo S3 de Storage" },
      { key: "BACKUP_STORAGE_S3_ACCESS_KEY_ID",        placeholder: "", comment: null },
      { key: "BACKUP_STORAGE_S3_SECRET_ACCESS_KEY",    placeholder: "", comment: null },
    ],
  },
```

- [ ] **Step 3: Add `configureBackup` and `removeInactiveBackupServices`**

Find:
```js
function removeInactiveMiraiTtsServices(mode) {
  if (mode === "local") return;
  tryRun("docker", [
    "compose", ...composeFiles,
    "--profile", "mirai-tts",
    "rm", "--stop", "--force", "runly-tts",
  ]);
}
```
Add immediately after:
```js
// Same pattern as removeInactiveTranscriptionServices/removeInactiveMiraiTtsServices.
function removeInactiveBackupServices(mode) {
  if (mode === "enabled") return;
  tryRun("docker", [
    "compose", ...composeFiles,
    "--profile", "backup-external",
    "rm", "--stop", "--force", "runly-backup-external",
  ]);
}
```

Find:
```js
// Same read-modify-write-in-place pattern as configureTranscription, but
// simpler: runly-tts is stateless, so there is no password to generate and
// no derived URL besides the fixed internal Compose service hostname.
async function configureMiraiTts(filePath) {
  let content = await fs.readFile(filePath, "utf8");
  const mode = String(parseEnvValue(content, "MIRAI_TTS_MODE") || "disabled").trim().toLowerCase();
  if (!["local", "disabled"].includes(mode)) {
    throw new Error(`MIRAI_TTS_MODE must be "local" or "disabled" (got "${mode}").`);
  }
  const cpuThreads = parseEnvValue(content, "TTS_CPU_THREADS") || "2";
  const ttsUrl = mode === "local" ? "http://runly-tts:8090" : "";

  for (const [key, value] of [
    ["MIRAI_TTS_MODE", mode],
    ["TTS_CPU_THREADS", cpuThreads],
    ["MIRAI_TTS_URL", ttsUrl],
  ]) {
    content = setEnvValue(content, key, value);
  }
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(filePath, 0o600); } catch { /* Windows does not apply POSIX modes. */ }

  return { mode };
}
```
Add immediately after:
```js
// Same read-modify-write-in-place pattern as configureTranscription/
// configureMiraiTts. deployment is always "external" here (no cli-dev
// concept exists in this mode, unlike setup-local.mjs).
async function configureBackup(filePath) {
  let content = await fs.readFile(filePath, "utf8");
  const config = resolveBackupConfig({
    deployment: "external",
    values: {
      mode: parseEnvValue(content, "BACKUP_MODE"),
      scheduleCron: parseEnvValue(content, "BACKUP_SCHEDULE_CRON"),
      retentionDays: parseEnvValue(content, "BACKUP_RETENTION_DAYS"),
      s3Endpoint: parseEnvValue(content, "BACKUP_S3_ENDPOINT"),
      s3Bucket: parseEnvValue(content, "BACKUP_S3_BUCKET"),
      s3Region: parseEnvValue(content, "BACKUP_S3_REGION"),
      s3AccessKeyId: parseEnvValue(content, "BACKUP_S3_ACCESS_KEY_ID"),
      s3SecretAccessKey: parseEnvValue(content, "BACKUP_S3_SECRET_ACCESS_KEY"),
      resticPassword: parseEnvValue(content, "RESTIC_PASSWORD"),
      storageS3Endpoint: parseEnvValue(content, "BACKUP_STORAGE_S3_ENDPOINT"),
      storageS3AccessKeyId: parseEnvValue(content, "BACKUP_STORAGE_S3_ACCESS_KEY_ID"),
      storageS3SecretAccessKey: parseEnvValue(content, "BACKUP_STORAGE_S3_SECRET_ACCESS_KEY"),
    },
  });

  for (const [key, value] of [
    ["BACKUP_MODE", config.mode],
    ["BACKUP_SCHEDULE_CRON", config.scheduleCron],
    ["BACKUP_RETENTION_DAYS", String(config.retentionDays)],
    ["BACKUP_S3_ENDPOINT", config.s3Endpoint],
    ["BACKUP_S3_BUCKET", config.s3Bucket],
    ["BACKUP_S3_REGION", config.s3Region],
    ["BACKUP_S3_ACCESS_KEY_ID", config.s3AccessKeyId],
    ["BACKUP_S3_SECRET_ACCESS_KEY", config.s3SecretAccessKey],
    ["RESTIC_PASSWORD", config.resticPassword],
    ["BACKUP_STORAGE_S3_ENDPOINT", config.storageS3Endpoint],
    ["BACKUP_STORAGE_S3_ACCESS_KEY_ID", config.storageS3AccessKeyId],
    ["BACKUP_STORAGE_S3_SECRET_ACCESS_KEY", config.storageS3SecretAccessKey],
  ]) {
    content = setEnvValue(content, key, value);
  }
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(filePath, 0o600); } catch { /* Windows does not apply POSIX modes. */ }

  if (config.resticPasswordGenerated) {
    console.warn("");
    console.warn("[setup-external] RESTIC_PASSWORD generated for encrypted backups (BACKUP_MODE=enabled).");
    console.warn(`  Save the RESTIC_PASSWORD value from ${filePath} somewhere OUTSIDE this VPS`);
    console.warn("  right now (a password manager, not another file on this same disk).");
    console.warn("  Losing it makes every existing remote backup permanently unreadable —");
    console.warn("  restic cannot recover encrypted snapshots without it.");
    console.warn("");
  }

  return config;
}
```

- [ ] **Step 4: Call `configureBackup` and remove inactive services in `main()`**

Find:
```js
  let transcription = { mode: "disabled" };
  let miraiTts = { mode: "disabled" };
  if (!upOnly) {
    transcription = await configureTranscription(envFile);
    miraiTts = await configureMiraiTts(envFile);
  }
```
Replace with:
```js
  let transcription = { mode: "disabled" };
  let miraiTts = { mode: "disabled" };
  let backup = { mode: "disabled" };
  if (!upOnly) {
    transcription = await configureTranscription(envFile);
    miraiTts = await configureMiraiTts(envFile);
    backup = await configureBackup(envFile);
  }
```

Find:
```js
    transcription = await configureTranscription(envFile);
    miraiTts = await configureMiraiTts(envFile);
  }

  // ── 2. Validate Docker ─────────────────────────────────────────────────────
```
Replace with:
```js
    transcription = await configureTranscription(envFile);
    miraiTts = await configureMiraiTts(envFile);
    backup = await configureBackup(envFile);
  }

  // ── 2. Validate Docker ─────────────────────────────────────────────────────
```

Find:
```js
    if (transcription.mode === "local") pullWithRetry(transcriberImage, "Transcriber");
    if (miraiTts.mode === "local") pullWithRetry(ttsImage, "TTS");
    // Remove dangling layers left behind when `latest` tags are re-pulled.
```
Replace with:
```js
    if (transcription.mode === "local") pullWithRetry(transcriberImage, "Transcriber");
    if (miraiTts.mode === "local") pullWithRetry(ttsImage, "TTS");
    if (backup.mode === "enabled") pullWithRetry(backupImage, "Backup");
    // Remove dangling layers left behind when `latest` tags are re-pulled.
```

Find:
```js
  removeInactiveLiveKitServices(liveKit);
  removeInactiveTranscriptionServices(transcription.mode);
  removeInactiveMiraiTtsServices(miraiTts.mode);
  const liveKitProfiles = getLiveKitComposeProfiles(liveKit, { recordingEnabled: liveKit.recordingEnabled })
    .flatMap((profile) => ["--profile", profile]);
  const transcriptionProfiles = transcription.mode === "local" ? ["--profile", "transcription-external"] : [];
  const miraiTtsProfiles = miraiTts.mode === "local" ? ["--profile", "mirai-tts"] : [];
  // Limit forced restarts to Runly/Calls: an unchanged editor must keep its sessions.
  const services = ["runly-api-external", "runly-worker-external", "runly-web-external",
    ...(liveKit.mode === "embedded" ? ["livekit-redis", "livekit",
      ...(liveKit.managedTls ? ["livekit-caddy"] : []),
      ...(liveKit.recordingEnabled ? ["egress"] : [])] : []),
    ...(transcription.mode === "local" ? ["runly-transcriber-external"] : []),
    ...(miraiTts.mode === "local" ? ["runly-tts"] : [])];
  run(
    "docker",
    ["compose", ...composeFiles, "--profile", "external", ...liveKitProfiles, ...transcriptionProfiles, ...miraiTtsProfiles, ...office.profiles, "up", "-d", "--force-recreate", ...services],
```
Replace with:
```js
  removeInactiveLiveKitServices(liveKit);
  removeInactiveTranscriptionServices(transcription.mode);
  removeInactiveMiraiTtsServices(miraiTts.mode);
  removeInactiveBackupServices(backup.mode);
  const liveKitProfiles = getLiveKitComposeProfiles(liveKit, { recordingEnabled: liveKit.recordingEnabled })
    .flatMap((profile) => ["--profile", profile]);
  const transcriptionProfiles = transcription.mode === "local" ? ["--profile", "transcription-external"] : [];
  const miraiTtsProfiles = miraiTts.mode === "local" ? ["--profile", "mirai-tts"] : [];
  const backupProfiles = getBackupComposeProfiles(backup, "external").flatMap((profile) => ["--profile", profile]);
  // Limit forced restarts to Runly/Calls: an unchanged editor must keep its sessions.
  const services = ["runly-api-external", "runly-worker-external", "runly-web-external",
    ...(liveKit.mode === "embedded" ? ["livekit-redis", "livekit",
      ...(liveKit.managedTls ? ["livekit-caddy"] : []),
      ...(liveKit.recordingEnabled ? ["egress"] : [])] : []),
    ...(transcription.mode === "local" ? ["runly-transcriber-external"] : []),
    ...(miraiTts.mode === "local" ? ["runly-tts"] : []),
    ...(backup.mode === "enabled" ? ["runly-backup-external"] : [])];
  run(
    "docker",
    ["compose", ...composeFiles, "--profile", "external", ...liveKitProfiles, ...transcriptionProfiles, ...miraiTtsProfiles, ...backupProfiles, ...office.profiles, "up", "-d", "--force-recreate", ...services],
```

- [ ] **Step 5: Verify**

Run: `node --check infra/installer/setup-external.mjs`
Expected: no output (valid syntax).

- [ ] **Step 6: Commit**

```bash
git add infra/installer/setup-external.mjs
git commit -m "feat(installer): wire BACKUP_MODE into setup-external.mjs"
```

---

### Task 8: Restore runbook

**Files:**
- Create: `docs/deployment/backup-recovery.md`

- [ ] **Step 1: Write the runbook**

Create `docs/deployment/backup-recovery.md`:

```markdown
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
reachable directly (typical for external mode). Use `raulbellosom/runlyerp:backup-latest`
here, not the API image — the API image is `node:22-alpine`-based and has no
`pg_restore`; the backup image is `postgres:17-alpine`-based specifically so it does.

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

```bash
docker compose --profile backup-local run --rm runly-backup-local ./verify-backup.sh
# or, in external mode:
docker compose --profile backup-external run --rm runly-backup-external ./verify-backup.sh
```

Exits non-zero if the latest snapshot is older than half the retention
window, or if `restic check` finds repository corruption.
```

- [ ] **Step 2: Commit**

```bash
git add docs/deployment/backup-recovery.md
git commit -m "docs: add backup and recovery runbook"
```

---

### Task 9: `infra/installer/README.md` section

**Files:**
- Modify: `infra/installer/README.md`

- [ ] **Step 1: Add the section**

In `infra/installer/README.md`, find the end of the "MirAI Text-to-Speech (Piper, opcional)" section — specifically this block:
```
### Desactivar

Poner `MIRAI_TTS_MODE=disabled` en `.env.local`/`.env.external` y volver a
correr el instalador detiene y elimina el contenedor `runly-tts`
automaticamente. No hay ningun rol de base de datos ni credencial que limpiar
por separado — a diferencia de la transcripcion, no se creo ninguno.

---

## Multiples instancias de Runly en el mismo host
```
Replace with:
```
### Desactivar

Poner `MIRAI_TTS_MODE=disabled` en `.env.local`/`.env.external` y volver a
correr el instalador detiene y elimina el contenedor `runly-tts`
automaticamente. No hay ningun rol de base de datos ni credencial que limpiar
por separado — a diferencia de la transcripcion, no se creo ninguno.

---

## Backup y Recovery (restic, opcional)

> Runbook completo de restore en
> [docs/deployment/backup-recovery.md](../../docs/deployment/backup-recovery.md)
> y diseno completo en
> [docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md](../../docs/superpowers/specs/2026-09-26-backup-recovery-system-design.md).

Respaldo diario cifrado de Postgres + Supabase Storage + config de la
instancia a un bucket S3-compatible (Backblaze B2, AWS S3, MinIO, etc), en un
contenedor propio (`runly-backup-local`/`runly-backup-external`) via
`restic`. En modo `local` requiere `RUNLY_SUPABASE_MODE=selfhosted` (el
volumen de Storage que monta no existe en modo `cli-dev`).

```bash
BACKUP_MODE=disabled
BACKUP_SCHEDULE_CRON=0 3 * * *
BACKUP_RETENTION_DAYS=14
BACKUP_S3_ENDPOINT=
BACKUP_S3_BUCKET=
BACKUP_S3_REGION=us-east-1
BACKUP_S3_ACCESS_KEY_ID=
BACKUP_S3_SECRET_ACCESS_KEY=
RESTIC_PASSWORD=
BACKUP_STORAGE_S3_ENDPOINT=
BACKUP_STORAGE_S3_ACCESS_KEY_ID=
BACKUP_STORAGE_S3_SECRET_ACCESS_KEY=
```

| Modo | Comportamiento |
|------|----------------|
| `enabled` | Instala y ejecuta `runly-backup-*`; respalda cada noche y poda snapshots mas viejos que `BACKUP_RETENTION_DAYS`. |
| `disabled` (default) | No se instala ningun contenedor de backup — ninguna instalacion existente se ve afectada al actualizar. |

`RESTIC_PASSWORD` se **autogenera una sola vez** y nunca se regenera —
guardala fuera de esta VPS de inmediato (gestor de contrasenas). Perderla
vuelve irrecuperables todos los backups remotos ya subidos: restic no puede
recuperar snapshots cifrados sin ella.

`BACKUP_STORAGE_S3_*` solo aplica a modo `external`: modo `local` respalda
Storage montando el volumen `supabase-storage-data` directamente, sin
necesitar estas credenciales.

### Activar en una instalacion ya existente

1. Edita `.env.local`/`.env.external` a mano: agrega `BACKUP_MODE=enabled` y
   las credenciales `BACKUP_S3_*` de tu proveedor. El script de actualizacion
   nunca edita el archivo de entorno por si solo — este paso es siempre
   manual.
2. Ejecuta `pnpm runly:update:local` (o `pnpm runly:update:external`). El
   script genera `RESTIC_PASSWORD` la primera vez, descarga la imagen de
   `runly-backup`, y la agrega al `docker compose up` sin reiniciar los
   servicios que no cambiaron.

### Verificar que los backups funcionan

```bash
docker compose --profile backup-local run --rm runly-backup-local ./verify-backup.sh
```

### Desactivar

Poner `BACKUP_MODE=disabled` y volver a correr el instalador detiene y
elimina el contenedor de backup automaticamente. Los backups remotos ya
subidos al bucket **no** se borran al desactivar — quedan disponibles para
un restore o una reactivacion futura.

---

## Multiples instancias de Runly en el mismo host
```

- [ ] **Step 2: Commit**

```bash
git add infra/installer/README.md
git commit -m "docs(installer): document the Backup y Recovery section"
```

---

### Task 10: Manual end-to-end verification (documented evidence)

**Files:** none (evidence-only task; updates this plan file itself with results)

- [ ] **Step 1: Provision a disposable test bucket**

Create a throwaway bucket on any S3-compatible provider (a free Backblaze B2
bucket is sufficient) dedicated to this test — never point this at a bucket
holding real backups.

- [ ] **Step 2: Enable backup on a disposable local install**

In a scratch `infra/installer` copy (or a disposable VM), set in
`.env.local`:
```
RUNLY_SUPABASE_MODE=selfhosted
BACKUP_MODE=enabled
BACKUP_S3_ENDPOINT=<test bucket endpoint>
BACKUP_S3_BUCKET=<test bucket name>
BACKUP_S3_ACCESS_KEY_ID=<test key>
BACKUP_S3_SECRET_ACCESS_KEY=<test secret>
```
Run `node setup-local.mjs` and confirm:
- `RESTIC_PASSWORD` was generated and the one-time warning printed.
- `docker compose ps` shows `runly-backup-local` running.

- [ ] **Step 3: Trigger a manual backup run and inspect it**

```bash
docker compose --profile backup-local run --rm runly-backup-local ./run-backup.sh
docker compose --profile backup-local run --rm runly-backup-local ./verify-backup.sh
```
Confirm the snapshot contains `db.dump`, `storage/`, and `config/` (e.g. via
`restic ls latest` against the test repo), and `verify-backup.sh` reports
success.

- [ ] **Step 4: Run the full restore runbook**

Follow `docs/deployment/backup-recovery.md` end to end against a disposable
Postgres instance; confirm restored data matches what was backed up.

- [ ] **Step 5: Confirm the disabled default is a no-op**

On a separate install with `BACKUP_MODE=disabled` (the default), confirm
`docker compose ps` shows no `runly-backup-*` container and `setup-local.mjs`
completes without requiring any `BACKUP_*` var.

- [ ] **Step 6: Record the evidence**

Append a dated results note to this plan file (or a linked
`scripts/poc-backup/RESULTS.md`, matching the `scripts/poc-transcription/`
convention) documenting what was run and its actual output, then update
`docs/TASKS.md` with:
```
Verified: YYYY-MM-DD (setup-local.mjs with BACKUP_MODE=enabled against a
disposable Backblaze B2 bucket; manual run-backup.sh + verify-backup.sh +
full restore runbook; BACKUP_MODE=disabled confirmed as a no-op)
```

- [ ] **Step 7: Commit**

```bash
git add docs/TASKS.md scripts/poc-backup/RESULTS.md
git commit -m "docs: record backup/recovery manual verification evidence"
```
