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

const liveCall = {
  id: CALL, conversationId: CONV, kind: "VIDEO", status: "ACTIVE",
  livekitRoomName: `call_${CALL}`, initiatedByUserId: USER,
};

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
      svc.startRecording({ callId: CALL, startedByUserId: USER, profileId: USER }),
      (e) => e instanceof CallRecordingError && e.status === 409,
    );
  });

  it("creates a STARTING row, starts a segmented-HLS egress with S3 output, and stores the egressId", async () => {
    let createData;
    let memberCheckArgs;
    const egress = new FakeEgress();
    const prisma = {
      $queryRaw: async (_strings, ...values) => { memberCheckArgs = values; return [{ id: "member-row" }]; },
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
    const out = await svc.startRecording({ callId: CALL, startedByUserId: USER, profileId: USER });
    assert.equal(out.status, "STARTING");
    assert.equal(createData.callId, CALL);
    assert.equal(createData.conversationId, CONV);
    assert.equal(egress.started.length, 1);
    assert.equal(egress.started[0].roomName, liveCall.livekitRoomName);
    assert.equal(egress.started[0].output.segments.output.case, "s3");
    assert.equal(egress.started[0].output.segments.output.value.bucket, "runly-chat");
    // IDOR guard: startRecording must check the caller is a MEMBER of the
    // call's conversation before touching LiveKit — chat.calls.record (the
    // role-level permission, gated in calls/index.js) proves the caller's
    // role is allowed to record at all, not that they belong to this call.
    assert.deepEqual(memberCheckArgs, [CONV, USER]);
  });

  it("rejects starting a recording when the caller is not a member of the call's conversation (IDOR guard)", async () => {
    const prisma = {
      $queryRaw: async () => [], // not a member
      callRecording: { findFirst: async () => null },
    };
    const egress = new FakeEgress();
    const svc = createCallRecordingService({
      prisma, env: env(), EgressClientImpl: egress,
      callService: { getLiveCallOrThrow: async () => liveCall },
    });
    await assert.rejects(
      svc.startRecording({ callId: CALL, startedByUserId: "someone-else", profileId: "someone-else" }),
      (e) => e instanceof CallRecordingError && e.status === 404,
    );
    // Never reaches LiveKit when the caller isn't a member.
    assert.equal(egress.started.length, 0);
  });
});

