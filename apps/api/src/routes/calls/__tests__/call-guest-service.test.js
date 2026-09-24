import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCallGuestService, CallGuestError } from "../call-guest-service.js";

const CALL = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const GUEST = "99999999-9999-4999-8999-999999999999";

function env() {
  return {
    LIVEKIT_MODE: "embedded",
    LIVEKIT_URL: "wss://rtc.example.test",
    LIVEKIT_INTERNAL_URL: "http://livekit:7880",
    LIVEKIT_API_KEY: "api-key",
    LIVEKIT_API_SECRET: "super-secret",
  };
}

class FakeToken {
  constructor(key, secret, opts) { this.key = key; this.secret = secret; this.opts = opts; this.grant = null; }
  addGrant(g) { this.grant = g; }
  async toJwt() { return "guest-jwt"; }
}

const liveCall = { id: CALL, conversationId: CONV, kind: "VIDEO", status: "ACTIVE", livekitRoomName: `call_${CALL}` };

function baseLinksService(link = { id: "l1", conversationId: CONV, requireLobby: true, useCount: 0 }) {
  return {
    resolveLinkForJoin: async () => link,
    resolveInvite: async () => null,
  };
}

describe("createCallGuestService.joinAsGuest", () => {
  it("rate-limits the 9th attempt from one IP in 10 minutes", async () => {
    const prisma = {
      callGuestJoinAttempt: { count: async () => 8, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: { count: async () => 0, create: async ({ data }) => ({ id: GUEST, ...data }) },
      callLink: { update: async () => ({}) },
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    await assert.rejects(
      svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" }),
      (e) => e instanceof CallGuestError && e.status === 429,
    );
  });

  it("creates a LOBBY guest when the link requires a lobby", async () => {
    let createData;
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: { count: async () => 0, findFirst: async () => null, create: async ({ data }) => { createData = data; return { id: GUEST, ...data }; } },
      callLink: { update: async () => ({}) },
      callParticipant: { findMany: async () => [] },
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    const out = await svc.joinAsGuest({ token: "t", displayName: "  Ana  ", ip: "192.0.2.1" });
    assert.equal(out.status, "LOBBY");
    assert.equal(createData.status, "LOBBY");
    assert.equal(createData.displayName, "Ana");
    assert.match(createData.livekitIdentity, /^guest_/);
    assert.ok(out.guestToken && out.guestToken.length >= 32);
  });

  it("admits immediately when the link does not require a lobby", async () => {
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: { count: async () => 0, findFirst: async () => null, create: async ({ data }) => ({ id: GUEST, ...data }) },
      callLink: { update: async () => ({}) },
      callParticipant: { findMany: async () => [] },
    };
    const links = baseLinksService({ id: "l1", conversationId: CONV, requireLobby: false, useCount: 0 });
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: links });
    const out = await svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" });
    assert.equal(out.status, "ADMITTED");
  });

  it("returns waiting when there is no live call", async () => {
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [],
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    const out = await svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" });
    assert.equal(out.status, "waiting");
  });

  it("excludes lobby auto-poll attempts ('no_live_call') from the rate-limit count", async () => {
    let countArgs;
    const prisma = {
      callGuestJoinAttempt: { count: async (args) => { countArgs = args; return 0; }, create: async () => ({}) },
      $queryRaw: async () => [],
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    await svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" });
    assert.deepEqual(countArgs.where.outcome, { not: "no_live_call" });
  });

  it("forces LOBBY for a guest previously denied/kicked from this call, even on an open-access link", async () => {
    let createData;
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: {
        count: async () => 0,
        findFirst: async () => ({ id: "prev-guest" }), // simulates a prior DENIED/KICKED row for this ip/link
        create: async ({ data }) => { createData = data; return { id: GUEST, ...data }; },
      },
      callLink: { update: async () => ({}) },
      callParticipant: { findMany: async () => [] },
    };
    const links = baseLinksService({ id: "l1", conversationId: CONV, requireLobby: false, useCount: 0 });
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: links });
    const out = await svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" });
    assert.equal(out.status, "LOBBY");
    assert.equal(createData.status, "LOBBY");
  });

  it("rejects the 21st concurrent guest", async () => {
    const prisma = {
      callGuestJoinAttempt: { count: async () => 0, create: async () => ({}) },
      $queryRaw: async () => [liveCall],
      callGuest: { count: async () => 20, create: async () => ({}) },
    };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
    await assert.rejects(
      svc.joinAsGuest({ token: "t", displayName: "Ana", ip: "192.0.2.1" }),
      (e) => e instanceof CallGuestError && e.status === 409,
    );
  });
});

