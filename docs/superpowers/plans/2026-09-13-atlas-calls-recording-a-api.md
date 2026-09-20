# Grabación de llamadas — Plan A (API + infraestructura) — Implementation Plan

Date: 2026-09-13
Spec: docs/superpowers/specs/2026-09-13-atlas-calls-recording-design.md
Status: Draft

> **For agentic workers:** Declare `Mode: IMPLEMENTATION` before starting. Do not begin coding until the spec is approved and this plan is approved. Use checkbox syntax (`- [ ]`) to track progress. Mark each task completed only after its validation commands pass.
>
> REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to execute this plan task-by-task.

## Goal

Give the API the ability to start/stop a LiveKit room-composite HLS recording of a call, track its lifecycle (`STARTING → ACTIVE → PROCESSING → READY|FAILED`), enforce a 4-hour hard duration cap, auto-stop orphaned recordings when a call ends, expose recording state to members and guests, and auto-delete recordings past their 90-day retention. This plan does **not** touch any UI — see Plan B for the frontend.

## Architecture summary

A new `call-recording-service.js` (same factory pattern as `call-guest-service.js`) wraps LiveKit's `EgressClient` (already available via `livekit-server-sdk@2.18.0`, re-exporting `SegmentedFileOutput`/`S3Upload`/`SegmentedFileProtocol` from `@livekit/protocol`). Recording state lives in a new Prisma model `CallRecording` (spec §10-11). Instead of a webhook, a periodic sweep (same `setInterval` pattern already used for `guestService.sweepAbandonedGuests`, spec §Approach) polls `EgressClient.listEgress({ active: true })` to detect completion/failure, enforces the 4h cap, and force-stops recordings whose call already ended. A separate sweep run deletes expired (`expiresAt < now`) recordings from Supabase Storage and the database. Egress uploads HLS segments directly to Supabase Storage's S3-compatible endpoint — the API never touches recording bytes.

**Discovery finding that changes scope vs. the spec:** `createCallsRouter` (`apps/api/src/routes/calls/index.js`) is invoked at `apps/api/src/index.js:3678` **without** a `requirePermission` dependency (unlike `createChatRouter`/`createNotesRouter`, which do receive it). This plan adds `requirePermission` to `createCallsRouter`'s params and threads it through from `index.js`, so the two new recording endpoints can use the same `requirePermission("chat.calls.record")` middleware pattern used everywhere else in the codebase (e.g. `apps/api/src/routes/chat/index.js:171`). That middleware sets `c.set("userId", context.profile.id)`, so route handlers read `c.get("userId")` directly — no need for the calls router's own `profileId(c)` raw-SQL helper in these two routes.

## Tech Stack

- `livekit-server-sdk@2.18.0` (`EgressClient`, `SegmentedFileOutput`, `SegmentedFileProtocol`, `S3Upload`) — already a dependency, no install needed.
- Prisma (new model, forward migration).
- `node:test` (existing test runner convention).

---

## File Structure Map

### Create

- `prisma/migrations/20260913120000_add_call_recording/migration.sql`
- `apps/api/src/routes/calls/call-recording-service.js`
- `apps/api/src/routes/calls/__tests__/call-recording-service.test.js`
- `infra/installer/livekit/egress.yaml`

### Modify

- `prisma/schema.prisma` — add `CallRecording` model + `CallRecordingStatus` enum-like status (plain `String`, matching the existing `CallGuest.status` convention — see spec §10).
- `apps/api/src/permission-catalog.js` — add `chat.calls.record` entry.
- `apps/api/src/manifests/official/feature-modules.js` — add `chat.calls.record` to `atlas.chat`'s `permissions` and `acl.actions`.
- `apps/api/src/routes/calls/index.js` — accept `requirePermission`, add 3 new routes, start the new sweep interval.
- `apps/api/src/routes/calls/call-service.js` — extract `postSystemMessage` (shared by the existing call-lifecycle cards and the new recording-ready card), add `recording: { active }` to `getCall`/`getCurrentCall` responses.
- `apps/api/src/routes/calls/call-system-messages.js` — add `buildRecordingReadyMessage`.
- `apps/api/src/routes/calls/call-guest-service.js` — add `recording: { active }` to `getGuestState` response.
- `apps/api/src/index.js` — pass `requirePermission` into `createCallsRouter({...})` at line 3678.
- `packages/sdk/src/domains/calls.js` — add `startRecording`, `stopRecording`, `listRecordings`.
- `infra/installer/docker-compose.yml` — add `egress` service under the `livekit` profile.
- `.env.example` — add `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`, `SUPABASE_S3_REGION`.

---

## Task 1 — Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260913120000_add_call_recording/migration.sql`

**Changes:**

Add the model right after `model CallGuestJoinAttempt` (prisma/schema.prisma:2096), following the exact field/mapping conventions already used by `CallGuest`/`CallLink`:

```prisma
model CallRecording {
  id                String    @id @default(uuid(7)) @db.Uuid
  callId            String    @db.Uuid @map("call_id")
  conversationId    String    @db.Uuid @map("conversation_id")
  status            String    @default("STARTING") // STARTING | ACTIVE | PROCESSING | READY | FAILED
  startedByUserId   String    @db.Uuid @map("started_by_user_id")
  egressId          String?   @map("egress_id")
  playlistObjectKey String?   @map("playlist_object_key")
  sizeBytes         BigInt?   @map("size_bytes")
  durationMs        Int?      @map("duration_ms")
  failureReason     String?   @map("failure_reason")
  startedAt         DateTime  @default(now()) @map("started_at")
  endedAt           DateTime? @map("ended_at")
  expiresAt         DateTime? @map("expires_at")
  createdAt         DateTime  @default(now()) @map("created_at")

  call      Call        @relation(fields: [callId], references: [id], onDelete: Cascade)
  startedBy UserProfile @relation("CallRecordingStartedBy", fields: [startedByUserId], references: [id])

  @@index([callId])
  @@index([conversationId])
  @@index([status])
  @@index([expiresAt])
  @@map("call_recording")
}
```

