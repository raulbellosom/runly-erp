// apps/api/src/routes/chat/__tests__/chat-tenant.test.js
//
// Tenant-safety coverage for atlas.chat (2026-08-30 audit): createConversation
// and addMembers previously inserted a client-supplied user_profile id into
// chat_conversation_members with zero validation that the id belonged to the
// caller's company — a caller could add an arbitrary user from another
// company to a private direct/group/channel conversation. Fixed with a
// filterCompanyPeers() guard (same pattern as calendar-event-service.js's
// attendee guard). These tests prove the guard actually rejects a
// foreign-company id, and that it runs even when a permissionsService grant
// would otherwise allow the call.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createChatService, ChatServiceError, _resetProfileIdCacheForTests } from "../chat-service.js";

const AUTH_USER_ID = "auth-user-1";
const PROFILE_ID = "01900000-0000-7000-8000-0000000000p1";
const FOREIGN_PROFILE_ID = "01900000-0000-7000-8000-0000000000f1";
const CONV_ID = "01900000-0000-7000-8000-0000000000c1";
const COMPANY_A = "01900000-0000-7000-8000-000000000ca";
const COMPANY_B = "01900000-0000-7000-8000-000000000cb";

// Ordered-queue $queryRaw/$executeRaw stub, plus a membership.findMany that
// answers from a fixed { userId -> companyId } map — PROFILE_ID is always in
// COMPANY_A, FOREIGN_PROFILE_ID is always in COMPANY_B (a different company).
function buildPrisma(queryRawResults = []) {
  let qIdx = 0;
  const membershipByUser = { [PROFILE_ID]: COMPANY_A, [FOREIGN_PROFILE_ID]: COMPANY_B };
  // addMembers now runs a bare `SELECT type FROM chat_conversations WHERE
  // id = ? LIMIT 1` guard probe (assertNotMirai) right after assertMember,
  // before filterCompanyPeers. Answer it from a queued type row (consumed once,
  // then cached) or synthesize a non-mirai answer without disturbing the
  // fixed-sequence queue.
  let convTypeAnswer;
  const isConvTypeProbe = (strings) =>
    /SELECT\s+type\s+FROM\s+chat_conversations/i.test(
      Array.isArray(strings) ? strings.join("?") : String(strings ?? ""),
    );
  const looksLikeTypeRow = (v) =>
    Array.isArray(v) &&
    (v.length === 0 ||
      (v[0] && typeof v[0] === "object" && Object.prototype.hasOwnProperty.call(v[0], "type")));
  // addMembers also now probes the conversation's own company_id to scope
  // filterCompanyPeers to that one company (rather than the caller's full
  // membership union). Every test conversation here belongs to COMPANY_A —
  // answered out-of-band, same as the type probe, so it never disturbs the
  // fixed-sequence queue.
  const isConvCompanyProbe = (strings) =>
    /SELECT\s+company_id\s+AS\s+"companyId"\s+FROM\s+chat_conversations/i.test(
      Array.isArray(strings) ? strings.join("?") : String(strings ?? ""),
    );
  return {
    $queryRaw: async (strings) => {
      if (isConvTypeProbe(strings)) {
        if (convTypeAnswer !== undefined) return convTypeAnswer;
        convTypeAnswer = looksLikeTypeRow(queryRawResults[qIdx])
          ? queryRawResults[qIdx++]
          : [{ type: "__nonmirai__" }];
        return convTypeAnswer;
      }
      if (isConvCompanyProbe(strings)) {
        return [{ companyId: COMPANY_A }];
      }
      if (qIdx >= queryRawResults.length) throw new Error(`Unexpected $queryRaw call #${qIdx + 1}`);
      return queryRawResults[qIdx++];
    },
    $executeRaw: async () => {
      throw new Error("Unexpected $executeRaw call — guard should reject before any write");
    },
    membership: {
      findFirst: async () => null,
      findMany: async ({ where }) => {
        const raw = where?.userId;
        const ids = typeof raw === "string" ? [raw] : (raw?.in ?? []);
        const allowedCompanyIds = where?.companyId?.in ?? null;
        return ids
          .filter((id) => membershipByUser[id])
          .filter((id) => !allowedCompanyIds || allowedCompanyIds.includes(membershipByUser[id]))
          .map((userId) => ({ userId, companyId: membershipByUser[userId] }));
      },
    },
  };
}