describe("createCallGuestService.getGuestState", () => {
  function svcFor({ guest, callRow = liveCall, recordingRows = [] }) {
    const prisma = {
      callGuest: {
        findFirst: async () => guest,
        update: async () => ({}),
        findMany: async () => [{ id: guest.id, displayName: guest.displayName }],
      },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes('FROM "call"')) return callRow ? [callRow] : [];
        if (sql.includes("FROM chat_messages")) return [];
        return [];
      },
    };
    // getGuestState now delegates the recording-active lookup to
    // call-service.js's shared getRecordingActiveStatus (single source of
    // truth for both the member and guest banners) instead of querying
    // call_recording directly — fake that dependency here.
    const callService = { getRecordingActiveStatus: async () => recordingRows.length > 0 };
    return createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService(), callService });
  }

  it("reports recording.active:true when a STARTING/ACTIVE call_recording row exists for this call", async () => {
    const guest = { id: GUEST, status: "ADMITTED", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" };
    const svc = svcFor({ guest, recordingRows: [{ id: "rec-1" }] });
    const out = await svc.getGuestState({ guestToken: "gt" });
    assert.deepEqual(out.recording, { active: true });
  });

  it("reports recording.active:false when there is no active recording", async () => {
    const guest = { id: GUEST, status: "ADMITTED", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" };
    const svc = svcFor({ guest, recordingRows: [] });
    const out = await svc.getGuestState({ guestToken: "gt" });
    assert.deepEqual(out.recording, { active: false });
  });

  it("reports recording.active:false (not an error) when the call no longer exists", async () => {
    const guest = { id: GUEST, status: "LEFT", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" };
    const svc = svcFor({ guest, callRow: null });
    const out = await svc.getGuestState({ guestToken: "gt" });
    assert.deepEqual(out.recording, { active: false });
  });

  it("never leaks egressId or other internal recording fields", async () => {
    const guest = { id: GUEST, status: "ADMITTED", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" };
    const svc = svcFor({ guest, recordingRows: [{ id: "rec-1", egressId: "EG_secret" }] });
    const out = await svc.getGuestState({ guestToken: "gt" });
    assert.deepEqual(out.recording, { active: true });
    assert.equal(JSON.stringify(out).includes("EG_secret"), false);
  });

  it("reads chat history from chat_messages (not call_message) for an admitted guest", async () => {
    let queriedChatMessages = false;
    const guest = { id: GUEST, status: "ADMITTED", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" };
    const prisma = {
      callGuest: {
        findFirst: async () => guest,
        update: async () => ({}),
        findMany: async () => [{ id: guest.id, displayName: guest.displayName }],
      },
      $queryRaw: async (strings) => {
        const text = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (text.includes('FROM "call"')) return [liveCall];
        if (text.includes("FROM chat_messages")) {
          queriedChatMessages = true;
          return [{ id: "msg-1", senderKind: "guest", senderName: "Ana", body: "hola", createdAt: new Date() }];
        }
        return [];
      },
    };
    const callService = { getRecordingActiveStatus: async () => false };
    const svc = createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService(), callService });
    const out = await svc.getGuestState({ guestToken: "gt" });
    assert.equal(queriedChatMessages, true);
    assert.deepEqual(out.messages, [{ id: "msg-1", senderKind: "guest", senderName: "Ana", body: "hola", createdAt: out.messages[0].createdAt }]);
  });
});

describe("createCallGuestService.getGuestLiveKitToken", () => {
  function svcFor(guest, call = liveCall) {
    const prisma = {
      callGuest: { findFirst: async () => guest, update: async () => ({}) },
      $queryRaw: async () => (call ? [call] : []),
    };
    return createCallGuestService({ prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService() });
  }
  it("refuses a guest that is not ADMITTED", async () => {
    await assert.rejects(
      svcFor({ id: GUEST, status: "LOBBY", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" }).getGuestLiveKitToken({ guestToken: "gt" }),
      (e) => e instanceof CallGuestError && e.status === 403,
    );
  });
  it("mints a room-scoped token for an ADMITTED guest and never returns the secret", async () => {
    const out = await svcFor({ id: GUEST, status: "ADMITTED", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" }).getGuestLiveKitToken({ guestToken: "gt" });
    assert.equal(out.token, "guest-jwt");
    assert.equal(out.livekitUrl, "wss://rtc.example.test");
    assert.equal(JSON.stringify(out).includes("super-secret"), false);
  });
  it("refuses when the call is no longer live", async () => {
    await assert.rejects(
      svcFor({ id: GUEST, status: "ADMITTED", callId: CALL, livekitIdentity: "guest_x", displayName: "Ana", sessionTokenHash: "h" }, null).getGuestLiveKitToken({ guestToken: "gt" }),
      (e) => e instanceof CallGuestError,
    );
  });
});

describe("createCallGuestService moderation", () => {
  it("admitGuest sets ADMITTED + admittedBy and broadcasts", async () => {
    let updateArgs;
    const broadcasts = [];
    const prisma = {
      $queryRaw: async () => [{ ...liveCall, initiatedByUserId: "host" }],
      callGuest: { findFirst: async () => ({ id: GUEST, callId: CALL, status: "LOBBY" }), update: async (a) => { updateArgs = a; return {}; } },
      callParticipant: { findMany: async () => [{ userId: "host" }] },
    };
    const svc = createCallGuestService({
      prisma, env: env(), AccessTokenImpl: FakeToken, linksService: baseLinksService(),
      callService: { assertCanManageCall: async () => {} },
      broadcaster: { broadcastToUsers: async (u, ev) => broadcasts.push(ev) },
    });
    await svc.admitGuest({ authUserId: "auth", profileId: "host", callId: CALL, guestId: GUEST });
    assert.equal(updateArgs.data.status, "ADMITTED");
    assert.equal(updateArgs.data.admittedByUserId, "host");
    assert.ok(broadcasts.includes("chat.call.guest_admitted"));
  });

  it("kickGuest flips status and calls removeParticipant", async () => {
    let removed;
    class FakeRoom { async removeParticipant(room, id) { removed = { room, id }; } }
    const prisma = {
      $queryRaw: async () => [{ ...liveCall, initiatedByUserId: "host" }],
      callGuest: { findFirst: async () => ({ id: GUEST, callId: CALL, status: "ADMITTED", livekitIdentity: "guest_x" }), update: async () => ({}) },
      callParticipant: { findMany: async () => [] },
    };
    const svc = createCallGuestService({
      prisma, env: env(), AccessTokenImpl: FakeToken, RoomServiceClientImpl: FakeRoom,
      linksService: baseLinksService(), callService: { assertCanManageCall: async () => {} },
      broadcaster: { broadcastToUsers: async () => {} },
    });
    await svc.kickGuest({ authUserId: "auth", profileId: "host", callId: CALL, guestId: GUEST });
    assert.deepEqual(removed, { room: `call_${CALL}`, id: "guest_x" });
  });

  it("kickGuest reports liveActionOk:false when LiveKit keeps failing, after retrying once", async () => {
    let attempts = 0;
    class FlakyRoom { async removeParticipant() { attempts += 1; throw new Error("livekit down"); } }
    const prisma = {
      $queryRaw: async () => [{ ...liveCall, initiatedByUserId: "host" }],
      callGuest: { findFirst: async () => ({ id: GUEST, callId: CALL, status: "ADMITTED", livekitIdentity: "guest_x" }), update: async () => ({}) },
      callParticipant: { findMany: async () => [] },
    };
    const svc = createCallGuestService({
      prisma, env: env(), AccessTokenImpl: FakeToken, RoomServiceClientImpl: FlakyRoom,
      linksService: baseLinksService(), callService: { assertCanManageCall: async () => {} },
      broadcaster: { broadcastToUsers: async () => {} },
    });
    const out = await svc.kickGuest({ authUserId: "auth", profileId: "host", callId: CALL, guestId: GUEST });
    assert.equal(out.liveActionOk, false);
    assert.equal(attempts, 2);
  });
});