Add the inverse relation to `model Call` (prisma/schema.prisma:1970, next to `guests CallGuest[]`):

```prisma
  recordings CallRecording[]
```

Add the inverse relation to `model UserProfile` wherever its other `Call*` back-relations live (search `"CallGuestAdmittedBy"` in schema.prisma to find the right block and add next to it):

```prisma
  callRecordingsStarted CallRecording[] @relation("CallRecordingStartedBy")
```

- [ ] Step 1: Add the `CallRecording` model, the `Call.recordings` back-relation, and the `UserProfile.callRecordingsStarted` back-relation exactly as above.
- [ ] Step 2: Run `pnpm db:generate` locally — this only regenerates the Prisma client, no DB connection needed, so it's safe to run immediately to catch schema typos.
- [ ] Step 3: Create the migration file by hand (do NOT run `prisma migrate dev`, which would try to reach the shared VPS Postgres and could drift from other in-flight sessions' schema changes — write the SQL directly, matching the existing `call_guest`/`call_link` table SQL style):

```sql
-- prisma/migrations/20260913120000_add_call_recording/migration.sql
CREATE TABLE "call_recording" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "call_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "started_by_user_id" UUID NOT NULL,
    "egress_id" TEXT,
    "playlist_object_key" TEXT,
    "size_bytes" BIGINT,
    "duration_ms" INTEGER,
    "failure_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_recording_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "call_recording_call_id_idx" ON "call_recording"("call_id");
CREATE INDEX "call_recording_conversation_id_idx" ON "call_recording"("conversation_id");
CREATE INDEX "call_recording_status_idx" ON "call_recording"("status");
CREATE INDEX "call_recording_expires_at_idx" ON "call_recording"("expires_at");

ALTER TABLE "call_recording" ADD CONSTRAINT "call_recording_call_id_fkey"
    FOREIGN KEY ("call_id") REFERENCES "call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_recording" ADD CONSTRAINT "call_recording_started_by_user_id_fkey"
    FOREIGN KEY ("started_by_user_id") REFERENCES "user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

Confirm the exact default-uuid function name (`uuidv7()`) and `user_profile` table name by checking one already-applied migration first: `grep -n "uuidv7\|user_profile" prisma/migrations/*/migration.sql | head -5` — match whatever that shows verbatim, since column/function naming must be pixel-identical to existing migrations for `pnpm db:migrate` to apply cleanly against the shared schema history.

**Validation:**

```bash
pnpm db:generate
# Expected: "Generated Prisma Client" with no errors, CallRecording appears in the generated types.
node --check prisma/migrations/20260913120000_add_call_recording/migration.sql 2>/dev/null; echo "(SQL has no node syntax checker — read it back once instead)"
```

Do **not** run `pnpm db:migrate` yet — batch it with Task 2's seed-relevant changes and run both together at the end of this plan (single shared-DB round trip), per this repo's convention of minimizing migration churn against the shared VPS Postgres.

---

## Task 2 — Permission + manifest entry

**Files:**
- Modify: `apps/api/src/permission-catalog.js`
- Modify: `apps/api/src/manifests/official/feature-modules.js`

**Changes:**

- [ ] Step 1: In `apps/api/src/permission-catalog.js`, right after the `"chat.meridian.use"` entry (line 1403), add:

```js
  "chat.calls.record": {
    displayNameEs: "Grabar llamadas",
    descriptionEs: "Permite iniciar y detener la grabación de una videollamada.",
    groupKey: "chat",
    order: 60,
  },
```

- [ ] Step 2: In `apps/api/src/manifests/official/feature-modules.js`, inside the `atlas.chat` manifest block, add the key to `permissions` (after line 841) and to `acl.actions` (after line 849):

```js
  permissions: [
    { key: 'chat.access',               name: 'Acceder a Chat' },
    { key: 'chat.conversations.read',   name: 'Ver conversaciones' },
    { key: 'chat.conversations.create', name: 'Crear y enviar mensajes' },
    { key: 'chat.support.manage',       name: 'Gestionar soporte externo' },
    { key: 'chat.meridian.use',         name: 'Usar MeridIAn' },
    { key: 'chat.calls.record',         name: 'Grabar llamadas' },
  ],
  acl: {
    module: 'chat.access',
    actions: {
      'chat.conversations.read':   'chat.conversations.read',
      'chat.conversations.create': 'chat.conversations.create',
      'chat.support.manage':       'chat.support.manage',
      'chat.meridian.use':         'chat.meridian.use',
      'chat.calls.record':         'chat.calls.record',
    },
  },
```

**Validation:**

```bash
node --check apps/api/src/permission-catalog.js
node --check apps/api/src/manifests/official/feature-modules.js
```

Expected: both exit 0. `pnpm db:seed` (which inserts the permission row) runs at the end of this plan together with the migration — running it now against a schema without `call_recording` yet is fine (seed only touches `Permission`/`Role`/module tables), but batching keeps the number of shared-DB round trips down.

---

## Task 3 — `call-recording-service.js` core (TDD)

**Files:**
- Create: `apps/api/src/routes/calls/call-recording-service.js`
- Create: `apps/api/src/routes/calls/__tests__/call-recording-service.test.js`

**Changes:**

This service follows the exact factory shape of `call-guest-service.js`: `createCallRecordingService({ prisma, env, EgressClientImpl, callService, now })`, throwing a dedicated `CallRecordingError` (mirroring `CallGuestError`) that `handleError` in `apps/api/src/routes/calls/index.js` already knows how to render (it type-checks against a list of error classes — Task 5 adds this one to that list).

- [ ] Step 1: Write the failing tests first, in `apps/api/src/routes/calls/__tests__/call-recording-service.test.js`:

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCallRecordingService, CallRecordingError } from "../call-recording-service.js";

const CALL = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const REC = "44444444-4444-4444-8444-444444444444";

function env() {
  return {
    LIVEKIT_MODE: "embedded",
    LIVEKIT_URL: "wss://rtc.example.test",
    LIVEKIT_INTERNAL_URL: "http://livekit:7880",
    LIVEKIT_API_KEY: "api-key",
    LIVEKIT_API_SECRET: "super-secret",
    SUPABASE_S3_ENDPOINT: "https://supabase.example.test/storage/v1/s3",
    SUPABASE_S3_ACCESS_KEY_ID: "s3-key",
    SUPABASE_S3_SECRET_ACCESS_KEY: "s3-secret",
    SUPABASE_S3_REGION: "us-east-1",
  };
}

const liveCall = { id: CALL, conversationId: CONV, kind: "VIDEO", status: "ACTIVE", livekitRoomName: `call_${CALL}` };

class FakeEgress {
  constructor() { this.started = []; this.stopped = []; }
  async startRoomCompositeEgress(roomName, output, opts) {
    this.started.push({ roomName, output, opts });
    return { egressId: "egress_1", status: 0 /* EGRESS_STARTING */ };
  }
  async stopEgress(egressId) {
    this.stopped.push(egressId);
    return { egressId, status: 2 /* EGRESS_ENDING */ };
  }
  async listEgress() { return []; }
}

