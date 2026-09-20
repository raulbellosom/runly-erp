import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createChatMentionsService,
  EVERYONE_MENTION_ID,
  HERE_MENTION_ID,
} from "../chat-mentions-service.js";

// NOTE: mention-utils.js's parseMentionIds regex is `[a-f0-9-]{36}` — strictly
// hex digits and dashes. Fixture IDs must stay within that character set (no
// 'p'/'r'/'s'/etc suffixes) or the tokens below silently fail to parse.
const CONV_ID = "01900000-0000-7000-8000-0000000000c1";
const SENDER_ID = "01900000-0000-7000-8000-0000000000a1";
const USER_A = "01900000-0000-7000-8000-0000000000a2";
const USER_B = "01900000-0000-7000-8000-0000000000a3";
const ROLE_ID = "01900000-0000-7000-8000-0000000000e1";

function buildPrismaMock(queryRawResults) {
  let qIdx = 0;
  return {
    $queryRaw: async () => {
      if (qIdx >= queryRawResults.length) throw new Error(`Unexpected $queryRaw call #${qIdx + 1}`);
      return queryRawResults[qIdx++];
    },
  };
}

describe("chat-mentions-service — resolveMentions", () => {
  it('rejects an unknown or unauthorized mention instead of storing its claimed identity', async () => {
    const svc = createChatMentionsService({ prisma: buildPrismaMock([[], []]) });
    await assert.rejects(svc.resolveMentions({ conversationId: CONV_ID, senderProfileId: SENDER_ID, body: `@[${USER_A}:Foreign]`, senderRole: null }), { status: 404 });
  });
  it("returns an empty result when the body has no mention tokens", async () => {
    const prisma = buildPrismaMock([]);
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID, body: "hola equipo", senderRole: null,
    });
    assert.deepEqual(result, { userIds: [], roleIds: [], everyone: false, here: false, notifyUserIds: [] });
  });

  it("resolves a direct @user mention to an active member, excluding the sender", async () => {
    const prisma = buildPrismaMock([
      [{ user_id: USER_A }], // active-member check for candidateIds
      [], // role check for candidateIds (none match)
    ]);
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `hola @[${USER_A}:Ada]`, senderRole: null,
    });
    assert.deepEqual(result.userIds, [USER_A]);
    assert.deepEqual(result.notifyUserIds, [USER_A]);
  });

  it("does not resolve a mention of the sender's own id (composer already excludes self, but defend anyway)", async () => {
    const prisma = buildPrismaMock([
      [{ user_id: SENDER_ID }],
      [],
    ]);
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `@[${SENDER_ID}:Me]`, senderRole: null,
    });
    assert.deepEqual(result.userIds, []);
    assert.deepEqual(result.notifyUserIds, []);
  });

  it("resolves a @role mention to all active holders of that role, excluding the sender", async () => {
    const prisma = buildPrismaMock([
      [], // no candidateIds match as active members
      [{ id: ROLE_ID }], // candidateIds match a role
      [{ user_id: USER_A }, { user_id: USER_B }], // role holders
    ]);
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `@[${ROLE_ID}:Moderators]`, senderRole: null,
    });
    assert.deepEqual(result.roleIds, [ROLE_ID]);
    assert.deepEqual(new Set(result.notifyUserIds), new Set([USER_A, USER_B]));
  });

  it("drops @everyone from the resolved/notify set when the sender lacks mentions.everyone", async () => {
    const prisma = buildPrismaMock([]); // no candidateIds at all — pure @everyone token
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `@[${EVERYONE_MENTION_ID}:everyone]`,
      senderRole: { isSystem: false, permissions: {} },
    });
    assert.equal(result.everyone, false);
    assert.deepEqual(result.notifyUserIds, []);
  });

  it("expands @everyone to all other active members when the sender has mentions.everyone", async () => {
    const prisma = buildPrismaMock([
      [{ user_id: USER_A }, { user_id: USER_B }], // all-active-members query
    ]);
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `@[${EVERYONE_MENTION_ID}:everyone]`,
      senderRole: { isSystem: false, permissions: { "mentions.everyone": true } },
    });
    assert.equal(result.everyone, true);
    assert.deepEqual(new Set(result.notifyUserIds), new Set([USER_A, USER_B]));
  });

  it("grants everyone/here to a system (Owner) role regardless of its permissions object", async () => {
    const prisma = buildPrismaMock([
      [{ user_id: USER_A }],
    ]);
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `@[${HERE_MENTION_ID}:here]`,
      senderRole: { isSystem: true, permissions: {} },
    });
    assert.equal(result.here, true);
    assert.deepEqual(result.notifyUserIds, [USER_A]);
  });

  it("deduplicates a recipient mentioned both directly and via @everyone", async () => {
    const prisma = buildPrismaMock([
      [{ user_id: USER_A }], // direct @user match
      [], // no role match
      [{ user_id: USER_A }, { user_id: USER_B }], // everyone expansion (includes USER_A again)
    ]);
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `@[${USER_A}:Ada] @[${EVERYONE_MENTION_ID}:everyone]`,
      senderRole: { isSystem: false, permissions: { "mentions.everyone": true } },
    });
    assert.equal(result.notifyUserIds.length, 2);
    assert.deepEqual(new Set(result.notifyUserIds), new Set([USER_A, USER_B]));
  });

  it("handles @everyone and @here together, granting only the one the sender actually has", async () => {
    const prisma = buildPrismaMock([
      [{ user_id: USER_A }, { user_id: USER_B }], // single "all active members" query — fires once for (everyone || here)
    ]);
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `@[${EVERYONE_MENTION_ID}:everyone] @[${HERE_MENTION_ID}:here]`,
      senderRole: { isSystem: false, permissions: { "mentions.here": true } },
    });
    assert.equal(result.everyone, false);
    assert.equal(result.here, true);
    assert.deepEqual(new Set(result.notifyUserIds), new Set([USER_A, USER_B]));
  });

  it("does not confuse an unrelated granted permission (roles.manage) with mentions.everyone", async () => {
    const prisma = buildPrismaMock([]); // pure @everyone token, no candidateIds, and permission check fails before any query
    const svc = createChatMentionsService({ prisma });
    const result = await svc.resolveMentions({
      conversationId: CONV_ID, senderProfileId: SENDER_ID,
      body: `@[${EVERYONE_MENTION_ID}:everyone]`,
      senderRole: { isSystem: false, permissions: { "roles.manage": true, "members.manage": true } },
    });
    assert.equal(result.everyone, false);
    assert.deepEqual(result.notifyUserIds, []);
  });
});