describe("chat-service — cross-tenant member guard", () => {
  it("createConversation (group) rejects a memberUserId from another company with 403, before any write", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([[{ id: PROFILE_ID }]]); // resolveUserProfileId only
    const svc = createChatService({ prisma });
    await assert.rejects(
      () =>
        svc.createConversation({
          authUserId: AUTH_USER_ID,
          type: "group",
          title: "Grupo",
          memberUserIds: [FOREIGN_PROFILE_ID],
        }),
      (err) => err instanceof ChatServiceError && err.status === 403,
    );
  });

  it("createConversation (direct) rejects a memberUserId from another company with 403", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([[{ id: PROFILE_ID }]]);
    const svc = createChatService({ prisma });
    await assert.rejects(
      () =>
        svc.createConversation({
          authUserId: AUTH_USER_ID,
          type: "direct",
          memberUserIds: [FOREIGN_PROFILE_ID],
        }),
      (err) => err instanceof ChatServiceError && err.status === 403,
    );
  });

  it("addMembers rejects a foreign-company userId with 403 when no permissionsService is wired", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember: caller is a member of CONV_ID
    ]);
    const svc = createChatService({ prisma });
    await assert.rejects(
      () =>
        svc.addMembers({
          conversationId: CONV_ID,
          authUserId: AUTH_USER_ID,
          userIds: [FOREIGN_PROFILE_ID],
        }),
      (err) => err instanceof ChatServiceError && err.status === 403,
    );
  });

  it("addMembers: a company-less platform admin can add a member of the conversation's own company", async () => {
    _resetProfileIdCacheForTests();
    // ADMIN_PROFILE_ID is absent from membershipByUser -> no company membership.
    // PROFILE_ID belongs to COMPANY_A, the conversation's own company (per the
    // isConvCompanyProbe stub), so this is a legitimate same-company add.
    const ADMIN_PROFILE_ID = "01900000-0000-7000-8000-0000000000ad";
    const prisma = buildPrisma([
      [{ id: ADMIN_PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember
      [{ type: "group" }], // conversation type lookup
    ]);
    const permissionsService = { assertChannelPermission: async () => {} };
    const svc = createChatService({ prisma, permissionsService });
    // The guard no longer throws 403; execution reaches the insert loop, where
    // the stubbed $executeRaw throws its own "Unexpected" error. Any error that
    // is NOT a 403 ChatServiceError proves the company guard let the call
    // through.
    await assert.rejects(
      () =>
        svc.addMembers({
          conversationId: CONV_ID,
          authUserId: AUTH_USER_ID,
          userIds: [PROFILE_ID],
        }),
      (err) => !(err instanceof ChatServiceError && err.status === 403),
    );
  });

  it("addMembers: a company-less platform admin is still rejected for a user outside the conversation's own company", async () => {
    _resetProfileIdCacheForTests();
    // Tightened behavior: a company-less admin's broader instance-wide reach
    // does not extend to adding a peer from a DIFFERENT company than the
    // conversation itself belongs to (COMPANY_A) — otherwise a system admin
    // managing one company's channel could smuggle in any user from any other
    // company, which is exactly the cross-tenant leak this guard exists to stop.
    const ADMIN_PROFILE_ID = "01900000-0000-7000-8000-0000000000ad";
    const prisma = buildPrisma([
      [{ id: ADMIN_PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember
      [{ type: "group" }], // conversation type lookup
    ]);
    const permissionsService = { assertChannelPermission: async () => {} };
    const svc = createChatService({ prisma, permissionsService });
    await assert.rejects(
      () =>
        svc.addMembers({
          conversationId: CONV_ID,
          authUserId: AUTH_USER_ID,
          userIds: [FOREIGN_PROFILE_ID],
        }),
      (err) => err instanceof ChatServiceError && err.status === 403,
    );
  });

  it("addMembers rejects a foreign-company userId even after assertChannelPermission grants the action", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember
      [{ type: "group" }], // conversation type lookup for the permission check
    ]);
    const permissionsService = {
      assertChannelPermission: async () => {}, // grants members.manage
    };
    const svc = createChatService({ prisma, permissionsService });
    await assert.rejects(
      () =>
        svc.addMembers({
          conversationId: CONV_ID,
          authUserId: AUTH_USER_ID,
          userIds: [FOREIGN_PROFILE_ID],
        }),
      (err) => err instanceof ChatServiceError && err.status === 403,
    );
  });
});
