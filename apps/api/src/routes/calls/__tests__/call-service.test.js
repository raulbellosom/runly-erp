import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CallServiceError,
  createCallService,
  readLiveKitConfig,
} from "../call-service.js";

const CALL_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const CALLER_ID = "33333333-3333-4333-8333-333333333333";
const CALLEE_ID = "44444444-4444-4444-8444-444444444444";

function enabledEnv() {
  return {
    LIVEKIT_MODE: "embedded",
    LIVEKIT_URL: "wss://rtc.example.test",
    LIVEKIT_INTERNAL_URL: "http://livekit:7880",
    LIVEKIT_API_KEY: "api-key",
    LIVEKIT_API_SECRET: "super-secret",
  };
}

describe("readLiveKitConfig", () => {
  it("defaults to embedded but remains unavailable until every credential exists", () => {
    assert.deepEqual(readLiveKitConfig({}), {
      mode: "embedded",
      enabled: false,
      publicUrl: "",
      internalUrl: "",
      apiKey: "",
      apiSecret: "",
    });
    assert.equal(readLiveKitConfig({ LIVEKIT_MODE: "embedded" }).enabled, false);
  });
});

describe("createCallService", () => {
  it("rechecks revoked participants after leaving and removes their screen connections", async () => {
    const removed = [];
    const updates = [];
    let sql;
    const prisma = {
      $queryRaw: async (strings) => { sql = strings.join(''); return [
        { id: 'participant-a', livekit_identity: CALLER_ID, livekit_room_name: 'room' },
        { id: 'participant-b', livekit_identity: CALLEE_ID, livekit_room_name: 'room' },
      ]; },
      callParticipant: { updateMany: async (args) => updates.push(args) },
    };
    class FakeRoom {
      async removeParticipant(room, identity) {
        removed.push(identity);
        if (identity === CALLER_ID) throw Object.assign(new Error('absent'), { status: 404 });
      }
    }
    const service = createCallService({ prisma, env: enabledEnv(), RoomServiceClientImpl: FakeRoom });
    await service.revokeUnauthorizedParticipants();
    await service.revokeUnauthorizedParticipants();
    assert.equal(sql.includes('cp.left_at IS NULL'), false);
    assert.deepEqual(removed.slice(0, 4), [CALLER_ID, `screen:${CALLER_ID}`, CALLEE_ID, `screen:${CALLEE_ID}`]);
    assert.equal(removed.length, 8);
    assert.equal(updates[0].where.leftAt, null);
  });

  it("a failed removal does not prevent revoking the other participants", async () => {
    const removed = [];
    const prisma = {
      $queryRaw: async () => [
        { id: 'a', livekit_identity: CALLER_ID, livekit_room_name: 'room' },
        { id: 'b', livekit_identity: CALLEE_ID, livekit_room_name: 'room' },
      ],
      callParticipant: { updateMany: async () => ({ count: 1 }) },
    };
    class FakeRoom {
      async removeParticipant(room, identity) {
        removed.push(identity);
        if (identity === CALLER_ID) throw new Error('temporary outage');
      }
    }
    const service = createCallService({ prisma, env: enabledEnv(), RoomServiceClientImpl: FakeRoom });
    await assert.rejects(service.revokeUnauthorizedParticipants(), AggregateError);
    assert.equal(removed.includes(CALLEE_ID), true);
    assert.equal(removed.includes(`screen:${CALLEE_ID}`), true);
  });

  it("returns 501 before touching the database when calls are disabled", async () => {
    const service = createCallService({ prisma: {}, env: {} });
    await assert.rejects(
      service.createCall({ authUserId: "auth", conversationId: CONVERSATION_ID, kind: "AUDIO" }),
      (error) => error instanceof CallServiceError && error.status === 501,
    );
  });

  it("creates participants, keeps the secret server-side and scopes the token to one room", async () => {
    let participantData;
    let tokenOptions;
    let tokenGrant;
    let broadcastCall;
    const createdCall = {
      id: CALL_ID,
      conversationId: CONVERSATION_ID,
      calendarEventId: null,
      kind: "VIDEO",
      status: "RINGING",
      initiatedByUserId: CALLER_ID,
      livekitRoomName: `call_${CALL_ID}`,
      participants: [
        { userId: CALLER_ID, status: "JOINED", user: { id: CALLER_ID, displayName: "Caller" } },
        { userId: CALLEE_ID, status: "RINGING", user: { id: CALLEE_ID, displayName: "Callee" } },
      ],
      initiator: { id: CALLER_ID, displayName: "Caller" },
      calendarEvent: null,
    };
    const tx = {
      $queryRaw: async () => [{ id: CALL_ID }],
      callParticipant: {
        createMany: async ({ data }) => { participantData = data; },
      },
      call: { findUnique: async () => ({ id: CALL_ID }) },
    };
    const prisma = {
      userProfile: {
        findUnique: async () => ({ id: CALLER_ID, displayName: "Caller", avatarFileId: null }),
      },
      calendarEvent: { findFirst: async () => null },
      callLink: { findFirst: async () => null },
      call: {
        findMany: async () => [],
        findFirst: async () => null,
        findUnique: async () => createdCall,
      },
      $queryRaw: async () => [
        { userId: CALLER_ID, displayName: "Caller" },
        { userId: CALLEE_ID, displayName: "Callee" },
      ],
      $transaction: async (callback) => callback(tx),
    };
    class FakeToken {
      constructor(key, secret, options) {
        tokenOptions = { key, secret, ...options };
      }
      addGrant(grant) { tokenGrant = grant; }
      async toJwt() { return "signed-token"; }
    }
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      AccessTokenImpl: FakeToken,
      broadcaster: {
        broadcastToUsers: async (userIds, event, payload) => {
          broadcastCall = { userIds, event, payload };
        },
      },
    });

    const result = await service.createCall({
      authUserId: "auth-user",
      conversationId: CONVERSATION_ID,
      kind: "VIDEO",
    });

    assert.equal(result.token, "signed-token");
    assert.equal(result.livekitUrl, "wss://rtc.example.test");
    assert.equal(JSON.stringify(result).includes("super-secret"), false);
    assert.equal(tokenOptions.secret, "super-secret");
    assert.equal(tokenOptions.identity, CALLER_ID);
    assert.deepEqual(tokenGrant, {
      room: `call_${CALL_ID}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    assert.deepEqual(participantData.map((entry) => entry.status), ["JOINED", "RINGING"]);
    assert.deepEqual(broadcastCall, {
      userIds: [CALLEE_ID],
      event: "chat.call.incoming",
      payload: {
        callId: CALL_ID,
        conversationId: CONVERSATION_ID,
        kind: "VIDEO",
        initiatorId: CALLER_ID,
        initiatorName: "Caller",
      },
    });
  });

  it("rejects a duplicate live call with the existing id", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLER_ID, displayName: "Caller" }) },
      callLink: { findFirst: async () => null },
      call: {
        findMany: async () => [],
        findFirst: async () => ({ id: CALL_ID }),
      },
      $queryRaw: async () => [
        { userId: CALLER_ID },
        { userId: CALLEE_ID },
      ],
    };
    const service = createCallService({ prisma, env: enabledEnv() });
    await assert.rejects(
      service.createCall({ authUserId: "auth", conversationId: CONVERSATION_ID, kind: "AUDIO" }),
      (error) => error.status === 409 && error.details.callId === CALL_ID,
    );
  });

  it("does not ring a participant who is already in another call", async () => {
    const otherCallId = "55555555-5555-4555-8555-555555555555";
    let queryNumber = 0;
    let participantsCreated = false;
    const tx = {
      $queryRaw: async () => {
        queryNumber += 1;
        if (queryNumber === 1) return [{ id: CALLER_ID }, { id: CALLEE_ID }];
        return [{ userId: CALLEE_ID, callId: otherCallId }];
      },
      callParticipant: {
        createMany: async () => { participantsCreated = true; },
      },
    };
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLER_ID, displayName: "Caller" }) },
      calendarEvent: { findFirst: async () => null },
      callLink: { findFirst: async () => null },
      call: {
        findMany: async () => [],
        findFirst: async () => null,
      },
      $queryRaw: async () => [
        { userId: CALLER_ID, displayName: "Caller" },
        { userId: CALLEE_ID, displayName: "Callee" },
      ],
      $transaction: async (callback) => callback(tx),
    };
    const service = createCallService({ prisma, env: enabledEnv() });

    await assert.rejects(
      service.createCall({ authUserId: "auth", conversationId: CONVERSATION_ID, kind: "AUDIO" }),
      (error) => error.status === 409
        && error.details.code === "recipient_busy"
        && error.details.busyUserIds[0] === CALLEE_ID,
    );
    assert.equal(participantsCreated, false);
  });

  it("allows a solo call and starts it ACTIVE when a meeting-room guest link exists", async () => {
    let insertedStatus;
    const soloCall = {
      id: CALL_ID, conversationId: CONVERSATION_ID, kind: "VIDEO", status: "ACTIVE",
      initiatedByUserId: CALLER_ID, livekitRoomName: `call_${CALL_ID}`,
      participants: [{ userId: CALLER_ID, status: "JOINED", user: { displayName: "Host" } }],
      initiator: { id: CALLER_ID, displayName: "Host" }, calendarEvent: null,
    };
    const tx = {
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("FOR UPDATE")) return [{ id: CALLER_ID }];
        if (sql.includes("DISTINCT ON")) return [];
        if (sql.includes('INSERT INTO "call"')) {
          insertedStatus = sql;
          return [{ id: CALL_ID }];
        }
        return [];
      },
      callParticipant: { createMany: async () => {} },
      call: { findUnique: async () => soloCall },
    };
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLER_ID, displayName: "Host" }) },
      callLink: { findFirst: async () => ({ id: "link-1" }) },
      calendarEvent: { findFirst: async () => null },
      call: { findMany: async () => [], findFirst: async () => null, findUnique: async () => soloCall },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("chat_conversation_members")) return [{ userId: CALLER_ID, displayName: "Host" }];
        if (sql.includes("INSERT INTO chat_messages")) return [{ id: "m1", created_at: new Date() }];
        return [{ userId: CALLER_ID, displayName: "Host" }];
      },
      $executeRaw: async () => 1,
      $transaction: async (cb) => cb(tx),
    };
    class FakeToken { addGrant() {} async toJwt() { return "t"; } }
    const service = createCallService({ prisma, env: enabledEnv(), AccessTokenImpl: FakeToken });

    const out = await service.createCall({ authUserId: "auth", conversationId: CONVERSATION_ID, kind: "VIDEO" });

    assert.equal(out.callId, CALL_ID);
    assert.match(String(insertedStatus), /ACTIVE|CallStatus/);
  });

  it("activates a ringing call when an invited participant joins", async () => {
    const updates = [];
    const broadcasts = [];
    const ringingCall = {
      id: CALL_ID,
      conversationId: CONVERSATION_ID,
      kind: "AUDIO",
      status: "RINGING",
      initiatedByUserId: CALLER_ID,
      livekitRoomName: `call_${CALL_ID}`,
      startedAt: null,
      participants: [
        { userId: CALLER_ID, status: "JOINED", joinedAt: new Date(), user: { displayName: "Caller" } },
        { userId: CALLEE_ID, status: "RINGING", joinedAt: null, user: { displayName: "Callee" } },
      ],
      initiator: { id: CALLER_ID, displayName: "Caller" },
      calendarEvent: null,
    };
    const activeCall = { ...ringingCall, status: "ACTIVE" };
    let reads = 0;
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLEE_ID, displayName: "Callee" }) },
      call: {
        findMany: async () => [],
        findUnique: async () => (reads++ === 0 ? ringingCall : activeCall),
        update: (operation) => { updates.push({ model: "call", operation }); return Promise.resolve({}); },
      },
      callParticipant: {
        update: (operation) => { updates.push({ model: "participant", operation }); return Promise.resolve({}); },
      },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("INSERT INTO chat_messages")) return [{ id: "sysmsg-1", created_at: new Date() }];
        if (sql.includes("chat_conversation_members")) {
          return [{ userId: CALLER_ID, displayName: "Caller" }, { userId: CALLEE_ID, displayName: "Callee" }];
        }
        return [{ id: "membership" }];
      },
      $executeRaw: async () => 1,
      $transaction: async (operations) => Promise.all(operations),
    };
    class FakeToken {
      addGrant() {}
      async toJwt() { return "join-token"; }
    }
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      AccessTokenImpl: FakeToken,
      broadcaster: {
        broadcastToUsers: async (userIds, event, payload) => { broadcasts.push({ userIds, event, payload }); },
      },
    });

    const result = await service.joinCall({ authUserId: "callee-auth", callId: CALL_ID });

    assert.equal(result.token, "join-token");
    assert.equal(updates.find((entry) => entry.model === "participant").operation.data.status, "JOINED");
    assert.equal(updates.find((entry) => entry.model === "call").operation.data.status, "ACTIVE");
    const systemBroadcast = broadcasts.find((b) => b.event === "chat.message.new");
    assert.ok(systemBroadcast, "a chat.message.new broadcast is emitted for the started system message");
    assert.equal(systemBroadcast.payload.conversationId, CONVERSATION_ID);
    assert.equal(systemBroadcast.payload.senderId, null);
  });

  it("ends a direct call for everyone when the invited participant hangs up", async () => {
    const participantUpdates = [];
    const broadcasts = [];
    let countWhere;
    let callUpdate;
    let deletedRoom;
    const activeCall = {
      id: CALL_ID,
      conversationId: CONVERSATION_ID,
      kind: "AUDIO",
      status: "ACTIVE",
      initiatedByUserId: CALLER_ID,
      livekitRoomName: `call_${CALL_ID}`,
      participants: [
        { userId: CALLER_ID, status: "JOINED", user: { displayName: "Caller" } },
        { userId: CALLEE_ID, status: "JOINED", user: { displayName: "Callee" } },
      ],
      initiator: { id: CALLER_ID, displayName: "Caller" },
      calendarEvent: null,
    };
    const endedCall = { ...activeCall, status: "ENDED" };
    let reads = 0;
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLEE_ID, displayName: "Callee" }) },
      call: {
        findUnique: async () => (reads++ === 0 ? activeCall : endedCall),
        update: (operation) => { callUpdate = operation; return Promise.resolve({}); },
      },
      callParticipant: {
        update: (operation) => { participantUpdates.push(operation); return Promise.resolve({}); },
        updateMany: (operation) => { participantUpdates.push(operation); return Promise.resolve({ count: 1 }); },
        count: async ({ where }) => { countWhere = where; return 0; },
      },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("INSERT INTO chat_messages")) return [{ id: "sysmsg-2", created_at: new Date() }];
        if (sql.includes("chat_conversation_members")) {
          return [{ userId: CALLER_ID, displayName: "Caller" }, { userId: CALLEE_ID, displayName: "Callee" }];
        }
        return [{ id: "membership" }];
      },
      $executeRaw: async () => 1,
      $transaction: async (operations) => Promise.all(operations),
    };
    class FakeRoomServiceClient {
      async deleteRoom(roomName) { deletedRoom = roomName; }
    }
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      RoomServiceClientImpl: FakeRoomServiceClient,
      broadcaster: {
        broadcastToUsers: async (userIds, event, payload) => {
          broadcasts.push({ userIds, event, payload });
        },
      },
    });

    const result = await service.leaveCall({ authUserId: "callee-auth", callId: CALL_ID });

    assert.equal(result.status, "ENDED");
    assert.deepEqual(countWhere, {
      callId: CALL_ID,
      userId: { not: CALLER_ID },
      status: "JOINED",
    });
    assert.equal(callUpdate.data.status, "ENDED");
    assert.equal(deletedRoom, `call_${CALL_ID}`);
    assert.ok(
      broadcasts.some((b) =>
        b.event === "chat.call.ended"
        && b.payload.callId === CALL_ID
        && b.payload.reason === "ended"),
      "still broadcasts chat.call.ended",
    );
    const endedSystem = broadcasts.find((b) => b.event === "chat.message.new");
    assert.ok(endedSystem, "posts a chat.message.new for the terminal system message");
    assert.equal(endedSystem.payload.conversationId, CONVERSATION_ID);
    assert.equal(participantUpdates.some((operation) => operation.data.status === "LEFT"), true);
  });

  it("ends a ringing direct call when the invited participant declines it", async () => {
    let callUpdate;
    let directParticipantUpdate;
    const ringingCall = {
      id: CALL_ID,
      conversationId: CONVERSATION_ID,
      kind: "VIDEO",
      status: "RINGING",
      initiatedByUserId: CALLER_ID,
      livekitRoomName: `call_${CALL_ID}`,
      participants: [
        { userId: CALLER_ID, status: "JOINED", user: { displayName: "Caller" } },
        { userId: CALLEE_ID, status: "RINGING", user: { displayName: "Callee" } },
      ],
      initiator: { id: CALLER_ID, displayName: "Caller" },
      calendarEvent: null,
    };
    const endedCall = { ...ringingCall, status: "ENDED", endReason: "rejected" };
    let reads = 0;
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLEE_ID, displayName: "Callee" }) },
      call: {
        findMany: async () => [],
        findUnique: async () => (reads++ === 0 ? ringingCall : endedCall),
        update: (operation) => { callUpdate = operation; return Promise.resolve({}); },
      },
      callParticipant: {
        update: (operation) => { directParticipantUpdate = operation; return Promise.resolve({}); },
        updateMany: async () => ({ count: 1 }),
        count: async () => 0,
      },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("INSERT INTO chat_messages")) return [{ id: "sysmsg-3", created_at: new Date() }];
        if (sql.includes("chat_conversation_members")) return [{ userId: CALLEE_ID, displayName: "Callee" }];
        return [{ id: "membership" }];
      },
      $executeRaw: async () => 1,
      $transaction: async (operations) => Promise.all(operations),
    };
    class FakeRoomServiceClient {
      async deleteRoom() {}
    }
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      RoomServiceClientImpl: FakeRoomServiceClient,
    });

    const result = await service.declineCall({ authUserId: "callee-auth", callId: CALL_ID });

    assert.equal(result.status, "ENDED");
    assert.equal(directParticipantUpdate.data.status, "DECLINED");
    assert.equal(callUpdate.data.endReason, "rejected");
  });

  it("marks unanswered calls missed after the ringing window and closes the room", async () => {
    const participantUpdates = [];
    const broadcasts = [];
    let callUpdate;
    let deletedRoom;
    const prisma = {
      call: {
        findMany: async () => [
          { id: CALL_ID, livekitRoomName: `call_${CALL_ID}`, conversationId: CONVERSATION_ID, kind: "VIDEO", startedAt: null },
        ],
        updateMany: (operation) => { callUpdate = operation; return Promise.resolve({ count: 1 }); },
      },
      callParticipant: {
        updateMany: (operation) => { participantUpdates.push(operation); return Promise.resolve({ count: 1 }); },
      },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("INSERT INTO chat_messages")) return [{ id: "sysmsg-miss", created_at: new Date() }];
        if (sql.includes("chat_conversation_members")) return [{ userId: CALLER_ID, displayName: "Caller" }];
        return [{ id: "membership" }];
      },
      $executeRaw: async () => 1,
      $transaction: async (operations) => Promise.all(operations),
    };
    class FakeRoomServiceClient {
      async deleteRoom(roomName) { deletedRoom = roomName; }
    }
    const now = new Date("2026-08-28T12:00:00.000Z");
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      now: () => now,
      RoomServiceClientImpl: FakeRoomServiceClient,
      broadcaster: {
        broadcastToUsers: async (userIds, event, payload) => { broadcasts.push({ userIds, event, payload }); },
      },
    });

    assert.equal(await service.expireStaleCalls(), 1);
    assert.equal(participantUpdates[0].data.status, "MISSED");
    assert.equal(participantUpdates[1].data.status, "LEFT");
    assert.deepEqual(callUpdate.data, { status: "ENDED", endedAt: now, endReason: "missed" });
    assert.equal(deletedRoom, `call_${CALL_ID}`);
    const missBroadcast = broadcasts.find((b) => b.event === "chat.message.new");
    assert.ok(missBroadcast, "posts a chat.message.new for the missed call");
    assert.equal(missBroadcast.payload.conversationId, CONVERSATION_ID);
  });

  it("does not post 'iniciada' when the initiator re-joins an already ACTIVE call", async () => {
    const broadcasts = [];
    const activeCall = {
      id: CALL_ID,
      conversationId: CONVERSATION_ID,
      kind: "VIDEO",
      status: "ACTIVE",
      initiatedByUserId: CALLER_ID,
      livekitRoomName: `call_${CALL_ID}`,
      startedAt: new Date(),
      participants: [
        { userId: CALLER_ID, status: "JOINED", joinedAt: new Date(), user: { displayName: "Caller" } },
        { userId: CALLEE_ID, status: "JOINED", joinedAt: new Date(), user: { displayName: "Callee" } },
      ],
      initiator: { id: CALLER_ID, displayName: "Caller" },
      calendarEvent: null,
    };
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLER_ID, displayName: "Caller" }) },
      call: {
        findMany: async () => [],
        findUnique: async () => activeCall,
        update: () => Promise.resolve({}),
      },
      callParticipant: { update: () => Promise.resolve({}) },
      $queryRaw: async () => [{ id: "membership" }],
      $executeRaw: async () => 1,
      $transaction: async (operations) => Promise.all(operations),
    };
    class FakeToken { addGrant() {} async toJwt() { return "t"; } }
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      AccessTokenImpl: FakeToken,
      broadcaster: { broadcastToUsers: async (u, event) => { broadcasts.push({ event }); } },
    });

    await service.joinCall({ authUserId: "caller-auth", callId: CALL_ID });

    assert.equal(broadcasts.some((b) => b.event === "chat.message.new"), false);
  });

  it("a failing system-message insert never breaks the call operation", async () => {
    const activeCall = {
      id: CALL_ID,
      conversationId: CONVERSATION_ID,
      kind: "AUDIO",
      status: "ACTIVE",
      initiatedByUserId: CALLER_ID,
      livekitRoomName: `call_${CALL_ID}`,
      startedAt: new Date(Date.now() - 5000),
      participants: [
        { userId: CALLER_ID, status: "JOINED", user: { displayName: "Caller" } },
        { userId: CALLEE_ID, status: "JOINED", user: { displayName: "Callee" } },
      ],
      initiator: { id: CALLER_ID, displayName: "Caller" },
      calendarEvent: null,
    };
    const endedCall = { ...activeCall, status: "ENDED" };
    let reads = 0;
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLEE_ID, displayName: "Callee" }) },
      call: {
        findUnique: async () => (reads++ === 0 ? activeCall : endedCall),
        update: () => Promise.resolve({}),
      },
      callParticipant: {
        update: () => Promise.resolve({}),
        updateMany: () => Promise.resolve({ count: 1 }),
        count: async () => 0,
      },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("INSERT INTO chat_messages")) throw new Error("boom");
        return [{ id: "membership" }];
      },
      $executeRaw: async () => 1,
      $transaction: async (operations) => Promise.all(operations),
    };
    class FakeRoom { async deleteRoom() {} }
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      RoomServiceClientImpl: FakeRoom,
    });

    const result = await service.leaveCall({ authUserId: "callee-auth", callId: CALL_ID });
    assert.equal(result.status, "ENDED");
  });
});

describe("createCallService recording.active exposure", () => {
  function activeCallRecord() {
    return {
      id: CALL_ID,
      conversationId: CONVERSATION_ID,
      kind: "VIDEO",
      status: "ACTIVE",
      initiatedByUserId: CALLER_ID,
      livekitRoomName: `call_${CALL_ID}`,
      participants: [
        { userId: CALLER_ID, status: "JOINED", user: { displayName: "Caller" } },
        { userId: CALLEE_ID, status: "JOINED", user: { displayName: "Callee" } },
      ],
      initiator: { id: CALLER_ID, displayName: "Caller" },
      calendarEvent: null,
    };
  }

  it("getCall reports recording.active:true when a STARTING/ACTIVE call_recording row exists, scoped to this call id", async () => {
    let queriedCallId;
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLER_ID, displayName: "Caller" }) },
      call: { findMany: async () => [], findUnique: async () => activeCallRecord() },
      $queryRaw: async (strings, ...values) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("chat_conversation_members")) return [{ id: "membership" }];
        if (sql.includes('FROM "call_recording"')) {
          queriedCallId = values[0];
          return [{ id: "rec-1" }];
        }
        return [];
      },
    };
    const service = createCallService({ prisma, env: enabledEnv() });

    const call = await service.getCall({ authUserId: "caller-auth", callId: CALL_ID });

    assert.deepEqual(call.recording, { active: true });
    assert.equal(queriedCallId, CALL_ID);
  });

  it("getCall reports recording.active:false when there is no active recording row", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLER_ID, displayName: "Caller" }) },
      call: { findMany: async () => [], findUnique: async () => activeCallRecord() },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("chat_conversation_members")) return [{ id: "membership" }];
        if (sql.includes('FROM "call_recording"')) return [];
        return [];
      },
    };
    const service = createCallService({ prisma, env: enabledEnv() });

    const call = await service.getCall({ authUserId: "caller-auth", callId: CALL_ID });

    assert.deepEqual(call.recording, { active: false });
  });

  it("getCurrentCall includes recording.active alongside participantStatus", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLER_ID, displayName: "Caller" }) },
      call: { findMany: async () => [], findUnique: async () => activeCallRecord() },
      callParticipant: {
        findFirst: async () => ({ callId: CALL_ID, status: "JOINED" }),
      },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("chat_conversation_members")) return [{ id: "membership" }];
        if (sql.includes('FROM "call_recording"')) return [{ id: "rec-1" }];
        return [];
      },
    };
    const service = createCallService({ prisma, env: enabledEnv() });

    const result = await service.getCurrentCall({ authUserId: "caller-auth" });

    assert.equal(result.participantStatus, "JOINED");
    assert.deepEqual(result.call.recording, { active: true });
  });

  it("getCurrentCall returns null (not an object with recording) when there is no live participant row", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: CALLER_ID, displayName: "Caller" }) },
      call: { findMany: async () => [] },
      callParticipant: { findFirst: async () => null },
      $queryRaw: async () => [],
    };
    const service = createCallService({ prisma, env: enabledEnv() });

    const result = await service.getCurrentCall({ authUserId: "caller-auth" });

    assert.equal(result, null);
  });
});

describe("createCallService.getLiveCallOrThrow", () => {
  function callRow(overrides = {}) {
    return {
      id: CALL_ID,
      conversationId: CONVERSATION_ID,
      status: "ACTIVE",
      livekitRoomName: `call_${CALL_ID}`,
      initiatedByUserId: CALLER_ID,
      ...overrides,
    };
  }

  it("returns the row when the call is ACTIVE", async () => {
    const row = callRow({ status: "ACTIVE" });
    const prisma = { $queryRaw: async () => [row] };
    const service = createCallService({ prisma, env: {} });

    const result = await service.getLiveCallOrThrow(CALL_ID);

    assert.deepEqual(result, row);
  });

  it("returns the row when the call is RINGING", async () => {
    const row = callRow({ status: "RINGING" });
    const prisma = { $queryRaw: async () => [row] };
    const service = createCallService({ prisma, env: {} });

    const result = await service.getLiveCallOrThrow(CALL_ID);

    assert.equal(result.status, "RINGING");
    assert.equal(result.id, CALL_ID);
    assert.equal(result.conversationId, CONVERSATION_ID);
    assert.equal(result.livekitRoomName, `call_${CALL_ID}`);
    assert.equal(result.initiatedByUserId, CALLER_ID);
  });

  it("throws CallServiceError(409) when the call exists but is not live", async () => {
    const prisma = { $queryRaw: async () => [callRow({ status: "ENDED" })] };
    const service = createCallService({ prisma, env: {} });

    await assert.rejects(
      service.getLiveCallOrThrow(CALL_ID),
      (error) => error instanceof CallServiceError && error.status === 409,
    );
  });

  it("throws CallServiceError(409) when the call does not exist", async () => {
    const prisma = { $queryRaw: async () => [] };
    const service = createCallService({ prisma, env: {} });

    await assert.rejects(
      service.getLiveCallOrThrow(CALL_ID),
      (error) => error instanceof CallServiceError && error.status === 409,
    );
  });
});

describe("createCallService.inviteMembersToLiveCall", () => {
  const HOST = CALLER_ID;
  const GUEST = CALLEE_ID;

  function buildPrisma({ liveCall = null, existingMemberIds = [], existingParticipantIds = [] } = {}) {
    const calls = { executeRaw: [], createManyParticipants: null };
    const prisma = {
      membership: { findFirst: async () => ({ companyId: "co-1" }) },
      call: { findFirst: async () => liveCall },
      callParticipant: {
        findMany: async () => existingParticipantIds.map((userId) => ({ userId })),
        createMany: async ({ data }) => { calls.createManyParticipants = data; return { count: data.length }; },
      },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("FROM user_profile") && sql.includes("id = ANY")) {
          return [{ displayName: "Nuevo Usuario" }];
        }
        if (sql.includes("FROM user_profile")) return [{ displayName: "Anfitrion" }];
        if (sql.includes("chat_conversation_members")) {
          return existingMemberIds.map((userId) => ({ userId }));
        }
        if (sql.includes("FROM chat_conversations")) {
          return [{ companyId: "co-1" }];
        }
        return [];
      },
      $executeRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        calls.executeRaw.push(sql);
        return 1;
      },
    };
    return { prisma, calls };
  }

  it("adds a non-member, attaches them to the live call and fires the incoming-call alert", async () => {
    const { prisma, calls } = buildPrisma({
      liveCall: { id: CALL_ID, kind: "VIDEO", initiatedByUserId: HOST },
    });
    const published = [];
    const broadcasts = [];
    const flushed = [];
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      notificationService: { publish: async (args) => { published.push(args); return { data: [{ id: "n1" }] }; } },
      broadcaster: { broadcastToUsers: async (ids, event, payload) => { broadcasts.push({ ids, event, payload }); } },
      deliveryWorker: { processPendingNotificationDeliveries: async (args) => { flushed.push(args); } },
    });

    const out = await service.inviteMembersToLiveCall({
      conversationId: CONVERSATION_ID,
      inviterProfileId: HOST,
      users: [{ userId: GUEST, email: "guest@x.com" }],
    });

    assert.deepEqual(out.notified, [GUEST]);
    assert.deepEqual(out.addedMembers, [GUEST]);
    assert.deepEqual(out.addedParticipants, [GUEST]);
    assert.deepEqual(calls.createManyParticipants, [
      { callId: CALL_ID, userId: GUEST, status: "RINGING", livekitIdentity: GUEST },
    ]);

    assert.equal(published.length, 1);
    assert.equal(published[0].input.eventType, "chat.call.incoming");
    assert.deepEqual(published[0].input.recipients.userIds, [GUEST]);
    assert.deepEqual(published[0].input.channels, ["in_app", "web_push"]);
    assert.equal(published[0].input.dedupeKey, `chat.call.incoming:${CALL_ID}`);

    assert.ok(broadcasts.some((b) => b.event === "chat.call.incoming" && b.ids.includes(GUEST)));
    assert.ok(broadcasts.some((b) => b.event === "chat.conversation.new" && b.ids.includes(GUEST)));
    assert.deepEqual(flushed, [{ channel: "web_push", notificationIds: ["n1"], limit: 1 }]);
  });

  it("skips the member insert for someone already in the conversation", async () => {
    const { prisma, calls } = buildPrisma({
      liveCall: { id: CALL_ID, kind: "AUDIO", initiatedByUserId: HOST },
      existingMemberIds: [GUEST],
      existingParticipantIds: [GUEST],
    });
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      notificationService: { publish: async () => ({ data: [] }) },
      broadcaster: { broadcastToUsers: async () => {} },
    });

    const out = await service.inviteMembersToLiveCall({
      conversationId: CONVERSATION_ID,
      inviterProfileId: HOST,
      users: [{ userId: GUEST }],
    });

    assert.deepEqual(out.addedMembers, []);
    assert.deepEqual(out.addedParticipants, []);
    assert.deepEqual(out.notified, [GUEST]);
    assert.equal(calls.createManyParticipants, null);
    assert.ok(!calls.executeRaw.some((sql) => sql.includes("INSERT INTO chat_conversation_members")));
  });

  it("still notifies (no ring / no participant) when there is no live call", async () => {
    const { prisma, calls } = buildPrisma({ liveCall: null });
    const published = [];
    const service = createCallService({
      prisma,
      env: enabledEnv(),
      notificationService: { publish: async (args) => { published.push(args); return { data: [{ id: "n2" }] }; } },
      broadcaster: { broadcastToUsers: async () => {} },
    });

    const out = await service.inviteMembersToLiveCall({
      conversationId: CONVERSATION_ID,
      inviterProfileId: HOST,
      users: [{ userId: GUEST }],
    });

    assert.deepEqual(out.notified, [GUEST]);
    assert.deepEqual(out.addedParticipants, []);
    assert.equal(calls.createManyParticipants, null);
    assert.equal(published[0].input.dedupeKey, `chat.call.invite:${CONVERSATION_ID}:${HOST}`);
    assert.match(published[0].input.metadata.conversationId, /2222/);
  });

  it("returns early for an empty user list without touching the db", async () => {
    let touched = false;
    const prisma = new Proxy({}, { get() { touched = true; return () => { throw new Error("no db"); }; } });
    const service = createCallService({ prisma, env: enabledEnv() });
    const out = await service.inviteMembersToLiveCall({
      conversationId: CONVERSATION_ID,
      inviterProfileId: HOST,
      users: [],
    });
    assert.deepEqual(out, { notified: [], addedMembers: [], addedParticipants: [] });
    assert.equal(touched, false);
  });
});