describe("createCallRecordingService.startRecording", () => {
  it("rejects when a recording is already STARTING/ACTIVE for this call", async () => {
    const prisma = {
      callRecording: { findFirst: async () => ({ id: REC, status: "ACTIVE" }) },
    };
    const svc = createCallRecordingService({
      prisma, env: env(), EgressClientImpl: FakeEgress,
      callService: { getLiveCallOrThrow: async () => liveCall },
    });
    await assert.rejects(
      svc.startRecording({ callId: CALL, startedByUserId: USER }),
      (e) => e instanceof CallRecordingError && e.status === 409,
    );
  });

  it("creates a STARTING row, starts a segmented-HLS egress with S3 output, and stores the egressId", async () => {
    let createData;
    const egress = new FakeEgress();
    const prisma = {
      callRecording: {
        findFirst: async () => null,
        create: async ({ data }) => { createData = data; return { id: REC, ...data }; },
        update: async ({ data }) => ({ id: REC, ...data }),
      },
    };
    const svc = createCallRecordingService({
      prisma, env: env(), EgressClientImpl: egress,
      callService: { getLiveCallOrThrow: async () => liveCall },
    });
    const out = await svc.startRecording({ callId: CALL, startedByUserId: USER });
    assert.equal(out.status, "STARTING");
    assert.equal(createData.callId, CALL);
    assert.equal(createData.conversationId, CONV);
    assert.equal(egress.started.length, 1);
    assert.equal(egress.started[0].roomName, liveCall.livekitRoomName);
    assert.equal(egress.started[0].output.segments.output.case, "s3");
    assert.equal(egress.started[0].output.segments.output.value.bucket, "atlas-chat");
  });
});

describe("createCallRecordingService.stopRecording", () => {
  it("throws 404 when there is no active recording for this call", async () => {
    const prisma = { callRecording: { findFirst: async () => null } };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress });
    await assert.rejects(
      svc.stopRecording({ callId: CALL }),
      (e) => e instanceof CallRecordingError && e.status === 404,
    );
  });

  it("calls stopEgress and flips status to PROCESSING", async () => {
    let updateData;
    const egress = new FakeEgress();
    const prisma = {
      callRecording: {
        findFirst: async () => ({ id: REC, callId: CALL, egressId: "egress_1", status: "ACTIVE" }),
        update: async ({ data }) => { updateData = data; return { id: REC, ...data }; },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: egress });
    const out = await svc.stopRecording({ callId: CALL });
    assert.equal(out.status, "PROCESSING");
    assert.equal(updateData.status, "PROCESSING");
    assert.deepEqual(egress.stopped, ["egress_1"]);
  });
});

describe("createCallRecordingService.reconcileActiveRecordings (sweep)", () => {
  it("promotes a COMPLETE egress to READY with playlist key and duration", async () => {
    let updateData;
    class DoneEgress extends FakeEgress {
      async listEgress() {
        return [{
          egressId: "egress_1",
          status: 3 /* EGRESS_COMPLETE */,
          segmentResults: [{ playlistName: "index.m3u8", playlistLocation: "recordings/conv/rec/index.m3u8", duration: 60_000_000_000n, size: 12_345n }],
        }];
      }
    }
    const prisma = {
      callRecording: {
        findMany: async () => [{ id: REC, callId: CALL, conversationId: CONV, egressId: "egress_1", status: "PROCESSING", startedAt: new Date() }],
        update: async ({ data }) => { updateData = data; return {}; },
      },
    };
    const posted = [];
    const svc = createCallRecordingService({
      prisma, env: env(), EgressClientImpl: DoneEgress,
      onRecordingReady: async (rec) => posted.push(rec),
    });
    await svc.reconcileActiveRecordings();
    assert.equal(updateData.status, "READY");
    assert.equal(updateData.playlistObjectKey, "recordings/conv/rec/index.m3u8");
    assert.equal(updateData.durationMs, 60_000);
    assert.ok(updateData.expiresAt instanceof Date);
    assert.equal(posted.length, 1);
  });

  it("marks a FAILED egress as FAILED with the reported error", async () => {
    let updateData;
    class FailedEgress extends FakeEgress {
      async listEgress() {
        return [{ egressId: "egress_1", status: 4 /* EGRESS_FAILED */, error: "room not found" }];
      }
    }
    const prisma = {
      callRecording: {
        findMany: async () => [{ id: REC, callId: CALL, conversationId: CONV, egressId: "egress_1", status: "PROCESSING", startedAt: new Date() }],
        update: async ({ data }) => { updateData = data; return {}; },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FailedEgress });
    await svc.reconcileActiveRecordings();
    assert.equal(updateData.status, "FAILED");
    assert.equal(updateData.failureReason, "room not found");
  });

  it("force-stops a recording that has been running past the 4-hour cap", async () => {
    const egress = new FakeEgress();
    const fourHoursAgo = new Date(Date.now() - (4 * 60 * 60 * 1000 + 1000));
    const prisma = {
      callRecording: {
        findMany: async () => [{ id: REC, callId: CALL, conversationId: CONV, egressId: "egress_1", status: "ACTIVE", startedAt: fourHoursAgo }],
        update: async () => ({}),
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: egress });
    await svc.reconcileActiveRecordings();
    assert.deepEqual(egress.stopped, ["egress_1"]);
  });

  it("force-stops a recording whose call is no longer live", async () => {
    const egress = new FakeEgress();
    const prisma = {
      callRecording: {
        findMany: async () => [{ id: REC, callId: CALL, conversationId: CONV, egressId: "egress_1", status: "ACTIVE", startedAt: new Date() }],
        update: async () => ({}),
      },
    };
    const svc = createCallRecordingService({
      prisma, env: env(), EgressClientImpl: egress,
      callService: { getLiveCallOrThrow: async () => { throw new Error("not live"); } },
    });
    await svc.reconcileActiveRecordings();
    assert.deepEqual(egress.stopped, ["egress_1"]);
  });
});

