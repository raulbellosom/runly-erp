import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createChatModerationService,
  ChatModerationServiceError,
} from "../chat-moderation-service.js";
import { _resetProfileIdCacheForTests } from "../chat-service.js";

const AUTH_USER_ID = "auth-user-1";
const PROFILE_ID = "01900000-0000-7000-8000-0000000000p1";
const OTHER_PROFILE_ID = "01900000-0000-7000-8000-0000000000p2";
const CONV_ID = "01900000-0000-7000-8000-0000000000c1";

beforeEach(() => {
  _resetProfileIdCacheForTests();
});

function buildPrismaMock(queryRawResults = [], executeRawResults = []) {
  let qIdx = 0;
  let eIdx = 0;
  const client = {
    _executeRawCallCount: 0,
    _transactionCallCount: 0,
    $queryRaw: async () => {
      if (qIdx >= queryRawResults.length) throw new Error(`Unexpected $queryRaw call #${qIdx + 1}`);
      return queryRawResults[qIdx++];
    },
    $executeRaw: async () => {
      client._executeRawCallCount++;
      return executeRawResults[eIdx++] ?? { count: 1 };
    },
    $transaction: async (fn) => {
      client._transactionCallCount++;
      return fn(client);
    },
    // Default: target user has no protected role, so the disable_user path's
    // hasProtectedIdentityAdminRole guard doesn't fire unless a test overrides it.
    userProfile: {
      findUnique: async () => ({ memberships: [] }),
    },
  };
  return client;
}

describe("chat-moderation-service — muteConversation", () => {
  it("sets muted_at when muted:true and the caller is a member", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.muteConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, muted: true });
    assert.deepEqual(result, { conversationId: CONV_ID, muted: true });
    assert.equal(prisma._executeRawCallCount, 1);
  });

  it("clears muted_at when muted:false", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.muteConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, muted: false });
    assert.deepEqual(result, { conversationId: CONV_ID, muted: false });
  });
});

describe("chat-moderation-service — block/unblock", () => {
  it("blockUser rejects blocking yourself", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId for caller
    ]);
    const service = createChatModerationService({ prisma });
    await assert.rejects(
      () => service.blockUser({ authUserId: AUTH_USER_ID, targetUserId: PROFILE_ID }),
      (err) => err instanceof ChatModerationServiceError && err.status === 400,
    );
  });

  it("blockUser inserts a chat_blocks row for a different user", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.blockUser({ authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID });
    assert.deepEqual(result, { blocked: true });
    assert.equal(prisma._executeRawCallCount, 1);
  });

  it("unblockUser deletes the matching chat_blocks row", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.unblockUser({ authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID });
    assert.deepEqual(result, { blocked: false });
    assert.equal(prisma._executeRawCallCount, 1);
  });

  it("getBlockStatus reports both directions", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ blocker_user_id: PROFILE_ID, blocked_user_id: OTHER_PROFILE_ID }], // blockedByMe row exists
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.getBlockStatus({ authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID });
    assert.deepEqual(result, { blockedByMe: true, blockedByThem: false });
  });
});

describe("chat-moderation-service — getGroupsInCommon", () => {
  it("returns group/channel conversations shared by both users", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: CONV_ID, type: "group", title: "Proyecto X", avatar_url: null, avatar_emoji: null }],
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.getGroupsInCommon({ authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID });
    assert.equal(result.length, 1);
    assert.equal(result[0].id, CONV_ID);
  });
});

