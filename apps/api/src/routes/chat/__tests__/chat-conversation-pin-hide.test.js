// apps/api/src/routes/chat/__tests__/chat-conversation-pin-hide.test.js
//
// Plan A coverage for 2026-09-07-chat-conversation-gestures:
// per-member pin (top of list) and hide ("Eliminar chat", direct only,
// resurfaced by a new message). Verifies the read query gains the hidden
// filter + pin-first ordering, and that pin/hide write the right rows and
// reject the wrong conversation types.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createChatService,
  ChatServiceError,
  _resetProfileIdCacheForTests,
} from "../chat-service.js";

const AUTH_USER_ID = "auth-user-1";
const PROFILE_ID = "01900000-0000-7000-8000-0000000000p1";
const CONV_ID = "01900000-0000-7000-8000-0000000000c1";

// Flattens a tagged-template call into readable SQL, recursively inlining any
// nested Prisma.sql / Prisma.empty fragments (which arrive as interpolated
// values, not as part of `strings`).
function sqlText(strings, values) {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v && Array.isArray(v.strings)) out += sqlText(v.strings, v.values ?? []);
    else out += "?";
    out += strings[i + 1] ?? "";
  }
  return out;
}

// Ordered-queue stub. $queryRaw answers are dequeued in call order; every
// $executeRaw call is recorded as { sql, values } for assertions.
function buildPrisma(queryRawResults = []) {
  let qIdx = 0;
  const executes = [];
  // archiveConversation/hideConversation now run a bare
  // `SELECT type FROM chat_conversations WHERE id = ? LIMIT 1` guard probe
  // (assertNotMirai) — identical to the type lookup hideConversation
  // already does. Answer both from the same queued row (consumed once, then
  // cached); synthesize a non-mirai answer when none is queued.
  let convTypeAnswer;
  const isConvTypeProbe = (strings) =>
    /SELECT\s+type\s+FROM\s+chat_conversations/i.test(
      Array.isArray(strings) ? strings.join("?") : String(strings ?? ""),
    );
  const looksLikeTypeRow = (v) =>
    Array.isArray(v) &&
    (v.length === 0 ||
      (v[0] && typeof v[0] === "object" && Object.prototype.hasOwnProperty.call(v[0], "type")));
  return {
    executes,
    $queryRaw: async (strings) => {
      if (isConvTypeProbe(strings)) {
        if (convTypeAnswer !== undefined) return convTypeAnswer;
        convTypeAnswer = looksLikeTypeRow(queryRawResults[qIdx])
          ? queryRawResults[qIdx++]
          : [{ type: "__nonmirai__" }];
        return convTypeAnswer;
      }
      if (qIdx >= queryRawResults.length) throw new Error(`Unexpected $queryRaw call #${qIdx + 1}`);
      return queryRawResults[qIdx++];
    },
    $executeRaw: async (strings, ...values) => {
      executes.push({ sql: sqlText(strings, values), values });
      return 1;
    },
    membership: { findFirst: async () => null, findMany: async () => [] },
  };
}

describe("chat pinConversation", () => {
  it("pin=true writes a Date into pinned_at for the caller's member row", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([[{ id: PROFILE_ID }]]);
    const svc = createChatService({ prisma });

    const res = await svc.pinConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, pinned: true });

    assert.deepEqual(res, { ok: true, pinned: true });
    assert.equal(prisma.executes.length, 1);
    const { sql, values } = prisma.executes[0];
    assert.match(sql, /UPDATE chat_conversation_members/);
    assert.match(sql, /SET pinned_at =/);
    assert.ok(values[0] instanceof Date, "pinned_at should be a Date");
    assert.equal(values[1], CONV_ID);
    assert.equal(values[2], PROFILE_ID);
  });

  it("pin=false clears pinned_at (null)", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([[{ id: PROFILE_ID }]]);
    const svc = createChatService({ prisma });

    const res = await svc.pinConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, pinned: false });

    assert.deepEqual(res, { ok: true, pinned: false });
    assert.equal(prisma.executes[0].values[0], null);
  });
});

describe("chat hideConversation", () => {
  it("hides a direct conversation for the caller", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([
      [{ id: PROFILE_ID }],       // resolveUserProfileId
      [{ type: "direct" }],       // SELECT type
    ]);
    const svc = createChatService({ prisma });

    const res = await svc.hideConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });

    assert.deepEqual(res, { ok: true });
    assert.equal(prisma.executes.length, 1);
    assert.match(prisma.executes[0].sql, /SET\s+hidden_at = NOW\(\)/);
    assert.equal(prisma.executes[0].values[0], CONV_ID);
    assert.equal(prisma.executes[0].values[1], PROFILE_ID);
  });

  it("rejects a channel with 400 and writes nothing", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([
      [{ id: PROFILE_ID }],
      [{ type: "channel" }],
    ]);
    const svc = createChatService({ prisma });

    await assert.rejects(
      () => svc.hideConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 400,
    );
    assert.equal(prisma.executes.length, 0);
  });

  it("rejects a missing conversation with 404", async () => {
    _resetProfileIdCacheForTests();
    const prisma = buildPrisma([[{ id: PROFILE_ID }], []]);
    const svc = createChatService({ prisma });

    await assert.rejects(
      () => svc.hideConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
  });
});

describe("chat listConversations — pin/hide query shape", () => {
  it("active list filters hidden rows and orders pinned first", async () => {
    _resetProfileIdCacheForTests();
    const captured = [];
    const prisma = {
      $queryRaw: async (strings, ...values) => {
        captured.push(sqlText(strings, values));
        return captured.length === 1 ? [{ id: PROFILE_ID }] : [];
      },
      $executeRaw: async () => 1,
      membership: { findFirst: async () => null, findMany: async () => [] },
    };
    const svc = createChatService({ prisma });

    await svc.listConversations({ authUserId: AUTH_USER_ID, archived: false });

    const mainQuery = captured[1];
    assert.match(mainQuery, /ccm\.hidden_at IS NULL/);
    assert.match(mainQuery, /ORDER BY \(ccm\.pinned_at IS NOT NULL\) DESC, ccm\.pinned_at DESC/);
    assert.match(mainQuery, /ccm\.pinned_at IS NOT NULL AS is_pinned/);
  });

  it("archived list does NOT apply the hidden filter", async () => {
    _resetProfileIdCacheForTests();
    const captured = [];
    const prisma = {
      $queryRaw: async (strings, ...values) => {
        captured.push(sqlText(strings, values));
        return captured.length === 1 ? [{ id: PROFILE_ID }] : [];
      },
      $executeRaw: async () => 1,
      membership: { findFirst: async () => null, findMany: async () => [] },
    };
    const svc = createChatService({ prisma });

    await svc.listConversations({ authUserId: AUTH_USER_ID, archived: true });

    assert.doesNotMatch(captured[1], /ccm\.hidden_at IS NULL/);
  });
});