describe("createCallRecordingService.listRecordings", () => {
  it("attaches a signed playlistUrl only to READY rows with a playlistObjectKey", async () => {
    const prisma = {
      callRecording: {
        findMany: async () => [
          { id: REC, status: "READY", playlistObjectKey: "recordings/conv/rec/index.m3u8" },
          { id: "other", status: "PROCESSING", playlistObjectKey: null },
        ],
      },
    };
    const supabaseAdmin = {
      storage: { from: () => ({ createSignedUrl: async (key) => ({ data: { signedUrl: `https://signed.example/${key}` }, error: null }) }) },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress, supabaseAdmin });
    const rows = await svc.listRecordings({ conversationId: CONV });
    assert.equal(rows[0].playlistUrl, "https://signed.example/recordings/conv/rec/index.m3u8");
    assert.equal(rows[1].playlistUrl, undefined);
  });
});

describe("createCallRecordingService.cleanupExpiredRecordings", () => {
  it("deletes expired rows and their storage objects", async () => {
    const removedKeys = [];
    const prisma = {
      callRecording: {
        findMany: async () => [{ id: REC, playlistObjectKey: "recordings/conv/rec/index.m3u8" }],
        delete: async () => ({}),
      },
    };
    const supabaseAdmin = {
      storage: { from: () => ({ remove: async (keys) => { removedKeys.push(...keys); return { error: null }; }, list: async () => ({ data: [], error: null }) } ) },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress, supabaseAdmin });
    const count = await svc.cleanupExpiredRecordings();
    assert.equal(count, 1);
    assert.deepEqual(removedKeys, ["recordings/conv/rec/index.m3u8"]);
  });
});
```

- [ ] Step 2: Run the test file to confirm it fails on the missing module:

```bash
node --test apps/api/src/routes/calls/__tests__/call-recording-service.test.js
```

Expected: FAIL — `Cannot find module '../call-recording-service.js'`.

- [ ] Step 3: Implement `apps/api/src/routes/calls/call-recording-service.js`:

```js
import { EgressClient, SegmentedFileOutput, SegmentedFileProtocol, S3Upload } from "livekit-server-sdk";
import { readLiveKitConfig } from "./call-service.js";

const MAX_DURATION_MS = 4 * 60 * 60 * 1000; // hard cap — spec §24 risk 3
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // spec §5 goal 4
const RECORDING_BUCKET = "atlas-chat";
const ACTIVE_STATUSES = ["STARTING", "ACTIVE", "PROCESSING"];

export class CallRecordingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallRecordingError";
    this.status = status;
  }
}

function s3Config(env) {
  return {
    endpoint: String(env.SUPABASE_S3_ENDPOINT ?? "").trim(),
    accessKey: String(env.SUPABASE_S3_ACCESS_KEY_ID ?? "").trim(),
    secret: String(env.SUPABASE_S3_SECRET_ACCESS_KEY ?? "").trim(),
    region: String(env.SUPABASE_S3_REGION ?? "us-east-1").trim(),
  };
}