describe("createCallRecordingService.stopRecording", () => {
  it("throws 404 when there is no active recording for this call", async () => {
    const prisma = { callRecording: { findFirst: async () => null } };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress });
    await assert.rejects(
      svc.stopRecording({ callId: CALL, profileId: USER }),
      (e) => e instanceof CallRecordingError && e.status === 404,
    );
  });

  it("calls stopEgress and flips status to PROCESSING", async () => {
    let updateData;
    let memberCheckArgs;
    const egress = new FakeEgress();
    const prisma = {
      $queryRaw: async (_strings, ...values) => { memberCheckArgs = values; return [{ id: "member-row" }]; },
      callRecording: {
        findFirst: async () => ({ id: REC, callId: CALL, conversationId: CONV, egressId: "egress_1", status: "ACTIVE" }),
        update: async ({ data }) => { updateData = data; return { id: REC, ...data }; },
      },
    };
    // No callService needed: stopRecording checks membership off the
    // recording row's own conversationId, not by re-resolving the live call.
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: egress });
    const out = await svc.stopRecording({ callId: CALL, profileId: USER });
    assert.equal(out.status, "PROCESSING");
    assert.equal(updateData.status, "PROCESSING");
    assert.deepEqual(egress.stopped, ["egress_1"]);
    assert.deepEqual(memberCheckArgs, [CONV, USER]);
  });

  it("rejects stopping a recording when the caller is not a member of the call's conversation (IDOR guard)", async () => {
    const egress = new FakeEgress();
    const prisma = {
      $queryRaw: async () => [], // not a member
      callRecording: {
        findFirst: async () => ({ id: REC, callId: CALL, conversationId: CONV, egressId: "egress_1", status: "ACTIVE" }),
        update: async () => { throw new Error("must not be reached"); },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: egress });
    await assert.rejects(
      svc.stopRecording({ callId: CALL, profileId: "someone-else" }),
      (e) => e instanceof CallRecordingError && e.status === 404,
    );
    assert.equal(egress.stopped.length, 0);
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
          // playlistLocation deliberately does NOT match the expected key below —
          // the service must derive playlistObjectKey from conversationId/recordingId
          // itself, not trust this echoed-back field (see buildPlaylistObjectKey).
          segmentResults: [{ playlistName: "index.m3u8", playlistLocation: "https://storage.example.test/runly-chat/recordings/conv/index.m3u8", duration: 60_000_000_000n, size: 12_345n }],
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
    assert.equal(updateData.playlistObjectKey, `recordings/${CONV}/${REC}/index.m3u8`);
    assert.equal(updateData.durationMs, 60_000);
    assert.ok(updateData.expiresAt instanceof Date);
    assert.equal(posted.length, 1);
    // onRecordingReady is wired (apps/api/src/routes/calls/index.js) straight
    // into buildRecordingReadyMessage({ recordingId: rec.id, durationMs:
    // rec.durationMs }) and calls.postSystemMessage(rec.conversationId, ...)
    // — pin the exact fields that wiring reads off the callback's argument.
    assert.equal(posted[0].id, REC);
    assert.equal(posted[0].conversationId, CONV);
    assert.equal(posted[0].durationMs, 60_000);
    assert.equal(posted[0].status, "READY");
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

  it("looks up egress state by egressId, not via an active:true filter that would exclude terminal states", async () => {
    // Mirrors real LiveKit semantics: `listEgress({ active: true })` only
    // ever returns non-terminal egresses (STARTING/ACTIVE/ENDING) — it
    // structurally excludes COMPLETE/FAILED/ABORTED. If the service queried
    // with `{ active: true }` instead of `{ egressId }`, this fake would
    // filter the COMPLETE entry out and the assertions below would fail.
    class FilteringEgress extends FakeEgress {
      constructor(entries) {
        super();
        this.entries = entries;
        this.listCalls = [];
      }
      async listEgress(opts = {}) {
        this.listCalls.push(opts);
        if (opts.egressId) return this.entries.filter((e) => e.egressId === opts.egressId);
        if (opts.active) return this.entries.filter((e) => e.status <= 2);
        return this.entries;
      }
    }
    const egress = new FilteringEgress([{
      egressId: "egress_1",
      status: 3 /* EGRESS_COMPLETE */,
      segmentResults: [{ playlistLocation: "recordings/conv/rec/index.m3u8", duration: 10_000_000_000n, size: 999n }],
    }]);
    let updateData;
    const prisma = {
      callRecording: {
        findMany: async () => [{ id: REC, callId: CALL, conversationId: CONV, egressId: "egress_1", status: "PROCESSING", startedAt: new Date() }],
        update: async ({ data }) => { updateData = data; return {}; },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: egress });
    await svc.reconcileActiveRecordings();
    assert.equal(updateData.status, "READY");
    assert.ok(egress.listCalls.some((c) => c.egressId === "egress_1"));
    assert.ok(!egress.listCalls.some((c) => c.active === true));
  });

  it("retries stopEgress for a PROCESSING row whose egress is still non-terminal", async () => {
    class StillRunningEgress extends FakeEgress {
      async listEgress({ egressId } = {}) {
        return [{ egressId, status: 1 /* EGRESS_ACTIVE — not yet terminal */ }];
      }
    }
    const egress = new StillRunningEgress();
    const prisma = {
      callRecording: {
        findMany: async () => [{ id: REC, callId: CALL, conversationId: CONV, egressId: "egress_1", status: "PROCESSING", startedAt: new Date() }],
        update: async () => ({}),
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: egress });
    await svc.reconcileActiveRecordings();
    assert.deepEqual(egress.stopped, ["egress_1"]);
  });

  it("keeps reconciling remaining rows when one row's update throws unexpectedly", async () => {
    const updates = [];
    class DoneEgress extends FakeEgress {
      async listEgress({ egressId } = {}) {
        return [{
          egressId,
          status: 3 /* EGRESS_COMPLETE */,
          segmentResults: [{ playlistLocation: `recordings/conv/${egressId}/index.m3u8`, duration: 1_000_000_000n, size: 1n }],
        }];
      }
    }
    const prisma = {
      callRecording: {
        findMany: async () => [
          { id: "rec-a", callId: CALL, conversationId: CONV, egressId: "egress_a", status: "PROCESSING", startedAt: new Date() },
          { id: "rec-b", callId: CALL, conversationId: CONV, egressId: "egress_b", status: "PROCESSING", startedAt: new Date() },
        ],
        update: async ({ where, data }) => {
          if (where.id === "rec-a") throw new Error("boom");
          updates.push({ id: where.id, data });
          return {};
        },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: DoneEgress });
    await assert.doesNotReject(svc.reconcileActiveRecordings());
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, "rec-b");
  });

  it("returns without touching LiveKit when there are no active recordings", async () => {
    const egress = new FakeEgress();
    const prisma = { callRecording: { findMany: async () => [] } };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: egress });
    await svc.reconcileActiveRecordings();
    assert.equal(egress.started.length, 0);
    assert.equal(egress.stopped.length, 0);
  });
});

