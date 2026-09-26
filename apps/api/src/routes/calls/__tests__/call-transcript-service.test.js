import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TrackType } from "livekit-server-sdk";
import { createCallTranscriptService, CallTranscriptError } from "../call-transcript-service.js";

const CALL = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const COMPANY = "55555555-5555-4555-8555-555555555555";
const USER = "33333333-3333-4333-8333-333333333333";
const OTHER_USER = "66666666-6666-4666-8666-666666666666";
const REC = "44444444-4444-4444-8444-444444444444";
const TRANSCRIPT = "77777777-7777-4777-8777-777777777777";

const call = { id: CALL, conversationId: CONV };
const readyRecording = { id: REC, callId: CALL, status: "READY" };

function memberRows() { return [{ id: "member-row" }]; }

describe("createCallTranscriptService.requestTranscript", () => {
  it("rejects when the call does not exist", async () => {
    const prisma = { call: { findUnique: async () => null } };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.requestTranscript({ callId: CALL, requestedByUserId: USER, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 404,
    );
  });

  it("rejects when the caller is not a member of the call's conversation (IDOR guard)", async () => {
    const prisma = {
      call: { findUnique: async () => call },
      $queryRaw: async () => [], // not a member
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.requestTranscript({ callId: CALL, requestedByUserId: OTHER_USER, profileId: OTHER_USER }),
      (e) => e instanceof CallTranscriptError && e.status === 404,
    );
  });

  it("rejects when a transcript is already PENDING/PROCESSING for this call", async () => {
    const prisma = {
      call: { findUnique: async () => call },
      $queryRaw: async () => memberRows(),
      callTranscript: { findFirst: async () => ({ id: TRANSCRIPT, status: "PROCESSING" }) },
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.requestTranscript({ callId: CALL, requestedByUserId: USER, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 409,
    );
  });

  it("rejects (422) when there is no READY recording to transcribe yet — V1 depends on it", async () => {
    const prisma = {
      call: { findUnique: async () => call },
      $queryRaw: async () => memberRows(),
      callTranscript: { findFirst: async () => null },
      callRecording: { findFirst: async () => null },
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.requestTranscript({ callId: CALL, requestedByUserId: USER, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 422,
    );
  });

  it("creates a PENDING row scoped to the call's conversation/company and the ready recording, and audits it", async () => {
    let createData;
    let auditCall;
    const queryRawCalls = [];
    const prisma = {
      call: { findUnique: async () => call },
      $queryRaw: async (strings, ...values) => {
        queryRawCalls.push({ strings, values });
        // First $queryRaw call is the membership check, second resolves company_id.
        if (queryRawCalls.length === 1) return memberRows();
        return [{ company_id: COMPANY }];
      },
      callTranscript: {
        findFirst: async () => null,
        create: async ({ data }) => { createData = data; return { id: TRANSCRIPT, ...data }; },
      },
      callRecording: { findFirst: async () => readyRecording },
    };
    const svc = createCallTranscriptService({
      prisma,
      logAudit: async (args) => { auditCall = args; },
    });
    const out = await svc.requestTranscript({ callId: CALL, requestedByUserId: USER, profileId: USER });
    assert.equal(out.status, "PENDING");
    assert.equal(createData.callId, CALL);
    assert.equal(createData.conversationId, CONV);
    assert.equal(createData.companyId, COMPANY);
    assert.equal(createData.recordingId, REC);
    assert.equal(createData.sourceKind, "MIXED");
    assert.equal(createData.requestedByUserId, USER);
    assert.equal(auditCall.action, "chat.call_transcript.request");
    assert.equal(auditCall.companyId, COMPANY);
  });
});

describe("createCallTranscriptService.retryTranscript", () => {
  it("rejects retrying a transcript that is not FAILED", async () => {
    const prisma = {
      callTranscript: { findUnique: async () => ({ id: TRANSCRIPT, conversationId: CONV, status: "READY" }) },
      $queryRaw: async () => memberRows(),
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.retryTranscript({ transcriptId: TRANSCRIPT, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 409,
    );
  });

  it("resets a FAILED transcript to PENDING with a fresh attempt budget", async () => {
    let updateData;
    const prisma = {
      callTranscript: {
        findUnique: async () => ({ id: TRANSCRIPT, conversationId: CONV, companyId: COMPANY, status: "FAILED", attempts: 3 }),
        update: async ({ data }) => { updateData = data; return { id: TRANSCRIPT, ...data }; },
      },
      $queryRaw: async () => memberRows(),
    };
    const svc = createCallTranscriptService({ prisma });
    const out = await svc.retryTranscript({ transcriptId: TRANSCRIPT, profileId: USER });
    assert.equal(out.status, "PENDING");
    assert.equal(updateData.attempts, 0);
    assert.equal(updateData.failureReason, null);
    assert.equal(updateData.leaseExpiresAt, null);
  });

  it("rejects for a caller who is not a member of the conversation (IDOR guard)", async () => {
    const prisma = {
      callTranscript: { findUnique: async () => ({ id: TRANSCRIPT, conversationId: CONV, status: "FAILED" }) },
      $queryRaw: async () => [], // not a member
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.retryTranscript({ transcriptId: TRANSCRIPT, profileId: OTHER_USER }),
      (e) => e instanceof CallTranscriptError && e.status === 404,
    );
  });
});

describe("createCallTranscriptService.regenerateTranscript", () => {
  it("rejects regenerating a transcript that is not READY", async () => {
    const prisma = {
      callTranscript: { findUnique: async () => ({ id: TRANSCRIPT, conversationId: CONV, status: "PROCESSING" }) },
      $queryRaw: async () => memberRows(),
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.regenerateTranscript({ transcriptId: TRANSCRIPT, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 409,
    );
  });

  it("clears the old segments and resets a READY transcript back to PENDING, reusing the same row", async () => {
    let updateData;
    let deletedWhere;
    const prisma = {
      callTranscript: {
        findUnique: async () => ({ id: TRANSCRIPT, conversationId: CONV, companyId: COMPANY, status: "READY" }),
        update: async ({ data }) => { updateData = data; return { id: TRANSCRIPT, ...data }; },
      },
      callTranscriptSegment: {
        deleteMany: async ({ where }) => { deletedWhere = where; return { count: 0 }; },
      },
      $queryRaw: async () => memberRows(),
    };
    const svc = createCallTranscriptService({ prisma });
    const out = await svc.regenerateTranscript({ transcriptId: TRANSCRIPT, profileId: USER });
    assert.equal(out.status, "PENDING");
    assert.equal(deletedWhere.transcriptId, TRANSCRIPT);
    assert.equal(updateData.attempts, 0);
    assert.equal(updateData.failureReason, null);
    assert.equal(updateData.finalizedAt, null);
    assert.equal(updateData.expiresAt, null);
  });

  it("rejects for a caller who is not a member of the conversation (IDOR guard)", async () => {
    const prisma = {
      callTranscript: { findUnique: async () => ({ id: TRANSCRIPT, conversationId: CONV, status: "READY" }) },
      $queryRaw: async () => [], // not a member
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.regenerateTranscript({ transcriptId: TRANSCRIPT, profileId: OTHER_USER }),
      (e) => e instanceof CallTranscriptError && e.status === 404,
    );
  });
});

describe("createCallTranscriptService access control — stricter than recordings", () => {
  // Central behavior of docs/TRANSCRIPTION_SPEC.md §5.1: unlike recordings
  // (assertMember only), reading a transcript requires having REQUESTED it
  // or having been an actual CallParticipant of that specific call — being a
  // current member of the conversation is necessary but not sufficient.

  it("listTranscripts returns only transcripts the caller requested or participated in", async () => {
    const rows = [
      { id: "t-mine", conversationId: CONV, callId: "call-a", requestedByUserId: USER },
      { id: "t-participated", conversationId: CONV, callId: "call-b", requestedByUserId: OTHER_USER },
      { id: "t-not-mine", conversationId: CONV, callId: "call-c", requestedByUserId: OTHER_USER },
    ];
    const prisma = {
      $queryRaw: async (strings, ...values) => {
        // First call: conversation membership check (assertMember).
        if (values[0] === CONV && values.length === 2) return memberRows();
        // Subsequent calls: CallParticipant lookup per row, keyed by callId.
        const [callId] = values;
        return callId === "call-b" ? [{ 1: 1 }] : [];
      },
      callTranscript: { findMany: async () => rows },
    };
    const svc = createCallTranscriptService({ prisma });
    const out = await svc.listTranscripts({ conversationId: CONV, profileId: USER });
    assert.deepEqual(out.map((r) => r.id).sort(), ["t-mine", "t-participated"]);
  });

  it("getTranscript returns a non-leaking 404 for a member who neither requested it nor participated in that call", async () => {
    const prisma = {
      callTranscript: {
        findUnique: async () => ({
          id: TRANSCRIPT, conversationId: CONV, callId: CALL, requestedByUserId: OTHER_USER, segments: [],
        }),
      },
      $queryRaw: async (strings, ...values) => {
        // Conversation membership passes (caller IS a member)...
        if (values[0] === CONV) return memberRows();
        // ...but caller was never a CallParticipant of this specific call
        // (the second query's first bound value is callId, not conversationId).
        return [];
      },
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.getTranscript({ transcriptId: TRANSCRIPT, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 404,
    );
  });

  it("getTranscript succeeds for the user who requested it, even if they never joined the call as a CallParticipant row", async () => {
    const prisma = {
      callTranscript: {
        findUnique: async () => ({
          id: TRANSCRIPT, conversationId: CONV, callId: CALL, requestedByUserId: USER,
          segments: [{ id: "seg-1", startMs: 0, endMs: 1000, text: "hola" }],
        }),
      },
      $queryRaw: async (strings, ...values) => (values[0] === CONV ? memberRows() : []),
    };
    const svc = createCallTranscriptService({ prisma });
    const out = await svc.getTranscript({ transcriptId: TRANSCRIPT, profileId: USER });
    assert.equal(out.id, TRANSCRIPT);
    assert.equal(out.segments.length, 1);
  });

  it("flattens a PER_TRACK segment's resolved speakerUser/speakerGuest name onto speakerLabel", async () => {
    const prisma = {
      callTranscript: {
        findUnique: async () => ({
          id: TRANSCRIPT, conversationId: CONV, callId: CALL, requestedByUserId: USER,
          segments: [
            { id: "seg-1", startMs: 0, endMs: 1000, text: "hola", speakerUser: { displayName: "Raúl" }, speakerGuest: null },
            { id: "seg-2", startMs: 1000, endMs: 2000, text: "hola de vuelta", speakerUser: null, speakerGuest: { displayName: "Invitado" } },
            { id: "seg-3", startMs: 2000, endMs: 3000, text: "sin atribuir", speakerUser: null, speakerGuest: null },
          ],
        }),
      },
      $queryRaw: async (strings, ...values) => (values[0] === CONV ? memberRows() : []),
    };
    const svc = createCallTranscriptService({ prisma });
    const out = await svc.getTranscript({ transcriptId: TRANSCRIPT, profileId: USER });
    assert.equal(out.segments[0].speakerLabel, "Raúl");
    assert.equal(out.segments[1].speakerLabel, "Invitado");
    assert.equal(out.segments[2].speakerLabel, null);
  });
});

describe("createCallTranscriptService.deleteTranscript", () => {
  it("rejects deleting a transcript still PROCESSING", async () => {
    const prisma = {
      callTranscript: { findUnique: async () => ({ id: TRANSCRIPT, conversationId: CONV, status: "PROCESSING" }) },
      $queryRaw: async () => memberRows(),
    };
    const svc = createCallTranscriptService({ prisma });
    await assert.rejects(
      svc.deleteTranscript({ transcriptId: TRANSCRIPT, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 409,
    );
  });

  it("deletes a READY/FAILED transcript for any conversation member (admin-style action, gated by the route permission)", async () => {
    let deletedId;
    const prisma = {
      callTranscript: {
        findUnique: async () => ({ id: TRANSCRIPT, conversationId: CONV, companyId: COMPANY, status: "READY" }),
        delete: async ({ where }) => { deletedId = where.id; return {}; },
      },
      $queryRaw: async () => memberRows(),
    };
    const svc = createCallTranscriptService({ prisma });
    await svc.deleteTranscript({ transcriptId: TRANSCRIPT, profileId: USER });
    assert.equal(deletedId, TRANSCRIPT);
  });
});

describe("createCallTranscriptService.reconcileReadyTranscripts", () => {
  it("finalizes a READY transcript: sets expiresAt from the configured retention and fires onTranscriptReady", async () => {
    let updateData;
    const posted = [];
    const prisma = {
      callTranscript: {
        findMany: async () => [{ id: TRANSCRIPT, conversationId: CONV, status: "READY", finalizedAt: null, durationMs: 5000 }],
        update: async ({ data }) => { updateData = data; return {}; },
      },
      instanceConfig: { findUnique: async () => ({ value: "30" }) },
    };
    const svc = createCallTranscriptService({
      prisma,
      onTranscriptReady: async (t) => posted.push(t),
    });
    await svc.reconcileReadyTranscripts();
    assert.equal(posted.length, 1);
    assert.equal(posted[0].id, TRANSCRIPT);
    assert.ok(updateData.finalizedAt instanceof Date);
    const days = (updateData.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(days > 29 && days < 31, "expiresAt should be ~30 days out per the configured retention");
  });

  it("falls back to the default retention when InstanceConfig has no configured value", async () => {
    let updateData;
    const prisma = {
      callTranscript: {
        findMany: async () => [{ id: TRANSCRIPT, conversationId: CONV, status: "READY", finalizedAt: null }],
        update: async ({ data }) => { updateData = data; return {}; },
      },
      instanceConfig: { findUnique: async () => null },
    };
    const svc = createCallTranscriptService({ prisma, onTranscriptReady: async () => {} });
    await svc.reconcileReadyTranscripts();
    const days = (updateData.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(days > 364 && days < 366, "should fall back to the 365-day default");
  });

  it("leaves a row unfinalized (retried next tick) when the notification callback throws", async () => {
    let updateCalled = false;
    const prisma = {
      callTranscript: {
        findMany: async () => [{ id: TRANSCRIPT, conversationId: CONV, status: "READY", finalizedAt: null }],
        update: async () => { updateCalled = true; return {}; },
      },
      instanceConfig: { findUnique: async () => null },
    };
    const svc = createCallTranscriptService({
      prisma,
      onTranscriptReady: async () => { throw new Error("chat unavailable"); },
    });
    await assert.doesNotReject(svc.reconcileReadyTranscripts());
    assert.equal(updateCalled, false);
  });
});

describe("createCallTranscriptService.cleanupExpiredTranscripts", () => {
  it("hard-deletes expired READY transcripts (cascades segments via FK)", async () => {
    let deleteWhere;
    const prisma = {
      callTranscript: {
        findMany: async () => [{ id: TRANSCRIPT }],
        deleteMany: async ({ where }) => { deleteWhere = where; return { count: 1 }; },
      },
    };
    const svc = createCallTranscriptService({ prisma });
    const count = await svc.cleanupExpiredTranscripts();
    assert.equal(count, 1);
    assert.deepEqual(deleteWhere.id.in, [TRANSCRIPT]);
  });

  it("returns 0 without querying deleteMany when nothing is expired", async () => {
    let deleteManyCalled = false;
    const prisma = {
      callTranscript: {
        findMany: async () => [],
        deleteMany: async () => { deleteManyCalled = true; return { count: 0 }; },
      },
    };
    const svc = createCallTranscriptService({ prisma });
    const count = await svc.cleanupExpiredTranscripts();
    assert.equal(count, 0);
    assert.equal(deleteManyCalled, false);
  });
});

// --- V2 (Alternativa B, identificación de hablantes por pista) ---

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

const liveCall = { id: CALL, conversationId: CONV, status: "ACTIVE", livekitRoomName: `call_${CALL}` };
const GUEST_IDENTITY = "guest_88888888-8888-4888-8888-888888888888";
const GUEST_ID = "99999999-9999-4999-8999-999999999999";

class FakeRoomService {
  constructor(participants) { this.participants = participants; }
  async listParticipants() { return this.participants; }
}

class FakeTrackEgress {
  constructor() { this.started = []; this.stopped = []; }
  async startTrackEgress(roomName, output, trackId) {
    this.started.push({ roomName, output, trackId });
    return { egressId: `egress_${trackId}` };
  }
  async stopEgress(egressId) { this.stopped.push(egressId); return { egressId }; }
  async listEgress() { return []; }
}

describe("createCallTranscriptService.requestTrackTranscription", () => {
  it("rejects (422) when no participant has a published audio track", async () => {
    let calls = 0;
    const prisma = {
      $queryRaw: async () => { calls += 1; return calls === 1 ? memberRows() : [{ company_id: COMPANY }]; },
      callTranscript: { findFirst: async () => null },
    };
    const svc = createCallTranscriptService({
      prisma, env: env(),
      callService: { getLiveCallOrThrow: async () => liveCall },
      RoomServiceClientImpl: new FakeRoomService([{ identity: USER, tracks: [] }]),
    });
    await assert.rejects(
      svc.requestTrackTranscription({ callId: CALL, requestedByUserId: USER, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 422,
    );
  });

  it("rejects (409) when a transcript is already CAPTURING/PENDING/PROCESSING for this call", async () => {
    const prisma = {
      $queryRaw: async () => memberRows(),
      callTranscript: { findFirst: async () => ({ id: TRANSCRIPT, status: "CAPTURING" }) },
    };
    const svc = createCallTranscriptService({
      prisma, env: env(),
      callService: { getLiveCallOrThrow: async () => liveCall },
      RoomServiceClientImpl: new FakeRoomService([{ identity: USER, tracks: [{ sid: "TR_A", type: TrackType.AUDIO }] }]),
    });
    await assert.rejects(
      svc.requestTrackTranscription({ callId: CALL, requestedByUserId: USER, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 409,
    );
  });

  it("starts one track egress per attributable participant with a published mic, skipping unknown identities", async () => {
    const egress = new FakeTrackEgress();
    const trackRows = [];
    let queryRawCalls = 0;
    const prisma = {
      $queryRaw: async () => { queryRawCalls += 1; return queryRawCalls === 1 ? memberRows() : [{ company_id: COMPANY }]; },
      callTranscript: {
        findFirst: async () => null,
        create: async ({ data }) => ({ id: TRANSCRIPT, ...data }),
        update: async () => {},
      },
      callTranscriptTrack: {
        create: async ({ data }) => { trackRows.push(data); return { id: `track-${trackRows.length}`, ...data }; },
      },
      callParticipant: { findMany: async () => [{ livekitIdentity: USER, userId: USER }] },
      callGuest: { findMany: async () => [{ livekitIdentity: GUEST_IDENTITY, id: GUEST_ID }] },
    };
    const svc = createCallTranscriptService({
      prisma, env: env(),
      callService: { getLiveCallOrThrow: async () => liveCall },
      EgressClientImpl: egress,
      RoomServiceClientImpl: new FakeRoomService([
        { identity: USER, tracks: [{ sid: "TR_USER", type: TrackType.AUDIO }] },
        { identity: GUEST_IDENTITY, tracks: [{ sid: "TR_GUEST", type: TrackType.AUDIO }] },
        { identity: "unknown-identity", tracks: [{ sid: "TR_UNKNOWN", type: TrackType.AUDIO }] },
      ]),
    });

    const out = await svc.requestTrackTranscription({ callId: CALL, requestedByUserId: USER, profileId: USER });
    assert.equal(out.status, "CAPTURING");
    assert.equal(out.tracksStarted, 2);
    assert.equal(egress.started.length, 2, "the unknown identity must be skipped, never captured");
    assert.equal(trackRows.length, 2);
    assert.ok(trackRows.some((t) => t.speakerUserId === USER && !t.speakerGuestId));
    assert.ok(trackRows.some((t) => t.speakerGuestId === GUEST_ID && !t.speakerUserId));
    assert.ok(trackRows.every((t) => t.status === "ACTIVE"));
  });
});

describe("createCallTranscriptService.stopTrackTranscription", () => {
  it("rejects (404) when there is no CAPTURING transcript for this call", async () => {
    const prisma = { callTranscript: { findFirst: async () => null } };
    const svc = createCallTranscriptService({ prisma, env: env() });
    await assert.rejects(
      svc.stopTrackTranscription({ callId: CALL, profileId: USER }),
      (e) => e instanceof CallTranscriptError && e.status === 404,
    );
  });

  it("stops every active/starting track's egress and marks them PROCESSING", async () => {
    const egress = new FakeTrackEgress();
    let updateManyWhere;
    const prisma = {
      $queryRaw: async () => memberRows(),
      callTranscript: { findFirst: async () => ({ id: TRANSCRIPT, conversationId: CONV, status: "CAPTURING" }) },
      callTranscriptTrack: {
        findMany: async () => [
          { id: "track-1", egressId: "egress_1", status: "ACTIVE" },
          { id: "track-2", egressId: "egress_2", status: "STARTING" },
        ],
        updateMany: async ({ where }) => { updateManyWhere = where; return { count: 2 }; },
      },
    };
    const svc = createCallTranscriptService({ prisma, env: env(), EgressClientImpl: egress });
    const out = await svc.stopTrackTranscription({ callId: CALL, profileId: USER });
    assert.equal(out.id, TRANSCRIPT);
    assert.deepEqual(egress.stopped.sort(), ["egress_1", "egress_2"]);
    assert.deepEqual(updateManyWhere.id.in.sort(), ["track-1", "track-2"]);
  });
});

describe("createCallTranscriptService.reconcileActiveTranscriptTracks", () => {
  it("promotes a CAPTURING transcript to PENDING once every track is READY/FAILED with at least one READY", async () => {
    let transcriptUpdateData;
    const trackUpdates = {};
    const prisma = {
      callTranscript: {
        findMany: async () => [{
          id: TRANSCRIPT, callId: CALL, conversationId: CONV, status: "CAPTURING",
          tracks: [
            { id: "track-1", egressId: "egress_1", status: "ACTIVE", livekitIdentity: USER },
            { id: "track-2", egressId: "egress_2", status: "PROCESSING", livekitIdentity: GUEST_IDENTITY },
          ],
        }],
        update: async ({ data }) => { transcriptUpdateData = data; },
      },
      callTranscriptTrack: {
        update: async ({ where, data }) => { trackUpdates[where.id] = data; },
        findMany: async () => [
          { id: "track-1", status: trackUpdates["track-1"]?.status ?? "READY" },
          { id: "track-2", status: trackUpdates["track-2"]?.status ?? "FAILED" },
        ],
      },
    };
    const egress = {
      listEgress: async ({ egressId }) => {
        if (egressId === "egress_1") return [{ status: 3 /* EGRESS_COMPLETE */, fileResults: [{ duration: 5_000_000_000 }] }];
        if (egressId === "egress_2") return [{ status: 4 /* EGRESS_FAILED */, error: "boom" }];
        return [];
      },
      stopEgress: async () => {},
    };
    const svc = createCallTranscriptService({
      prisma, env: env(), EgressClientImpl: egress,
      callService: { getLiveCallOrThrow: async () => liveCall },
    });
    await svc.reconcileActiveTranscriptTracks();
    assert.equal(trackUpdates["track-1"].status, "READY");
    assert.equal(trackUpdates["track-2"].status, "FAILED");
    assert.equal(transcriptUpdateData.status, "PENDING");
  });

  it("marks the transcript FAILED (not PENDING) when every track fails", async () => {
    let transcriptUpdateData;
    const prisma = {
      callTranscript: {
        findMany: async () => [{
          id: TRANSCRIPT, callId: CALL, conversationId: CONV, status: "CAPTURING",
          tracks: [{ id: "track-1", egressId: "egress_1", status: "ACTIVE", livekitIdentity: USER }],
        }],
        update: async ({ data }) => { transcriptUpdateData = data; },
      },
      callTranscriptTrack: {
        update: async () => {},
        findMany: async () => [{ id: "track-1", status: "FAILED" }],
      },
    };
    const egress = {
      listEgress: async () => [{ status: 5 /* EGRESS_ABORTED */, error: "aborted" }],
      stopEgress: async () => {},
    };
    const svc = createCallTranscriptService({
      prisma, env: env(), EgressClientImpl: egress,
      callService: { getLiveCallOrThrow: async () => liveCall },
    });
    await svc.reconcileActiveTranscriptTracks();
    assert.equal(transcriptUpdateData.status, "FAILED");
  });
});