export function createCallRecordingService({
  prisma,
  env = process.env,
  EgressClientImpl = EgressClient,
  callService = null,
  supabaseAdmin = null,
  onRecordingReady = null,
  now = () => new Date(),
}) {
  function liveKit() {
    return readLiveKitConfig(env);
  }

  function egressClient() {
    const c = liveKit();
    return new EgressClientImpl(c.internalUrl, c.apiKey, c.apiSecret);
  }

  function objectPrefix(conversationId, recordingId) {
    return `recordings/${conversationId}/${recordingId}`;
  }

  async function startRecording({ callId, startedByUserId }) {
    const existing = await prisma.callRecording.findFirst({
      where: { callId, status: { in: ["STARTING", "ACTIVE"] } },
    });
    if (existing) throw new CallRecordingError("Ya hay una grabación en curso para esta llamada.", 409);

    if (!callService?.getLiveCallOrThrow) throw new CallRecordingError("No disponible.", 500);
    const call = await callService.getLiveCallOrThrow(callId);

    const s3 = s3Config(env);
    const record = await prisma.callRecording.create({
      data: { callId, conversationId: call.conversationId, status: "STARTING", startedByUserId },
    });

    const output = new SegmentedFileOutput({
      protocol: SegmentedFileProtocol.HLS_PROTOCOL,
      filenamePrefix: objectPrefix(call.conversationId, record.id),
      playlistName: "index.m3u8",
      segmentDuration: 6,
      output: {
        case: "s3",
        value: new S3Upload({ ...s3, bucket: RECORDING_BUCKET, forcePathStyle: true }),
      },
    });

    let info;
    try {
      info = await egressClient().startRoomCompositeEgress(call.livekitRoomName, { segments: output });
    } catch (error) {
      await prisma.callRecording.update({ where: { id: record.id }, data: { status: "FAILED", failureReason: error?.message ?? "No se pudo iniciar." } }).catch(() => {});
      throw new CallRecordingError("No se pudo iniciar la grabación.", 500);
    }

    const updated = await prisma.callRecording.update({
      where: { id: record.id },
      data: { egressId: info.egressId, status: "ACTIVE" },
    });
    return { id: updated.id, status: updated.status };
  }

  async function stopRecording({ callId }) {
    const record = await prisma.callRecording.findFirst({
      where: { callId, status: { in: ["STARTING", "ACTIVE"] } },
    });
    if (!record) throw new CallRecordingError("No hay una grabación activa para esta llamada.", 404);

    try {
      await egressClient().stopEgress(record.egressId);
    } catch { /* the sweep will retry/reconcile on the next tick */ }

    const updated = await prisma.callRecording.update({
      where: { id: record.id },
      data: { status: "PROCESSING" },
    });
    return { id: updated.id, status: updated.status };
  }

  async function listRecordings({ conversationId }) {
    const rows = await prisma.callRecording.findMany({
      where: { conversationId },
      orderBy: { startedAt: "desc" },
    });
    if (!supabaseAdmin) return rows;
    return Promise.all(rows.map(async (row) => {
      if (row.status !== "READY" || !row.playlistObjectKey) return row;
      try {
        const { data, error } = await supabaseAdmin.storage
          .from(RECORDING_BUCKET)
          .createSignedUrl(row.playlistObjectKey, 3600);
        if (error) return row;
        return { ...row, playlistUrl: data.signedUrl };
      } catch {
        return row; // playback surfaces "no disponible"-style state client-side if this stays unset
      }
    }));
  }

  function nsToMs(ns) {
    if (ns == null) return null;
    return Math.round(Number(ns) / 1_000_000);
  }

  // Periodic sweep (called every 30s alongside guestService.sweepAbandonedGuests
  // — see apps/api/src/routes/calls/index.js). Reconciles STARTING/ACTIVE/
  // PROCESSING rows against LiveKit's actual Egress state; nothing here relies
  // on a webhook. Spec §23 edge cases 1, 2, 4, 5.
  async function reconcileActiveRecordings() {
    const rows = await prisma.callRecording.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
    });
    if (!rows.length) return;

    const client = egressClient();
    const infos = rows.some((r) => r.egressId) ? await client.listEgress({ active: true }).catch(() => []) : [];
    const byId = new Map(infos.map((i) => [i.egressId, i]));

    for (const row of rows) {
      // Edge case 4: the call ended — force-stop an orphaned egress even if
      // LiveKit still reports it active.
      let callStillLive = true;
      if (callService?.getLiveCallOrThrow) {
        try { await callService.getLiveCallOrThrow(row.callId); }
        catch { callStillLive = false; }
      }
      // Edge case 2: hard duration cap.
      const overCap = now().getTime() - new Date(row.startedAt).getTime() > MAX_DURATION_MS;

      if ((!callStillLive || overCap) && row.status !== "PROCESSING" && row.egressId) {
        await client.stopEgress(row.egressId).catch(() => {});
        await prisma.callRecording.update({ where: { id: row.id }, data: { status: "PROCESSING" } }).catch(() => {});
        continue;
      }

      const info = row.egressId ? byId.get(row.egressId) : null;
      if (!info) continue; // still starting, or LiveKit hasn't reported it in this poll yet

      if (info.status === 3 /* EGRESS_COMPLETE */) {
        const seg = info.segmentResults?.[0];
        const data = {
          status: "READY",
          playlistObjectKey: seg?.playlistLocation ?? null,
          durationMs: nsToMs(seg?.duration),
          sizeBytes: seg?.size != null ? BigInt(seg.size) : null,
          endedAt: now(),
          expiresAt: new Date(now().getTime() + RETENTION_MS),
        };
        await prisma.callRecording.update({ where: { id: row.id }, data });
        if (onRecordingReady) await onRecordingReady({ ...row, ...data }).catch(() => {});
      } else if (info.status === 4 /* EGRESS_FAILED */ || info.status === 5 /* EGRESS_ABORTED */) {
        await prisma.callRecording.update({
          where: { id: row.id },
          data: { status: "FAILED", failureReason: info.error || "La grabación no se pudo completar.", endedAt: now() },
        });
      }
      // EGRESS_STARTING/ACTIVE/ENDING: nothing to do yet, check again next tick.
    }
  }

  // Spec §5 goal 4 / §23 edge case: delete storage objects + rows past retention.
  async function cleanupExpiredRecordings() {
    const expired = await prisma.callRecording.findMany({
      where: { status: "READY", expiresAt: { lt: now() } },
    });
    for (const rec of expired) {
      if (rec.playlistObjectKey && supabaseAdmin) {
        const prefix = rec.playlistObjectKey.split("/").slice(0, -1).join("/");
        const { data: files } = await supabaseAdmin.storage.from(RECORDING_BUCKET).list(prefix).catch(() => ({ data: [] }));
        const keys = (files ?? []).map((f) => `${prefix}/${f.name}`);
        if (keys.length) await supabaseAdmin.storage.from(RECORDING_BUCKET).remove(keys).catch(() => {});
        else await supabaseAdmin.storage.from(RECORDING_BUCKET).remove([rec.playlistObjectKey]).catch(() => {});
      }
      await prisma.callRecording.delete({ where: { id: rec.id } }).catch(() => {});
    }
    return expired.length;
  }

  return { startRecording, stopRecording, listRecordings, reconcileActiveRecordings, cleanupExpiredRecordings };
}
```

- [ ] Step 4: Run the tests again:

```bash
node --test apps/api/src/routes/calls/__tests__/call-recording-service.test.js
```

Expected: `# fail 0`, and `# pass` equal to the total number of `it(...)` blocks written above (10 as of this plan — recount if you add/remove cases while iterating).

- [ ] Step 5: Commit