describe("chat-moderation-service — reports", () => {
  it("createReport rejects reporting yourself", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
    ]);
    const service = createChatModerationService({ prisma });
    await assert.rejects(
      () => service.createReport({ authUserId: AUTH_USER_ID, reportedUserId: PROFILE_ID, reason: "spam" }),
      (err) => err instanceof ChatModerationServiceError && err.status === 400,
    );
  });

  it("createReport inserts a row and optionally blocks", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: "report-1", status: "open" }], // INSERT ... RETURNING
    ], [
      { count: 1 }, // block insert (alsoBlock: true)
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.createReport({
      authUserId: AUTH_USER_ID,
      reportedUserId: OTHER_PROFILE_ID,
      conversationId: CONV_ID,
      reason: "abuse",
      note: "Mensajes ofensivos",
      alsoBlock: true,
    });
    assert.deepEqual(result, { id: "report-1", status: "open" });
    assert.equal(prisma._executeRawCallCount, 1);
  });

  it("listReports returns rows with joined display names", async () => {
    const prisma = buildPrismaMock([
      [{
        id: "report-1",
        reporter_user_id: PROFILE_ID,
        reporter_display_name: "Ana",
        reported_user_id: OTHER_PROFILE_ID,
        reported_display_name: "Beto",
        conversation_id: CONV_ID,
        reason: "spam",
        note: null,
        status: "open",
        reviewed_by_user_id: null,
        reviewed_at: null,
        created_at: new Date("2026-08-26T00:00:00Z"),
      }],
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.listReports({ status: "open" });
    assert.equal(result.length, 1);
    assert.equal(result[0].reporterDisplayName, "Ana");
    assert.equal(result[0].reportedDisplayName, "Beto");
  });

  it("resolveReport with action:dismiss updates status only", async () => {
    const prisma = buildPrismaMock([
      [{ id: "report-1", reported_user_id: OTHER_PROFILE_ID, status: "open" }], // fetch report
      [{ id: PROFILE_ID }], // resolveUserProfileId for reviewer
    ], [
      { count: 1 }, // UPDATE chat_reports
    ]);
    const service = createChatModerationService({ prisma });
    const result = await service.resolveReport({ reportId: "report-1", authUserId: AUTH_USER_ID, action: "dismiss" });
    assert.deepEqual(result, { id: "report-1", status: "dismissed" });
    assert.equal(prisma._executeRawCallCount, 1);
  });

  it("resolveReport with action:disable_user updates status AND disables the user", async () => {
    const prisma = buildPrismaMock([
      [{ id: "report-1", reported_user_id: OTHER_PROFILE_ID, status: "open" }], // fetch report
      [{ id: PROFILE_ID }], // resolveUserProfileId for reviewer
    ], [
      { count: 1 }, // UPDATE user_profile SET enabled = false
      { count: 1 }, // UPDATE chat_reports
    ]);
    // Target user has no protected role — the disable_user path should proceed normally.
    prisma.userProfile.findUnique = async () => ({
      memberships: [{ enabled: true, role: { key: "member" } }],
    });
    const service = createChatModerationService({ prisma });
    const result = await service.resolveReport({ reportId: "report-1", authUserId: AUTH_USER_ID, action: "disable_user" });
    assert.deepEqual(result, { id: "report-1", status: "user_disabled" });
    assert.equal(prisma._executeRawCallCount, 2);
    assert.equal(prisma._transactionCallCount, 1);
  });

  it("resolveReport rejects disabling a user with a protected Atlas Admin / System Admin role", async () => {
    const prisma = buildPrismaMock([
      [{ id: "report-1", reported_user_id: OTHER_PROFILE_ID, status: "open" }], // fetch report
      [{ id: PROFILE_ID }], // resolveUserProfileId for reviewer
    ]);
    prisma.userProfile.findUnique = async () => ({
      memberships: [{ enabled: true, role: { key: "runly.admin" } }],
    });
    const service = createChatModerationService({ prisma });
    await assert.rejects(
      () => service.resolveReport({ reportId: "report-1", authUserId: AUTH_USER_ID, action: "disable_user" }),
      (err) => err instanceof ChatModerationServiceError && err.status === 400,
    );
    assert.equal(prisma._executeRawCallCount, 0);
    assert.equal(prisma._transactionCallCount, 0);
  });

  it("resolveReport rejects an unrecognized action", async () => {
    const prisma = buildPrismaMock([]);
    const service = createChatModerationService({ prisma });
    await assert.rejects(
      () => service.resolveReport({ reportId: "report-1", authUserId: AUTH_USER_ID, action: "delete_everything" }),
      (err) => err instanceof ChatModerationServiceError && err.status === 400,
    );
  });

  it("resolveReport rejects an already-resolved report", async () => {
    const prisma = buildPrismaMock([
      [{ id: "report-1", reported_user_id: OTHER_PROFILE_ID, status: "dismissed" }],
    ]);
    const service = createChatModerationService({ prisma });
    await assert.rejects(
      () => service.resolveReport({ reportId: "report-1", authUserId: AUTH_USER_ID, action: "dismiss" }),
      (err) => err instanceof ChatModerationServiceError && err.status === 400,
    );
  });

  it("resolveReport rejects action:disable_user against an already-resolved report", async () => {
    const prisma = buildPrismaMock([
      [{ id: "report-1", reported_user_id: OTHER_PROFILE_ID, status: "dismissed" }],
    ]);
    const service = createChatModerationService({ prisma });
    await assert.rejects(
      () => service.resolveReport({ reportId: "report-1", authUserId: AUTH_USER_ID, action: "disable_user" }),
      (err) => err instanceof ChatModerationServiceError && err.status === 400,
    );
  });
});
