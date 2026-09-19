// apps/api/src/routes/chat/__tests__/meridian-guard.test.js
//
// Task 9 of the MeridIAn backend plan: the MeridIAn direct chat is a
// chat_conversations row with type = 'meridian'. It must not be renamable,
// deletable, archivable, hideable, and its membership is fixed. These tests
// prove each guarded conversation mutation rejects a 'meridian' conversation
// with a ChatServiceError whose message mentions "MeridIAn".
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createChatService,
  ChatServiceError,
  _resetProfileIdCacheForTests,
} from "../chat-service.js";

const AUTH_USER_ID = "auth-user-1";
const PROFILE_ID = "01900000-0000-7000-8000-0000000000p1";
const OTHER_PROFILE_ID = "01900000-0000-7000-8000-0000000000p2";
const CONV_ID = "01900000-0000-7000-8000-0000000000c1";

beforeEach(() => {
  _resetProfileIdCacheForTests();
});

// Content-addressed prisma double (not a fixed-sequence queue): every
// `SELECT ... FROM chat_conversations` resolves to a type 'meridian' row, while
// getUserProfileId (SELECT id FROM user_profile) and assertMember
// (SELECT id FROM chat_conversation_members) both succeed for the caller. This
// shape stays correct no matter how many SELECT-type probes a mutation issues
// before it hits the guard.
function buildMeridianPrisma() {
  const client = {
    $queryRaw: async (strings) => {
      const sql = Array.isArray(strings) ? strings.join(" ") : String(strings);
      if (/FROM user_profile/.test(sql)) return [{ id: PROFILE_ID }];
      if (/FROM chat_conversation_members/.test(sql)) return [{ id: "member-row" }];
      if (/FROM chat_conversations/.test(sql)) return [{ id: CONV_ID, type: "meridian" }];
      return [];
    },
    $executeRaw: async () => 1,
    $transaction: async (fn) => fn(client),
    membership: { findFirst: async () => null, findMany: async () => [] },
  };
  return client;
}

describe("chat-service — MeridIAn conversation mutation guard", () => {
  it("updateConversation (rename) is rejected with a ChatServiceError mentioning MeridIAn", async () => {
    const svc = createChatService({ prisma: buildMeridianPrisma() });
    await assert.rejects(
      () => svc.updateConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { title: "Nuevo" } }),
      (err) => err instanceof ChatServiceError && err.status === 400 && /MeridIAn/i.test(err.message),
    );
  });

  it("addMembers is rejected with a ChatServiceError mentioning MeridIAn", async () => {
    const svc = createChatService({ prisma: buildMeridianPrisma() });
    await assert.rejects(
      () => svc.addMembers({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, userIds: [OTHER_PROFILE_ID] }),
      (err) => err instanceof ChatServiceError && err.status === 400 && /MeridIAn/i.test(err.message),
    );
  });

  it("removeMember is rejected with a ChatServiceError mentioning MeridIAn", async () => {
    const svc = createChatService({ prisma: buildMeridianPrisma() });
    await assert.rejects(
      () => svc.removeMember({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID }),
      (err) => err instanceof ChatServiceError && err.status === 400 && /MeridIAn/i.test(err.message),
    );
  });

  it("deleteConversation is rejected with a ChatServiceError mentioning MeridIAn", async () => {
    const svc = createChatService({ prisma: buildMeridianPrisma() });
    await assert.rejects(
      () => svc.deleteConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 400 && /MeridIAn/i.test(err.message),
    );
  });

  it("archiveConversation is rejected with a ChatServiceError mentioning MeridIAn", async () => {
    const svc = createChatService({ prisma: buildMeridianPrisma() });
    await assert.rejects(
      () => svc.archiveConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 400 && /MeridIAn/i.test(err.message),
    );
  });

  it("hideConversation is rejected with a ChatServiceError mentioning MeridIAn", async () => {
    const svc = createChatService({ prisma: buildMeridianPrisma() });
    await assert.rejects(
      () => svc.hideConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 400 && /MeridIAn/i.test(err.message),
    );
  });

  it("pinConversation (unpin allowed) is NOT guarded — pin still works on a meridian conversation", async () => {
    const svc = createChatService({ prisma: buildMeridianPrisma() });
    const res = await svc.pinConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, pinned: false });
    assert.deepEqual(res, { ok: true, pinned: false });
  });
});