describe("createCallRecordingService.listRecordings", () => {
  it("attaches a signed playlistUrl only to READY rows with a playlistObjectKey", async () => {
    const prisma = {
      $queryRaw: async () => [{ id: "member-row" }], // caller is an active member
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
    const rows = await svc.listRecordings({ conversationId: CONV, profileId: USER });
    assert.equal(rows[0].playlistUrl, "https://signed.example/recordings/conv/rec/index.m3u8");
    assert.equal(rows[1].playlistUrl, undefined);
  });

  it("serializes a BigInt sizeBytes to a plain Number (JSON.stringify throws on raw BigInt)", async () => {
    const prisma = {
      $queryRaw: async () => [{ id: "member-row" }],
      callRecording: {
        findMany: async () => [{ id: REC, status: "READY", playlistObjectKey: null, sizeBytes: 123456789012345n }],
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress });
    const rows = await svc.listRecordings({ conversationId: CONV, profileId: USER });
    assert.equal(typeof rows[0].sizeBytes, "number");
    assert.equal(rows[0].sizeBytes, 123456789012345);
    assert.doesNotThrow(() => JSON.stringify(rows[0]));
  });

  it("rejects listing recordings for a caller who is not a member of the conversation (IDOR guard)", async () => {
    let findManyCalled = false;
    const prisma = {
      $queryRaw: async () => [], // not a member
      callRecording: {
        findMany: async () => { findManyCalled = true; return []; },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress });
    await assert.rejects(
      svc.listRecordings({ conversationId: CONV, profileId: "someone-else" }),
      (e) => e instanceof CallRecordingError && e.status === 404,
    );
    assert.equal(findManyCalled, false);
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

  it("returns only the count actually cleaned up, not the total expired, when one deletion fails", async () => {
    const prisma = {
      callRecording: {
        findMany: async () => [
          { id: "rec-a", playlistObjectKey: "recordings/conv/rec-a/index.m3u8" },
          { id: "rec-b", playlistObjectKey: "recordings/conv/rec-b/index.m3u8" },
        ],
        delete: async ({ where }) => {
          if (where.id === "rec-b") throw new Error("db unavailable");
          return {};
        },
      },
    };
    const supabaseAdmin = {
      storage: { from: () => ({ remove: async () => ({ error: null }), list: async () => ({ data: [], error: null }) }) },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress, supabaseAdmin });
    const count = await svc.cleanupExpiredRecordings();
    assert.equal(count, 1);
  });

  it("skips cleanup (leaves the DB row alone) when listing storage fails, instead of deleting only the playlist key", async () => {
    const deleted = [];
    const removed = [];
    const prisma = {
      callRecording: {
        findMany: async () => [{ id: REC, playlistObjectKey: "recordings/conv/rec/index.m3u8" }],
        delete: async ({ where }) => { deleted.push(where.id); return {}; },
      },
    };
    const supabaseAdmin = {
      storage: {
        from: () => ({
          remove: async (keys) => { removed.push(...keys); return { error: null }; },
          list: async () => ({ data: null, error: { message: "storage unavailable" } }),
        }),
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress, supabaseAdmin });
    const count = await svc.cleanupExpiredRecordings();
    assert.equal(count, 0);
    assert.deepEqual(removed, []);
    assert.deepEqual(deleted, []);
  });
});

describe("createCallRecordingService.deleteRecording", () => {
  it("deletes a FAILED row with no storage object to clean up", async () => {
    let deletedId;
    const prisma = {
      $queryRaw: async () => [{ id: "member-row" }],
      callRecording: {
        findUnique: async () => ({ id: REC, conversationId: CONV, status: "FAILED", playlistObjectKey: null }),
        delete: async ({ where }) => { deletedId = where.id; return {}; },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress });
    await svc.deleteRecording({ recordingId: REC, profileId: USER });
    assert.equal(deletedId, REC);
  });

  it("removes the storage objects for a READY row before deleting it", async () => {
    const removedKeys = [];
    let deletedId;
    const prisma = {
      $queryRaw: async () => [{ id: "member-row" }],
      callRecording: {
        findUnique: async () => ({
          id: REC, conversationId: CONV, status: "READY",
          playlistObjectKey: "recordings/conv/rec/index.m3u8",
        }),
        delete: async ({ where }) => { deletedId = where.id; return {}; },
      },
    };
    const supabaseAdmin = {
      storage: {
        from: () => ({
          remove: async (keys) => { removedKeys.push(...keys); return { error: null }; },
          list: async () => ({ data: [], error: null }),
        }),
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress, supabaseAdmin });
    await svc.deleteRecording({ recordingId: REC, profileId: USER });
    assert.deepEqual(removedKeys, ["recordings/conv/rec/index.m3u8"]);
    assert.equal(deletedId, REC);
  });

  it("rejects deleting a still-active (STARTING/ACTIVE) recording — must stop it first", async () => {
    let deleteCalled = false;
    const prisma = {
      $queryRaw: async () => [{ id: "member-row" }],
      callRecording: {
        findUnique: async () => ({ id: REC, conversationId: CONV, status: "ACTIVE", playlistObjectKey: null }),
        delete: async () => { deleteCalled = true; return {}; },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress });
    await assert.rejects(
      svc.deleteRecording({ recordingId: REC, profileId: USER }),
      (e) => e instanceof CallRecordingError && e.status === 409,
    );
    assert.equal(deleteCalled, false);
  });

  it("rejects deleting a recording that does not exist", async () => {
    const prisma = { callRecording: { findUnique: async () => null } };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress });
    await assert.rejects(
      svc.deleteRecording({ recordingId: REC, profileId: USER }),
      (e) => e instanceof CallRecordingError && e.status === 404,
    );
  });

  it("rejects deleting a recording for a caller who is not a member of the conversation (IDOR guard)", async () => {
    let deleteCalled = false;
    const prisma = {
      $queryRaw: async () => [], // not a member
      callRecording: {
        findUnique: async () => ({ id: REC, conversationId: CONV, status: "READY", playlistObjectKey: null }),
        delete: async () => { deleteCalled = true; return {}; },
      },
    };
    const svc = createCallRecordingService({ prisma, env: env(), EgressClientImpl: FakeEgress });
    await assert.rejects(
      svc.deleteRecording({ recordingId: REC, profileId: "someone-else" }),
      (e) => e instanceof CallRecordingError && e.status === 404,
    );
    assert.equal(deleteCalled, false);
  });
});