```bash
git add apps/api/src/routes/calls/call-recording-service.js apps/api/src/routes/calls/__tests__/call-recording-service.test.js
git commit -m "feat(calls): add call-recording-service with LiveKit Egress orchestration

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

**Validation:**

```bash
node --test apps/api/src/routes/calls/__tests__/call-recording-service.test.js
```

---

## Task 4 — `getLiveCallOrThrow` on `call-service.js`

`call-recording-service.js` (Task 3) depends on `callService.getLiveCallOrThrow(callId)`, which does not exist yet — `call-service.js` has `liveCallForConversation`/similar private helpers but nothing public keyed by `callId` alone that throws when the call isn't live.

**Files:**
- Modify: `apps/api/src/routes/calls/call-service.js`

**Changes:**

- [ ] Step 1: Find the existing `getCall`/internal call-lookup helper in `call-service.js` (search for `async function getCall(` ) and add a small exported function next to it, reusing whatever raw-SQL lookup pattern that file already uses for `call` rows (mirror `call-guest-service.js`'s `liveCallById`, but exposed on the returned service object):

```js
  async function getLiveCallOrThrow(callId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", status,
             livekit_room_name AS "livekitRoomName", initiated_by_user_id AS "initiatedByUserId"
      FROM "call" WHERE id = ${callId} LIMIT 1
    `;
    const call = rows[0];
    if (!call || !["RINGING", "ACTIVE"].includes(call.status)) {
      throw new CallServiceError("La llamada no está activa.", 409);
    }
    return call;
  }
```

- [ ] Step 2: Add `getLiveCallOrThrow` to that factory's returned object (find the `return { ... }` at the bottom of `createCallService` and add it to the list).

**Validation:**

```bash
node --check apps/api/src/routes/calls/call-service.js
node --test apps/api/src/routes/calls/__tests__/call-service.test.js
```

Expected: both exit 0 / all existing tests still pass (this is a pure addition, no existing behavior touched).

---

## Task 5 — Wire routes + `requirePermission` into the calls router

**Files:**
- Modify: `apps/api/src/routes/calls/index.js`
- Modify: `apps/api/src/index.js`
- Modify: `apps/api/src/routes/calls/call-service.js`
- Modify: `apps/api/src/routes/calls/call-system-messages.js`

**Changes:**

- [ ] Step 1: In `apps/api/src/routes/calls/index.js`, import the new service/error class and add `requirePermission` to `createCallsRouter`'s destructured params:

```js
import { createCallRecordingService, CallRecordingError } from "./call-recording-service.js";
```

```js
export function createCallsRouter({
  prisma,
  supabaseAdmin = null,
  authMiddleware,
  requirePermission,
  notificationService = null,
  broadcaster = null,
  deliveryWorker = null,
  smtpService = null,
  service = null,
}) {
```

- [ ] Step 2: Add `CallRecordingError` to `handleError`'s type check list (next to `CallMessageError`).

- [ ] Step 3a: The "grabación lista" system-message card (spec §8) reuses the exact insert+broadcast logic `postCallSystemMessage` already has in `call-service.js:81-115`, generalized to take a conversation id and a prebuilt `{ body, metadata }` instead of building them from a `Call` row. In `call-service.js`, extract that shared part into its own function and make `postCallSystemMessage` call it:

```js
  async function postSystemMessage(conversationId, { body, metadata }) {
    try {
      const rows = await prisma.$queryRaw`
        INSERT INTO chat_messages (conversation_id, sender_type, body, message_type, metadata)
        VALUES (${conversationId}, 'system', ${body}, 'system', ${JSON.stringify(metadata)}::jsonb)
        RETURNING id, created_at
      `;
      const messageId = rows?.[0]?.id ?? null;
      const createdAt = rows?.[0]?.created_at ?? now();
      if (!messageId) return;
      await prisma.$executeRaw`
        UPDATE chat_conversations
        SET last_message_id = ${messageId}, last_message_at = ${createdAt}, updated_at = NOW()
        WHERE id = ${conversationId}
      `;
      const members = await listConversationMembers(conversationId);
      const memberIds = members.map((member) => member.userId).filter(Boolean);
      if (memberIds.length) {
        await broadcaster?.broadcastToUsers?.(memberIds, "chat.message.new", {
          conversationId, messageId, senderId: null, senderName: null, threadRootId: null, replyToMessageId: null,
        });
      }
    } catch (error) {
      console.warn("[atlas.calls] No se pudo publicar el mensaje de sistema:", error?.message ?? error);
    }
  }

  async function postCallSystemMessage(call, spec) {
    const { body, metadata } = buildCallSystemMessage(spec);
    await postSystemMessage(call.conversationId, { body, metadata: { call: { ...metadata.call, callId: call.id } } });
  }
```

Add `postSystemMessage` to `createCallService`'s returned object (next to wherever `postCallSystemMessage` itself is — check whether that one is even exported today; if it's private, `postSystemMessage` still needs to be added to the `return { ... }` list since `call-recording-service`'s wiring below calls it from outside this module).

- [ ] Step 3b: In `call-system-messages.js`, add the sibling pure builder next to `buildCallSystemMessage`:

```js
// spec: { recordingId: string, durationMs: number|null }
export function buildRecordingReadyMessage({ recordingId, durationMs }) {
  const totalSeconds = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  return {
    body: `Grabación lista · ${formatCallDuration(totalSeconds)}`,
    metadata: { recording: { recordingId, durationMs: durationMs ?? null } },
  };
}
```

This pins the exact metadata shape (`{ recording: { recordingId, durationMs } }`) that Plan B's `getRecordingMeta` helper reads — Plan B was written against this exact shape, so keep them in sync if either changes.

- [ ] Step 3c: Instantiate the recording service next to the others and start its sweeps alongside the existing guest sweep, wiring `onRecordingReady` to the two pieces above:

```js
import { buildRecordingReadyMessage } from "./call-system-messages.js";
```

```js
  const recordingService = createCallRecordingService({
    prisma, callService: calls, supabaseAdmin,
    onRecordingReady: async (rec) => {
      const msg = buildRecordingReadyMessage({ recordingId: rec.id, durationMs: rec.durationMs });
      await calls.postSystemMessage(rec.conversationId, msg);
    },
  });

  if (!service) {
    calls.startExpirySweeper();
    const t = setInterval(() => { guestService.sweepAbandonedGuests().catch(() => {}); }, 30_000);
    t.unref?.();
    const rt = setInterval(() => { recordingService.reconcileActiveRecordings().catch(() => {}); }, 30_000);
    rt.unref?.();
    const ct = setInterval(() => { recordingService.cleanupExpiredRecordings().catch(() => {}); }, 60 * 60 * 1000);
    ct.unref?.();
  }
```

- [ ] Step 4: Add the three routes, right after the existing `/:callId/messages` block (around line 167):

```js
  internal.post(
    "/:callId/recording/start",
    requirePermission("chat.calls.record"),
    async (c) => {
      try {
        const callId = callIdSchema.parse(c.req.param("callId"));
        const data = await recordingService.startRecording({ callId, startedByUserId: c.get("userId") });
        return c.json({ data }, 201);
      } catch (error) { return handleError(c, error, "Error iniciando la grabación."); }
    },
  );
  internal.post(
    "/:callId/recording/stop",
    requirePermission("chat.calls.record"),
    async (c) => {
      try {
        const callId = callIdSchema.parse(c.req.param("callId"));
        const data = await recordingService.stopRecording({ callId });
        return c.json({ data });
      } catch (error) { return handleError(c, error, "Error deteniendo la grabación."); }
    },
  );
  internal.get("/conversations/:conversationId/recordings", async (c) => {
    try {
      const conversationId = conversationIdSchema.parse(c.req.param("conversationId"));
      const data = await recordingService.listRecordings({ conversationId });
      return c.json({ data });
    } catch (error) { return handleError(c, error, "Error obteniendo grabaciones."); }
  });
```

- [ ] Step 5: In `apps/api/src/index.js:3678`, pass `requirePermission` through:

```js
app.route("/", createCallsRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission, notificationService, broadcaster, deliveryWorker: notificationDeliveryWorker, smtpService: callsSmtpService }));
```

- [ ] Step 6: Add a test case for `buildRecordingReadyMessage` to the existing `apps/api/src/routes/calls/__tests__/call-system-messages.test.js` (read its current `describe`/`it` structure first and add this as a sibling block in the same style):

```js
describe("buildRecordingReadyMessage", () => {
  it("formats duration and carries the recording id in metadata", () => {
    const { body, metadata } = buildRecordingReadyMessage({ recordingId: "rec-1", durationMs: 754_000 });
    assert.equal(body, "Grabación lista · 12:34");
    assert.deepEqual(metadata, { recording: { recordingId: "rec-1", durationMs: 754_000 } });
  });

  it("falls back to 0:00 when duration is missing", () => {
    const { body } = buildRecordingReadyMessage({ recordingId: "rec-1", durationMs: null });
    assert.equal(body, "Grabación lista · 0:00");
  });
});
```

(Import `buildRecordingReadyMessage` alongside whatever `call-system-messages.test.js` already imports from `../call-system-messages.js`.)

**Validation:**

```bash
node --check apps/api/src/routes/calls/index.js
node --check apps/api/src/index.js
node --check apps/api/src/routes/calls/call-service.js
node --check apps/api/src/routes/calls/call-system-messages.js
node --test apps/api/src/routes/calls/__tests__/call-routes.test.js
node --test apps/api/src/routes/calls/__tests__/call-system-messages.test.js
node --test apps/api/src/routes/calls/__tests__/call-service.test.js
```

Expected: all exit 0. If `call-routes.test.js` constructs `createCallsRouter` directly in its test setup, it will need `requirePermission` added to whatever fake dependency object it builds — a stub `(key) => async (c, next) => next()` is enough there, matching how that test file already fakes `authMiddleware`.

---

## Task 6 — Expose `recording.active` to members and guests

**Files:**
- Modify: `apps/api/src/routes/calls/call-service.js`
- Modify: `apps/api/src/routes/calls/call-guest-service.js`

**Changes:**

- [ ] Step 1: In `call-service.js`, find where `getCall`/`getCurrentCall` build their response object and add a `recording` field, querying the same way `getLiveCallOrThrow` does:

```js
    const activeRecording = await prisma.$queryRaw`
      SELECT id FROM "call_recording" WHERE call_id = ${call.id} AND status IN ('STARTING','ACTIVE') LIMIT 1
    `;
```

then include `recording: { active: activeRecording.length > 0 }` in both response objects (`getCall` and `getCurrentCall`).

- [ ] Step 2: In `call-guest-service.js`'s `getGuestState` (around line 253-286), add the same lookup and include `recording: { active: ... }` in its returned object — this is what makes the consent banner reachable from the unauthenticated guest screen (spec §23 edge case 6). Do **not** include `egressId` or any other internal field — only the boolean.

**Validation:**

```bash
node --check apps/api/src/routes/calls/call-service.js
node --check apps/api/src/routes/calls/call-guest-service.js
node --test apps/api/src/routes/calls/__tests__/call-service.test.js apps/api/src/routes/calls/__tests__/call-guest-service.test.js
```

Expected: all existing tests still pass (pure additive field on existing response shapes — no existing assertion should check for the *absence* of extra fields, but re-run to confirm).

---

## Task 7 — SDK domain methods

**Files:**
- Modify: `packages/sdk/src/domains/calls.js`

**Changes:**

- [ ] Step 1: Add next to `kickGuest`/`muteGuest` (same file edited earlier in this session for the bug-fix batch):

```js
    startRecording: (callId, token) => json(`/calls/${callId}/recording/start`, "POST", {}, token),
    stopRecording: (callId, token) => json(`/calls/${callId}/recording/stop`, "POST", {}, token),
    listRecordings: (conversationId, token) => json(`/calls/conversations/${conversationId}/recordings`, "GET", undefined, token),
```

Match the exact `json(path, method, body, token)` helper signature already used by the surrounding methods in this file — read a few lines above/below the insertion point first to confirm parameter order for a GET without a body (some methods in this file omit the body arg entirely for GET; follow whichever convention is already there).

**Validation:**

```bash
node --check packages/sdk/src/domains/calls.js
```

---

## Task 8 — Infra: LiveKit Egress service

**Files:**
- Create: `infra/installer/livekit/egress.yaml`
- Modify: `infra/installer/docker-compose.yml`
- Modify: `.env.example`

**Changes:**

- [ ] Step 1: Create `infra/installer/livekit/egress.yaml`, mirroring the structure of the existing `infra/installer/livekit/livekit.yaml.example` (read that file first for the exact key style/indentation used in this repo) — Egress needs Redis (to talk to the LiveKit server) and a default output config placeholder:

```yaml
# infra/installer/livekit/egress.yaml
log_level: info
api_key: ${LIVEKIT_API_KEY}
api_secret: ${LIVEKIT_API_SECRET}
ws_url: ws://livekit:7880
redis:
  address: livekit-redis:6379
```

- [ ] Step 2: In `infra/installer/docker-compose.yml`, add the `egress` service right after the `livekit` service block (after line 143, before `livekit-caddy`), same `profiles: ["livekit"]` so it comes up together with the rest of the LiveKit stack:

```yaml
  egress:
    image: ${LIVEKIT_EGRESS_IMAGE:-livekit/egress:v1.9.0}
    container_name: atlas-livekit-egress
    profiles: ["livekit"]
    restart: unless-stopped
    environment:
      - EGRESS_CONFIG_FILE=/etc/egress/egress.yaml
    volumes:
      - ./livekit/egress.yaml:/etc/egress/egress.yaml:ro
      - /var/run/docker.sock:/var/run/docker.sock
    depends_on:
      livekit-redis:
        condition: service_started
      livekit:
        condition: service_started
```

(The `docker.sock` mount is LiveKit Egress's own documented requirement — it spawns a Chrome-in-Docker helper container per recording job. Flag this explicitly to the user before deploying: it grants the `egress` container the ability to launch sibling containers on the host, which is a meaningfully larger trust boundary than the other LiveKit services and worth them being aware of, not something to silently wave through in an automated apply.)

- [ ] Step 3: In `.env.example`, add near the existing `SUPABASE_*` block:

```bash
# LiveKit Egress → Supabase Storage S3-compatible upload (call recordings).
# Get these from the self-hosted Supabase Storage container's own config on
# the VPS (/path/to/supabase/docker/.env) — NOT the same as
# SUPABASE_SERVICE_ROLE_KEY. See docs/superpowers/specs/2026-09-13-atlas-calls-recording-design.md §24 risk 2.
SUPABASE_S3_ENDPOINT=
SUPABASE_S3_ACCESS_KEY_ID=
SUPABASE_S3_SECRET_ACCESS_KEY=
SUPABASE_S3_REGION=us-east-1
```

**Validation:**

```bash
docker compose -f infra/installer/docker-compose.yml --profile livekit config >/dev/null
```

Expected: exits 0 (validates YAML + service graph syntactically) — **this does not start any container or touch the production VPS.** Actually deploying (`docker compose --profile livekit up -d` on the VPS, and sourcing the real `SUPABASE_S3_*` credentials from the Storage container's own config) is a production-infrastructure change and is explicitly **out of this plan's automated scope** — stop here and hand this step to the user to run manually, per this repo's rule that production infra changes need an explicit human action, not an agent-run deploy.

---

## Task 9 — Run the batched migration + seed

**Files:** none (execution-only task, no code changes).

- [ ] Step 1: `pnpm db:migrate` — applies `20260913120000_add_call_recording`.
- [ ] Step 2: `pnpm db:generate` — regenerate the client against the now-migrated schema (idempotent re-run; Task 1 already ran this against the schema file alone).
- [ ] Step 3: `pnpm db:seed` — seeds the `chat.calls.record` permission row from the manifest added in Task 2.

**Validation:**

```bash
pnpm db:migrate
pnpm db:generate
pnpm db:seed
```

Expected: all three exit 0. Confirm the permission landed with a read-only query (no secrets printed): `node -e "import('./apps/api/src/routes/calls/call-service.js')"` is not a real check — instead use Prisma Studio (`pnpm db:studio`) to visually confirm one row exists in `Permission` with `key = 'chat.calls.record'`, or ask the user to check `SELECT key FROM permission WHERE key = 'chat.calls.record';` via their own DB access (never run raw SQL against the shared VPS Postgres from here without it being a read-only, side-effect-free `SELECT`).

---

## Rollback Notes

- If aborted before Task 9: nothing has touched the shared database yet — just revert the modified/created files with `git checkout -- <files>` (or drop the branch, since this repo works directly on `main` — coordinate with the user before discarding anything already committed).
- If aborted after Task 9 (migration applied): create a new forward migration (`DROP TABLE "call_recording";` plus dropping its two foreign keys/indexes implicitly via the table drop) rather than editing `20260913120000_add_call_recording/migration.sql` — this repo's migrations are immutable once applied (CLAUDE.md).
- The `chat.calls.record` permission can be deactivated instantly without any migration by setting `Permission.active = false` for that row — this hides the record button end-to-end without a deploy.
- The Egress Docker service (Task 8) is additive and isolated under the `livekit` profile; removing it from `docker-compose.yml` and restarting the stack fully reverts the infra change with no data loss (in-flight recordings would fail and land in `FAILED` via the sweep's error handling).

---

## Verification Gate

Before marking any task complete in `docs/TASKS.md`:

- [ ] All task validation commands above have been run and their actual output recorded (not assumed).
- [ ] `node --test apps/api/src/routes/calls/__tests__/` (each file individually, per this repo's Windows/node:test convention) all pass.
- [ ] `pnpm build` passes with no errors introduced by this plan.
- [ ] Verification checklist at `docs/superpowers/templates/verification-checklist-template.md` filled in.
- [ ] `docs/TASKS.md` updated with `Verified: YYYY-MM-DD (commands executed)`.
- [ ] The Task 8 manual VPS deploy step is explicitly called out as **not yet done** until the user confirms they ran it themselves.
