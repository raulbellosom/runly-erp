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
const MOCK_COMPANY_ID = "01900000-0000-7000-8000-0000000000c0";

beforeEach(() => {
  _resetProfileIdCacheForTests();
});

// Mirrors the buildPrismaMock convention used in chat-permissions-service.test.js
// and channel-directory-service.test.js: a fixed-sequence array of results consumed
// in call order for $queryRaw / $executeRaw, plus a $transaction that shares the
// same counters (so calls inside the callback consume from the same arrays) and
// a _transactionCallCount so a test can prove the wrapper wasn't silently dropped.
// _executeRawCallCount mirrors that same convention for $executeRaw, so a test can
// prove exactly how many UPDATE/etc. statements actually ran (e.g. both the
// soft-delete UPDATE and the thread counter-decrement UPDATE) instead of a
// vacuous assertion that would pass regardless.
function buildPrismaMock(queryRawResults = [], executeRawResults = []) {
  let qIdx = 0;
  let profileAnswer;
  let eIdx = 0;
  // Every guarded conversation mutation now issues a bare
  // `SELECT type FROM chat_conversations WHERE id = ? LIMIT 1` probe
  // (assertNotMirai) — byte-identical to the permission-check type probe
  // some of these fixtures already queue a `[{ type: "channel" }]` row for.
  // Answer both from the SAME queued row (consumed once, then cached), and
  // when no type row is queued at all, synthesize a non-mirai answer
  // without disturbing the fixed-sequence queue.
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
  // filterCompanyPeers to that one company. Every fixture conversation here
  // belongs to MOCK_COMPANY_ID (matching the membership.findMany default
  // above) — answered out-of-band, same as the type probe, so it never
  // disturbs the fixed-sequence queue.
  const isConvCompanyProbe = (strings) =>
    /SELECT\s+company_id\s+AS\s+"companyId"\s+FROM\s+chat_conversations/i.test(
      Array.isArray(strings) ? strings.join("?") : String(strings ?? ""),
    );
  const client = {
    _transactionCallCount: 0,
    _executeRawCallCount: 0,
    $queryRaw: async (strings) => {
      if (/SELECT id FROM user_profile WHERE auth_user_id/.test(strings.join('?'))) {
        if (!profileAnswer) profileAnswer = queryRawResults[qIdx++];
        return profileAnswer;
      }
      if (isConvTypeProbe(strings)) {
        if (convTypeAnswer !== undefined) return convTypeAnswer;
        convTypeAnswer = looksLikeTypeRow(queryRawResults[qIdx])
          ? queryRawResults[qIdx++]
          : [{ type: "__nonmirai__" }];
        return convTypeAnswer;
      }
      if (isConvCompanyProbe(strings)) {
        return [{ companyId: MOCK_COMPANY_ID }];
      }
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
    membership: {
      findFirst: async () => ({ companyId: MOCK_COMPANY_ID, role: { key: 'runly.admin' } }),
      // Default fixture: PROFILE_ID and OTHER_PROFILE_ID are colleagues in the
      // same company, so filterCompanyPeers' cross-tenant guard (used by
      // createConversation/addMembers) doesn't reject the ids most tests
      // exercise. A test that needs a genuine cross-company rejection can
      // override this per-call.
      findMany: async ({ where } = {}) => {
        const raw = where?.userId;
        const ids = typeof raw === "string" ? [raw] : (raw?.in ?? []);
        const known = new Set([PROFILE_ID, OTHER_PROFILE_ID]);
        return ids.filter((id) => known.has(id)).map((userId) => ({ userId, companyId: MOCK_COMPANY_ID }));
      },
    },
    // Default: no FileAsset rows found, so batchSignAvatarUrls (called whenever
    // a member/conversation avatar_file_id is truthy) resolves to an empty map
    // instead of crashing on `.findMany` being undefined. Tests that actually
    // need a resolved avatarUrl override this per-test.
    fileAsset: {
      findMany: async () => [],
    },
  };
  return client;
}

// Builds a minimal supabaseAdmin stub for batchSignAvatarUrls / signedUrlWithVariant:
// signedUrlByObjectKey maps objectKey -> signed URL string. Any objectKey not in the
// map resolves to a Supabase-style `{ data: null, error }` (signedUrlWithVariant then
// returns null, matching real "couldn't sign" behavior instead of throwing).
function buildSupabaseAdminMock(signedUrlByObjectKey = {}) {
  return {
    storage: {
      from: () => ({
        createSignedUrl: async (objectKey) => {
          const url = signedUrlByObjectKey[objectKey];
          return url ? { data: { signedUrl: url }, error: null } : { data: null, error: new Error("not found") };
        },
      }),
    },
  };
}

function throwingAssertChannelPermission() {
  throw new Error("assertChannelPermission should not have been called");
}

describe("chat-service — updateConversation permission enforcement", () => {
  it("channel: calls assertChannelPermission with channel.manage and propagates a 403 rejection", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember
      [{ type: "channel" }], // conversation type lookup
    ]);
    let calledWith = null;
    const permissionsService = {
      assertChannelPermission: async (convId, profileId, key) => {
        calledWith = { convId, profileId, key };
        const err = new Error("No tienes permiso para realizar esta accion.");
        err.status = 403;
        throw err;
      },
    };
    const svc = createChatService({ prisma, permissionsService });
    await assert.rejects(
      () => svc.updateConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { title: "New" } }),
      (err) => err.status === 403,
    );
    assert.deepEqual(calledWith, { convId: CONV_ID, profileId: PROFILE_ID, key: "channel.manage" });
  });

  it("channel: succeeds when assertChannelPermission resolves", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember (updateConversation)
      [{ type: "channel" }], // conversation type lookup
      [{ id: "member-row-2" }], // assertMember (inside the trailing getConversation call)
      [{ id: CONV_ID, title: "New", members: null }], // SELECT c.*, members inside getConversation
    ]);
    const permissionsService = {
      assertChannelPermission: async () => ({ position: 100, isSystem: true }),
    };
    const svc = createChatService({ prisma, permissionsService });
    const result = await svc.updateConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { title: "New" } });
    assert.equal(result.title, "New");
  });

  it("direct: never calls assertChannelPermission — behavior unaffected", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }], // assertMember (updateConversation)
      [{ type: "direct" }], // conversation type lookup
      [{ id: "member-row-2" }], // assertMember (inside the trailing getConversation call)
      [{ id: CONV_ID, title: "New", members: null }], // SELECT c.*, members inside getConversation
    ]);
    const permissionsService = { assertChannelPermission: throwingAssertChannelPermission };
    const svc = createChatService({ prisma, permissionsService });
    const result = await svc.updateConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { title: "New" } });
    assert.equal(result.title, "New");
  });

  it("no permissionsService supplied: behavior unchanged (no type lookup, no permission check)", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }], // assertMember (updateConversation)
      // no conversation-type lookup call expected — straight to the UPDATE + getConversation
      [{ id: "member-row-2" }], // assertMember (inside the trailing getConversation call)
      [{ id: CONV_ID, title: "New", members: null }], // SELECT c.*, members inside getConversation
    ]);
    const svc = createChatService({ prisma, permissionsService: null });
    const result = await svc.updateConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { title: "New" } });
    assert.equal(result.title, "New");
  });
});

describe("chat-service — updateConversation avatar mutual exclusion", () => {
  // Real call sequence (traced from the current source, not guessed): with a
  // permissionsService supplied, updateConversation issues exactly 3 of its
  // own $queryRaw calls (profile resolution, assertMember, conversation-type
  // lookup) before the UPDATE, then the trailing getConversation call issues
  // 2 more (assertMember again — profileId itself is cached per-authUserId
  // and NOT re-queried — plus the main SELECT). That's 5 $queryRaw results
  // total, matching buildPrismaMock's fixed-sequence contract used
  // throughout this file. A "channel" type is used so assertChannelPermission
  // is genuinely exercised (matching the realistic scenario — avatar changes
  // only make sense for channel/group conversations per spec Goal 2), not
  // skipped via an under-specified mock row.
  //
  // Prisma.join(sets, ", ") interpolated into another tagged template does
  // NOT flatten its own bound values into the outer $executeRaw call's
  // `values` array — verified empirically against this repo's real
  // @prisma/client (7.8.0): the joined fragment arrives as a single `_Sql`
  // object (capturedValues[0]) whose own `.values`/`.strings` hold the
  // per-column bindings. Assertions below inspect that nested object rather
  // than the outer `values` array directly.
  const permissionsServiceOk = { assertChannelPermission: async () => ({ position: 100, isSystem: true }) };

  it("setting avatarFileId clears any existing avatarEmoji in the same UPDATE", async () => {
    const fileId = "01900000-0000-7000-8000-00000000f001";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember (updateConversation)
      [{ type: "channel" }], // conversation type lookup
      [{ id: "member-row-2" }], // assertMember (inside the trailing getConversation call)
      [{ id: CONV_ID, avatar_file_id: fileId, avatar_emoji: null, members: null }], // SELECT c.*, members inside getConversation
    ]);
    let capturedValues = null;
    prisma.$executeRaw = async (strings, ...values) => { capturedValues = values; return { count: 1 }; };

    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService: permissionsServiceOk });
    await service.updateConversation({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { avatarFileId: fileId },
    });

    const setFragment = capturedValues[0];
    assert.ok(setFragment.values.includes(fileId), "avatar_file_id must be set to the new file id");
    assert.ok(setFragment.values.includes(null), "avatar_emoji must be cleared to null in the same statement");
  });

  it("setting avatarEmoji clears any existing avatarFileId", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "channel" }],
      [{ id: "member-row-2" }],
      [{ id: CONV_ID, avatar_file_id: null, avatar_emoji: "🚀", members: null }],
    ]);
    let capturedValues = null;
    prisma.$executeRaw = async (strings, ...values) => { capturedValues = values; return { count: 1 }; };

    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService: permissionsServiceOk });
    await service.updateConversation({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { avatarEmoji: "🚀" },
    });

    const setFragment = capturedValues[0];
    assert.ok(setFragment.values.includes("🚀"), "avatar_emoji must be set to the new emoji");
    assert.ok(setFragment.values.includes(null), "avatar_file_id must be cleared to null in the same statement");
  });

  it("explicitly clearing only avatarFileId (to null) does not touch avatarEmoji", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "channel" }],
      [{ id: "member-row-2" }],
      [{ id: CONV_ID, avatar_file_id: null, avatar_emoji: "🎉", members: null }],
    ]);
    let executeCallCount = 0;
    let capturedValues = null;
    prisma.$executeRaw = async (strings, ...values) => { executeCallCount++; capturedValues = values; return { count: 1 }; };

    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService: permissionsServiceOk });
    await service.updateConversation({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { avatarFileId: null },
    });

    assert.equal(executeCallCount, 1);
    const setFragment = capturedValues[0];
    // Real, non-vacuous check: the avatar_emoji SET fragment must be entirely
    // ABSENT from the generated SQL text (proving touchAvatarEmoji stayed
    // false), not merely bound to a null value — the "clear both" case would
    // also produce a bound null for avatar_emoji, so checking the value alone
    // wouldn't distinguish the two cases. Checking the fragment text itself
    // (nothing mentioning avatar_emoji) plus the exact bound-values list
    // (only avatar_file_id's null) makes this genuinely fail if the
    // implementation regresses to always touching both columns.
    assert.ok(
      !setFragment.strings.join("").includes("avatar_emoji"),
      "avatar_emoji must not appear in the UPDATE at all when only avatarFileId is explicitly cleared",
    );
    assert.deepEqual(setFragment.values, [null], "only avatar_file_id's cleared value should be bound");
  });

  it("setting description includes it in the UPDATE", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "channel" }],
      [{ id: "member-row-2" }],
      [{ id: CONV_ID, avatar_file_id: null, avatar_emoji: null, description: "Equipo de soporte", members: null }],
    ]);
    let capturedValues = null;
    prisma.$executeRaw = async (strings, ...values) => { capturedValues = values; return { count: 1 }; };

    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService: permissionsServiceOk });
    await service.updateConversation({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID, updates: { description: "Equipo de soporte" },
    });

    const setFragment = capturedValues[0];
    assert.ok(setFragment.strings.join("").includes("description"), "description must appear in the UPDATE");
    assert.ok(setFragment.values.includes("Equipo de soporte"), "description must be bound to the new value");
  });
});

describe("chat-service — addMembers permission enforcement", () => {
  it("group: calls assertChannelPermission with members.manage and propagates a 403 rejection", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "group" }],
    ]);
    let calledWith = null;
    const permissionsService = {
      assertChannelPermission: async (convId, profileId, key) => {
        calledWith = { convId, profileId, key };
        const err = new Error("No tienes permiso para realizar esta accion.");
        err.status = 403;
        throw err;
      },
    };
    const svc = createChatService({ prisma, permissionsService });
    await assert.rejects(
      () => svc.addMembers({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, userIds: [OTHER_PROFILE_ID] }),
      (err) => err.status === 403,
    );
    assert.deepEqual(calledWith, { convId: CONV_ID, profileId: PROFILE_ID, key: "members.manage" });
  });

  it("direct: never calls assertChannelPermission — behavior unaffected", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],
        [{ id: "member-row" }],
        [{ type: "direct" }],
        [{ display_name: "Other User" }], // newUser lookup inside the loop
      ],
      [],
    );
    const permissionsService = { assertChannelPermission: throwingAssertChannelPermission };
    const svc = createChatService({ prisma, permissionsService });
    const result = await svc.addMembers({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, userIds: [OTHER_PROFILE_ID] });
    assert.deepEqual(result, { added: [OTHER_PROFILE_ID] });
  });

  // Regression: the unique index on (conversation_id, user_id) is PARTIAL
  // (WHERE user_id IS NOT NULL AND left_at IS NULL). Postgres rejects a bare
  // `ON CONFLICT (conversation_id, user_id)` against it with 42P10, which
  // surfaced as a 500 on every "add member" call. The clause must repeat the
  // index predicate.
  it("membership upsert targets the partial unique index (ON CONFLICT carries its predicate)", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],
        [{ id: "member-row" }],
        [{ type: "channel" }],
        [{ display_name: "Other User" }],
      ],
      [],
    );
    const seen = [];
    prisma.$executeRaw = async (strings) => {
      seen.push(Array.isArray(strings) ? strings.join("?") : String(strings ?? ""));
      return { count: 1 };
    };
    const permissionsService = { assertChannelPermission: async () => ({ position: 100, isSystem: true }) };
    const svc = createChatService({ prisma, permissionsService });
    await svc.addMembers({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, userIds: [OTHER_PROFILE_ID] });

    const upsert = seen.find((sql) => /INSERT INTO chat_conversation_members/i.test(sql));
    assert.ok(upsert, "expected an INSERT INTO chat_conversation_members statement");
    assert.match(upsert, /ON CONFLICT \(conversation_id, user_id\)\s+WHERE\s+user_id IS NOT NULL AND left_at IS NULL/i);
  });
});

describe("chat-service — removeMember permission enforcement", () => {
  it("removing someone else in a group without members.manage propagates a 403", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "group" }],
    ]);
    const permissionsService = {
      isLastOwner: async () => false,
      assertChannelPermission: async () => {
        const err = new Error("No tienes permiso para realizar esta accion.");
        err.status = 403;
        throw err;
      },
      getMemberRole: async () => ({ position: 0 }),
    };
    const svc = createChatService({ prisma, permissionsService });
    await assert.rejects(
      () => svc.removeMember({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID }),
      (err) => err.status === 403,
    );
  });

  it("removing someone else ranked at or above the actor is rejected with the rank-specific 403", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "group" }],
    ]);
    const permissionsService = {
      isLastOwner: async () => false,
      assertChannelPermission: async () => ({ position: 75, isSystem: false }), // actor: Admin
      getMemberRole: async () => ({ position: 75 }), // target: also Admin (equal rank)
    };
    const svc = createChatService({ prisma, permissionsService });
    await assert.rejects(
      () => svc.removeMember({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID }),
      (err) => err instanceof ChatServiceError && err.status === 403 && /rango igual o mayor/.test(err.message),
    );
  });

  it("removing someone else ranked below the actor succeeds", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],
        [{ id: "member-row" }],
        [{ type: "group" }],
        [{ display_name: "Removed User" }], // removedUser lookup
      ],
      [],
    );
    const permissionsService = {
      isLastOwner: async () => false,
      assertChannelPermission: async () => ({ position: 75, isSystem: false }), // actor: Admin
      getMemberRole: async () => ({ position: 0 }), // target: Member (lower rank)
    };
    const svc = createChatService({ prisma, permissionsService });
    const result = await svc.removeMember({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID });
    assert.deepEqual(result, { ok: true });
  });

  it("self-removal (leaving) always succeeds regardless of rank and does not require members.manage", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],
        [{ id: "member-row" }],
        // NOTE: no conversation-type lookup, no assertChannelPermission call expected —
        // self-removal must skip that whole block. If it were called it would throw.
        [{ display_name: "Self User" }], // removedUser lookup
      ],
      [],
    );
    const permissionsService = {
      isLastOwner: async () => false,
      assertChannelPermission: throwingAssertChannelPermission,
      getMemberRole: throwingAssertChannelPermission,
    };
    const svc = createChatService({ prisma, permissionsService });
    // This is the test that would fail against the naive/buggy implementation
    // where self-removal was routed through the members.manage + hierarchy check.
    const result = await svc.removeMember({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, targetUserId: PROFILE_ID });
    assert.deepEqual(result, { ok: true });
  });

  it("the pre-existing last-Owner guard still fires and short-circuits before the new checks run", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      // no conversation-type lookup expected — isLastOwner throws before we get there
    ]);
    const permissionsService = {
      isLastOwner: async () => true,
      assertChannelPermission: throwingAssertChannelPermission,
      getMemberRole: throwingAssertChannelPermission,
    };
    const svc = createChatService({ prisma, permissionsService });
    await assert.rejects(
      () => svc.removeMember({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID }),
      (err) => err instanceof ChatServiceError && err.status === 400 && /unico Owner/.test(err.message),
    );
  });

  it("no permissionsService supplied: behavior unchanged (removal succeeds, no guards run)", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],
        [{ id: "member-row" }],
        [{ display_name: "Removed User" }],
      ],
      [],
    );
    const svc = createChatService({ prisma, permissionsService: null });
    const result = await svc.removeMember({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, targetUserId: OTHER_PROFILE_ID });
    assert.deepEqual(result, { ok: true });
  });
});

describe("chat-service — createConversation transactional role-seeding regression", () => {
  it("wraps role-seeding + owner/member role assignment in a single $transaction for a channel", async () => {
    const conv = { id: CONV_ID, type: "channel", title: "General" };
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }], // resolveUserProfileId (creator) — cached, so getConversation's later call reuses it
        [conv], // INSERT chat_conversations RETURNING
        [{ id: "member-row" }], // assertMember, inside the final getConversation call
        [{ id: conv.id, type: "channel", title: "General", members: null }], // SELECT c.*, members inside getConversation
      ],
      [
        { count: 1 }, // INSERT chat_conversation_members (creator, owner)
      ],
    );
    // seedDefaultRoles + isLastOwner not exercised directly here — only the
    // transaction wrapper itself is under test — so a minimal fake suffices.
    const permissionsService = {
      seedDefaultRoles: async (conversationId, tx) => {
        assert.ok(tx, "seedDefaultRoles must receive the tx client from inside $transaction");
        return { Owner: "role-owner", Member: "role-member" };
      },
    };
    const svc = createChatService({ prisma, permissionsService });
    await svc.createConversation({ companyId: MOCK_COMPANY_ID,
      authUserId: AUTH_USER_ID,
      type: "channel",
      title: "General",
      memberUserIds: [],
    });
    // Catches a regression that strips the $transaction wrapper back out — without
    // it, a crash between seeding roles and assigning the Owner role could leave
    // every member (including the creator) with role_id NULL and no reseed path.
    assert.equal(prisma._transactionCallCount, 1);
  });
});

describe("chat-service — sendMessage mentions", () => {
  // Must be valid hex ([a-f0-9-]{36}) — sendMessage now runs the real
  // parseMentionIds() as a cheap pre-check before ever calling the (fake, in
  // these tests) mentionsService, so a body's embedded token has to actually
  // match the real regex or the short-circuit skips mention resolution
  // entirely, same class of fixture bug already caught in chat-mentions-service.test.js.
  const MENTIONED_USER_ID = "01900000-0000-7000-8000-0000000000aa";

  it("stores metadata.mentions and fans out a chat.mention.new notification separate from chat.message.new", async () => {
    const publishedEvents = [];
    const notificationService = { publish: async (args) => { publishedEvents.push(args); } };
    const mentionsService = {
      resolveMentions: async () => ({ userIds: [MENTIONED_USER_ID], roleIds: [], everyone: false, here: false, notifyUserIds: [MENTIONED_USER_ID] }),
    };
    // assertChannelPermission stub added alongside getMemberRole: sendMessage now
    // calls it (messages.send enforcement) whenever permissionsService is truthy
    // and the conversation is a channel/group — these tests aren't exercising
    // that gate, so just let it pass through.
    const permissionsService = { getMemberRole: async () => null, assertChannelPermission: async () => ({}) };

    const body = `hola @[${MENTIONED_USER_ID}:X]`;
    const prisma = buildPrismaMock([
      [{ id: "sender-profile" }], // resolveUserProfileId
      [{ id: "m1" }],             // assertMember
      [{ type: "channel" }],      // assertNotBlocked: conversation type lookup — not direct, short-circuits
      [{ id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", created_at: new Date(), metadata: {} }], // INSERT ... RETURNING *
      [{                          // getMessageFull's internal query
        id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", sender_guest_id: null,
        sender_type: "user", body, message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null,
      }],
      [{ user_id: MENTIONED_USER_ID }, { user_id: "other-user" }], // otherMembers query inside the notification setImmediate block
      [], // resolveChatEmailRecipients — no recipient is "away", so no email fan-out
    ]);
    prisma.membership.findFirst = async () => ({ companyId: "company-1" });

    const service = createChatService({ prisma, supabaseAdmin: {}, notificationService, mentionsService, permissionsService, broadcaster: null });
    await service.sendMessage({ conversationId: "conv1", authUserId: "auth-1", body });

    // The notification dispatch runs inside a fire-and-forget setImmediate — flush it.
    await new Promise((resolve) => setImmediate(resolve));

    const mentionEvent = publishedEvents.find((e) => e.input.eventType === "chat.mention.new");
    const messageEvent = publishedEvents.find((e) => e.input.eventType === "chat.message.new");
    assert.ok(mentionEvent, "expected a chat.mention.new notification to be published");
    assert.deepEqual(mentionEvent.input.recipients.userIds, [MENTIONED_USER_ID]);
    assert.ok(messageEvent, "expected the generic chat.message.new notification to still fire for non-mentioned members");
    assert.deepEqual(messageEvent.input.recipients.userIds, ["other-user"]);
  });

  it("degrades to no-mentions instead of failing the send when mention resolution throws", async () => {
    const publishedEvents = [];
    const notificationService = { publish: async (args) => { publishedEvents.push(args); } };
    const mentionsService = {
      resolveMentions: async () => { throw new Error("invalid input syntax for type uuid"); },
    };
    // assertChannelPermission stub added alongside getMemberRole: sendMessage now
    // calls it (messages.send enforcement) whenever permissionsService is truthy
    // and the conversation is a channel/group — these tests aren't exercising
    // that gate, so just let it pass through.
    const permissionsService = { getMemberRole: async () => null, assertChannelPermission: async () => ({}) };

    const body = `hola @[${MENTIONED_USER_ID}:X]`;
    const prisma = buildPrismaMock([
      [{ id: "sender-profile" }],
      [{ id: "m1" }],
      [{ type: "channel" }], // assertNotBlocked: conversation type lookup — not direct, short-circuits
      [{ id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", created_at: new Date(), metadata: {} }],
      [{
        id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", sender_guest_id: null,
        sender_type: "user", body, message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null,
      }],
      [{ user_id: "other-user" }],
      [], // resolveChatEmailRecipients — no away recipients
    ]);
    prisma.membership.findFirst = async () => ({ companyId: "company-1" });

    const service = createChatService({ prisma, supabaseAdmin: {}, notificationService, mentionsService, permissionsService, broadcaster: null });
    const result = await service.sendMessage({ conversationId: "conv1", authUserId: "auth-1", body });
    assert.ok(result, "sendMessage must not throw when mention resolution fails");

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(publishedEvents.some((e) => e.input.eventType === "chat.mention.new"), false);
    assert.equal(publishedEvents.filter((e) => e.input.eventType === "chat.message.new").length, 1);
  });

  it("does not fan out chat.mention.new when resolveMentions finds nothing to notify", async () => {
    // Body deliberately DOES contain a real (valid-hex) mention token — e.g. a
    // member who has since left the conversation — so this test genuinely
    // exercises resolveMentions legitimately resolving to zero notifiable
    // recipients, rather than the parseMentionIds short-circuit skipping
    // resolveMentions entirely (which a token-free body like "hola equipo"
    // would trigger, silently no longer testing this scenario at all).
    const DEPARTED_USER_ID = "01900000-0000-7000-8000-0000000000bb";
    const publishedEvents = [];
    const notificationService = { publish: async (args) => { publishedEvents.push(args); } };
    const mentionsService = {
      resolveMentions: async () => ({ userIds: [], roleIds: [], everyone: false, here: false, notifyUserIds: [] }),
    };
    // assertChannelPermission stub added alongside getMemberRole: sendMessage now
    // calls it (messages.send enforcement) whenever permissionsService is truthy
    // and the conversation is a channel/group — these tests aren't exercising
    // that gate, so just let it pass through.
    const permissionsService = { getMemberRole: async () => null, assertChannelPermission: async () => ({}) };

    const body = `hola @[${DEPARTED_USER_ID}:ExMiembro]`;
    const prisma = buildPrismaMock([
      [{ id: "sender-profile" }],
      [{ id: "m1" }],
      [{ type: "channel" }], // assertNotBlocked: conversation type lookup — not direct, short-circuits
      [{ id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", created_at: new Date(), metadata: {} }],
      [{
        id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", sender_guest_id: null,
        sender_type: "user", body, message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null,
      }],
      [{ user_id: "other-user" }],
      [], // resolveChatEmailRecipients — no away recipients
    ]);
    prisma.membership.findFirst = async () => ({ companyId: "company-1" });

    const service = createChatService({ prisma, supabaseAdmin: {}, notificationService, mentionsService, permissionsService, broadcaster: null });
    await service.sendMessage({ conversationId: "conv1", authUserId: "auth-1", body });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(publishedEvents.some((e) => e.input.eventType === "chat.mention.new"), false);
    assert.equal(publishedEvents.filter((e) => e.input.eventType === "chat.message.new").length, 1);
  });

  it("strips @[uuid:Name] mention tokens from every notification preview and snippet", async () => {
    const publishedEvents = [];
    const notificationService = { publish: async (args) => { publishedEvents.push(args); } };
    const mentionsService = {
      resolveMentions: async () => ({ userIds: [MENTIONED_USER_ID], roleIds: [], everyone: false, here: false, notifyUserIds: [MENTIONED_USER_ID] }),
    };
    const permissionsService = { getMemberRole: async () => null, assertChannelPermission: async () => ({}) };

    // Two tokens: a normal mention and the all-zero MirAI sentinel id — the
    // latter is exactly what surfaced as "[0000..." in a PWA push.
    const body = `oye @[${MENTIONED_USER_ID}:Ana] avisale a @[00000000-0000-0000-0000-00000000b07a:MirAI] porfa`;
    const prisma = buildPrismaMock([
      [{ id: "sender-profile" }],
      [{ id: "m1" }],
      [{ type: "channel" }],
      [{ id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", created_at: new Date(), metadata: {} }],
      [{
        id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", sender_guest_id: null,
        sender_type: "user", body, message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: "Carla", avatarFileId: null }, attachments: null,
      }],
      [{ user_id: MENTIONED_USER_ID }, { user_id: "other-user" }],
      [{ id: "other-user" }], // resolveChatEmailRecipients -> one away recipient, so an email event fires too
    ]);
    prisma.membership.findFirst = async () => ({ companyId: "company-1" });

    const service = createChatService({ prisma, supabaseAdmin: {}, notificationService, mentionsService, permissionsService, broadcaster: null });
    await service.sendMessage({ conversationId: "conv1", authUserId: "auth-1", body });
    await new Promise((resolve) => setImmediate(resolve));

    assert.ok(publishedEvents.length > 0, "expected at least one notification");
    const rawToken = /@\[[0-9a-fA-F-]{36}:/;
    for (const ev of publishedEvents) {
      assert.ok(!rawToken.test(ev.input.body ?? ""), `raw mention token leaked into ${ev.input.eventType} body: ${ev.input.body}`);
      assert.ok(!rawToken.test(ev.input.metadata?.snippet ?? ""), `raw mention token leaked into ${ev.input.eventType} snippet`);
    }
    const mentionEvent = publishedEvents.find((e) => e.input.eventType === "chat.mention.new");
    assert.match(mentionEvent.input.body, /@Ana/);
    assert.match(mentionEvent.input.body, /@MirAI/);
  });
});

describe("chat-service — sendMessage entity references (Phase F)", () => {
  // sendMessage's real call order (traced from the current source, not
  // guessed) when entityRefs is non-empty and threadRootId/mentionsService
  // are absent:
  //   1. resolveUserProfileId          -> $queryRaw
  //   2. assertMember                  -> $queryRaw
  //   3. assertNotBlocked: conversation-type lookup (unconditional, runs
  //      before the entityRefs check regardless of entityRefs)
  //                                     -> $queryRaw
  //   4. entityRefs: fresh conversation-type lookup (NOT reused from either
  //      assertNotBlocked's lookup above or the threadRootId branch, which
  //      only queries when threadRootId is set)
  //                                     -> $queryRaw
  //   5. INSERT INTO chat_messages ... RETURNING *   -> $queryRaw
  //   6. getMessageFull                -> $queryRaw

  it("resolves entityRefs and round-trips them into metadata.entityRefs on the actual INSERT statement", async () => {
    const resolved = [{ entityType: "contact", recordId: "contact-1", title: "Ada", subtitle: null, url: "/app/m/runly.contacts/contacts/contact-1" }];
    const entityReferencesService = {
      resolveEntityRefs: async ({ authUserId, entityRefs }) => {
        assert.equal(authUserId, "auth-1");
        assert.deepEqual(entityRefs, [{ entityType: "contact", recordId: "contact-1" }]);
        return resolved;
      },
    };

    const prisma = buildPrismaMock([
      [{ id: "sender-profile" }],                 // resolveUserProfileId
      [{ id: "m1" }],                              // assertMember
      [{ type: "channel" }],                       // assertNotBlocked: conversation-type lookup
      [{ type: "channel" }],                       // entityRefs: conversation-type lookup
      [{ id: "msg1", conversation_id: "conv1", created_at: new Date(), metadata: {} }], // INSERT ... RETURNING *
      [{                                            // getMessageFull
        id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", sender_guest_id: null,
        sender_type: "user", body: "mira este contacto", message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null,
      }],
    ]);

    // Prove the round-trip all the way to the SQL, not just to the in-memory
    // finalMetadata variable — buildPrismaMock's default $queryRaw ignores
    // its arguments entirely, which would let a "computed but never actually
    // bound into the query" regression pass silently.
    let capturedInsertValues = null;
    const baseQueryRaw = prisma.$queryRaw;
    prisma.$queryRaw = async (strings, ...values) => {
      if (typeof strings?.[0] === "string" && strings[0].includes("INSERT INTO chat_messages")) {
        capturedInsertValues = values;
      }
      return baseQueryRaw(strings, ...values);
    };

    const service = createChatService({ prisma, supabaseAdmin: {}, entityReferencesService });
    const result = await service.sendMessage({
      conversationId: "conv1",
      authUserId: "auth-1",
      body: "mira este contacto",
      entityRefs: [{ entityType: "contact", recordId: "contact-1" }],
    });
    assert.ok(result);

    assert.ok(capturedInsertValues, "expected the INSERT INTO chat_messages statement to have been issued");
    const metadataJson = capturedInsertValues.find((v) => typeof v === "string" && v.includes("entityRefs"));
    assert.ok(metadataJson, "expected finalMetadata JSON (containing entityRefs) among the INSERT's bound values");
    assert.deepEqual(JSON.parse(metadataJson).entityRefs, resolved);
  });

  it("rejects entityRefs on an external_support conversation with 400, before attempting any resolution", async () => {
    const prisma = buildPrismaMock([
      [{ id: "sender-profile" }],       // resolveUserProfileId
      [{ id: "m1" }],                    // assertMember
      [{ type: "external_support" }],    // assertNotBlocked: conversation-type lookup — not direct, short-circuits
      [{ type: "external_support" }],    // entityRefs: conversation-type lookup — rejects here
    ]);
    // If the rejection didn't happen strictly before resolution, this stub
    // throwing would surface as an unrelated error, not the expected 400.
    const entityReferencesService = {
      resolveEntityRefs: async () => { throw new Error("resolveEntityRefs should not be called for a rejected send"); },
    };
    const service = createChatService({ prisma, supabaseAdmin: {}, entityReferencesService });
    await assert.rejects(
      () => service.sendMessage({
        conversationId: "conv1",
        authUserId: "auth-1",
        body: "x",
        entityRefs: [{ entityType: "contact", recordId: "c1" }],
      }),
      (err) => err instanceof ChatServiceError && err.status === 400,
    );
  });

  it("omits metadata.entityRefs and issues no extra query/service call when no entityRefs are sent", async () => {
    const prisma = buildPrismaMock([
      [{ id: "sender-profile" }],   // resolveUserProfileId
      [{ id: "m1" }],                // assertMember
      [{ type: "channel" }],         // assertNotBlocked: conversation-type lookup (unconditional)
      // No SECOND (entityRefs-driven) conversation-type lookup queued — if
      // sendMessage issued one despite entityRefs being empty, the next
      // $queryRaw call below would throw "Unexpected $queryRaw call #4" and
      // fail this test.
      [{ id: "msg1", conversation_id: "conv1", created_at: new Date(), metadata: {} }], // INSERT ... RETURNING *
      [{                              // getMessageFull
        id: "msg1", conversation_id: "conv1", sender_user_id: "sender-profile", sender_guest_id: null,
        sender_type: "user", body: "hola", message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null,
      }],
    ]);
    // Supplied but must never be invoked — proves the branch is skipped
    // entirely (not merely resolved with an empty entityRefs array).
    const entityReferencesService = {
      resolveEntityRefs: async () => { throw new Error("resolveEntityRefs should not be called when entityRefs is empty"); },
    };
    const service = createChatService({ prisma, supabaseAdmin: {}, entityReferencesService });
    const result = await service.sendMessage({ conversationId: "conv1", authUserId: "auth-1", body: "hola" });
    assert.ok(result);
  });
});

describe("chat-service — sendMessage thread replies", () => {
  it("resolves threadRootId, increments the root's counter, and skips updateConversationLastMessage", async () => {
    const rootId = "01900000-0000-7000-8000-00000000r001";
    let qIdx = 0;
    const executeRawCalls = [];
    const queryRawResults = [
      [{ id: PROFILE_ID }],                                            // resolveUserProfileId
      [{ id: rootId }],                                                // assertMember (sendMessage's own)
      [{ type: "channel" }],                                           // assertNotBlocked: conversation-type lookup — not direct, short-circuits
      [{ id: rootId, conversation_id: CONV_ID, thread_root_id: null, deleted_at: null, conversation_type: "channel" }], // thread target lookup
      [{ id: "msg-reply-1", conversation_id: CONV_ID, created_at: new Date() }], // INSERT ... RETURNING *
      [{ id: "msg-reply-1", conversation_id: CONV_ID, sender: null, attachments: null, reactions: null }], // getMessageFull
    ];
    const prisma = {
      $queryRaw: async () => queryRawResults[qIdx++],
      $executeRaw: async (strings, ...values) => { executeRawCalls.push(values); return { count: 1 }; },
      $transaction: async (fn) => fn(prisma),
      membership: { findFirst: async () => null },
    };
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const result = await service.sendMessage({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "respuesta", threadRootId: rootId,
    });
    assert.equal(result.id, "msg-reply-1");
    // updateConversationLastMessage (chat-service.js:84-92) issues its own
    // $executeRaw against chat_conversations, targeting conversationId, not
    // the message/root id — asserting exactly one $executeRaw call happened,
    // and that its only interpolated value is rootId (the counter update's
    // WHERE target), proves updateConversationLastMessage's UPDATE never ran.
    // Unlike buildPrismaMock's $executeRaw (which silently no-ops on overrun),
    // this inline mock has no fallback array to fall through to, so a second,
    // unaccounted-for call would push a second entry here and this assertion
    // would genuinely fail.
    assert.equal(executeRawCalls.length, 1, "expected exactly one $executeRaw call (the counter increment)");
    assert.ok(executeRawCalls[0].includes(rootId), "the one $executeRaw call must target the root's counter update");
    assert.ok(!executeRawCalls[0].includes(CONV_ID), "updateConversationLastMessage (keyed on conversationId) must not have run");
  });

  it("auto-flattens a reply-to-a-reply onto the original root", async () => {
    const rootId = "01900000-0000-7000-8000-00000000r001";
    const replyId = "01900000-0000-7000-8000-00000000r002";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: replyId }],
      [{ type: "channel" }], // assertNotBlocked: conversation-type lookup — not direct, short-circuits
      [{ id: replyId, conversation_id: CONV_ID, thread_root_id: rootId, deleted_at: null, conversation_type: "channel" }], // target is itself a reply
      [{ id: "msg-reply-2", conversation_id: CONV_ID, created_at: new Date() }],
      [{ id: "msg-reply-2", conversation_id: CONV_ID, sender: null, attachments: null, reactions: null }],
    ], [
      { count: 1 },
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await service.sendMessage({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "respuesta anidada", threadRootId: replyId,
    });
    // The INSERT's actual thread_root_id value is asserted via the mock's
    // fixed-sequence contract here; the next test below (spy-based) directly
    // proves the counter-UPDATE targets the flattened root, not replyId.
  });

  it("rejects a threadRootId belonging to a different conversation with 404", async () => {
    const foreignRootId = "01900000-0000-7000-8000-00000000f001";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: foreignRootId }],
      [{ type: "channel" }], // assertNotBlocked: conversation-type lookup — not direct, short-circuits
      [{ id: foreignRootId, conversation_id: "some-other-conv", thread_root_id: null, deleted_at: null, conversation_type: "channel" }],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "x", threadRootId: foreignRootId }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
  });

  it("rejects a threadRootId in a direct conversation with 404 (threads are channel/group only)", async () => {
    const directMsgId = "01900000-0000-7000-8000-00000000dm01";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: directMsgId }],
      [{ type: "channel" }], // assertNotBlocked: conversation-type lookup for CONV_ID — deliberately non-direct here (a distinct query from the thread target's own conversation_type below) so this test stays focused on the threadRootId/direct-conversation rejection alone
      [{ id: directMsgId, conversation_id: CONV_ID, thread_root_id: null, deleted_at: null, conversation_type: "direct" }],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "x", threadRootId: directMsgId }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
  });

  it("rejects a threadRootId in an external_support conversation with 404", async () => {
    const supportMsgId = "01900000-0000-7000-8000-00000000sm01";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: supportMsgId }],
      [{ type: "channel" }], // assertNotBlocked: conversation-type lookup for CONV_ID — deliberately non-direct here (a distinct query from the thread target's own conversation_type below)
      [{ id: supportMsgId, conversation_id: CONV_ID, thread_root_id: null, deleted_at: null, conversation_type: "external_support" }],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "x", threadRootId: supportMsgId }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
  });

  it("rejects replying to a soft-deleted message with 404", async () => {
    const deletedId = "01900000-0000-7000-8000-00000000d001";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: deletedId }],
      [{ type: "channel" }], // assertNotBlocked: conversation-type lookup — not direct, short-circuits
      [], // deleted_at IS NULL filter excludes it — lookup returns no rows
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "x", threadRootId: deletedId }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
  });

  it("counter-UPDATE targets the flattened root id, not the immediate reply target (spy-based)", async () => {
    // Verified empirically against this repo's real Prisma+adapter-pg setup
    // (PrismaPg over a live Supabase Postgres connection) before writing this
    // spy: a tagged-template call `prisma.$queryRaw\`...${x}...\`` invokes the
    // bound function as (stringsArray, x) per JS tagged-template semantics —
    // this is language-level, not Prisma-specific, so the spy below correctly
    // captures what chat-service.js actually sends. Also verified empirically
    // that a UUID column value returned by $queryRaw under this adapter comes
    // back as a plain JS string (constructor Object, typeof "string"), so no
    // String(...) wrap is needed anywhere values are compared below.
    const rootId = "01900000-0000-7000-8000-00000000r001";
    const replyId = "01900000-0000-7000-8000-00000000r002";
    const calls = [];
    let qIdx = 0;
    const queryRawResults = [
      [{ id: PROFILE_ID }],
      [{ id: replyId }],
      [{ type: "channel" }], // assertNotBlocked: conversation-type lookup — not direct, short-circuits
      [{ id: replyId, conversation_id: CONV_ID, thread_root_id: rootId, deleted_at: null, conversation_type: "channel" }],
      [{ id: "msg-reply-3", conversation_id: CONV_ID, created_at: new Date() }],
      [{ id: "msg-reply-3", conversation_id: CONV_ID, sender: null, attachments: null, reactions: null }],
    ];
    const prisma = {
      $queryRaw: async (strings, ...values) => {
        calls.push({ kind: "query", values });
        return queryRawResults[qIdx++];
      },
      $executeRaw: async (strings, ...values) => {
        calls.push({ kind: "execute", values });
        return { count: 1 };
      },
      $transaction: async (fn) => fn(prisma),
      membership: { findFirst: async () => null },
    };
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "x", threadRootId: replyId });
    const executeCall = calls.find((c) => c.kind === "execute");
    assert.ok(executeCall, "expected a counter-update $executeRaw call");
    assert.ok(executeCall.values.includes(rootId), "counter update must target the original root id, not the immediate reply id");
    assert.ok(!executeCall.values.includes(replyId), "counter update must NOT target the immediate reply id");
  });
});

describe("chat-service — sendMessage thread reply notifications", () => {
  it("branches to chat.thread.reply (not chat.message.new) for thread participants, while chat.mention.new still fires on top, with no double-count of a mentioned participant", async () => {
    const rootId = "01900000-0000-7000-8000-00000000r001";
    const ROOT_AUTHOR_ID = "01900000-0000-7000-8000-0000000000a1";
    const PRIOR_REPLIER_ID = "01900000-0000-7000-8000-0000000000b2";
    const MENTIONED_USER_ID = "01900000-0000-7000-8000-0000000000c3";
    const publishedEvents = [];
    const notificationService = { publish: async (args) => { publishedEvents.push(args); } };
    const mentionsService = {
      resolveMentions: async () => ({ userIds: [MENTIONED_USER_ID], roleIds: [], everyone: false, here: false, notifyUserIds: [MENTIONED_USER_ID] }),
    };
    // assertChannelPermission stub added alongside getMemberRole: sendMessage now
    // calls it (messages.send enforcement) whenever permissionsService is truthy
    // and the conversation is a channel/group — these tests aren't exercising
    // that gate, so just let it pass through.
    const permissionsService = { getMemberRole: async () => null, assertChannelPermission: async () => ({}) };

    const body = `hola @[${MENTIONED_USER_ID}:X] respondiendo en hilo`;
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],                                                   // resolveUserProfileId
      [{ id: "member-row" }],                                                 // assertMember
      [{ type: "channel" }],                                                  // assertNotBlocked: conversation-type lookup — not direct, short-circuits
      [{ id: rootId, conversation_id: CONV_ID, thread_root_id: null, deleted_at: null, conversation_type: "channel" }], // thread target lookup
      [{ id: "msg-thread-1", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, created_at: new Date(), metadata: {} }], // INSERT ... RETURNING * (inside tx)
      [{                                                                       // getMessageFull
        id: "msg-thread-1", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, sender_guest_id: null,
        sender_type: "user", body, message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null, reactions: null,
      }],
      [{ user_id: ROOT_AUTHOR_ID }, { user_id: PRIOR_REPLIER_ID }],            // otherMembers query — unconditionally computed before the thread/non-thread branch, unused on the thread path but still consumed
      [                                                                        // participantRows (thread notify) — includes the mentioned user as an existing thread participant
        { sender_user_id: ROOT_AUTHOR_ID },
        { sender_user_id: PRIOR_REPLIER_ID },
        { sender_user_id: MENTIONED_USER_ID },
      ],
      [], // resolveChatEmailRecipients (thread path) — no away recipients
    ], [
      { count: 1 }, // counter UPDATE inside tx
    ]);
    prisma.membership.findFirst = async () => ({ companyId: "company-1" });

    const service = createChatService({ prisma, supabaseAdmin: {}, notificationService, mentionsService, permissionsService, broadcaster: null });
    await service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body, threadRootId: rootId });

    // The notification dispatch runs inside a fire-and-forget setImmediate — flush it.
    await new Promise((resolve) => setImmediate(resolve));

    const messageEvent = publishedEvents.find((e) => e.input.eventType === "chat.message.new");
    const threadEvent = publishedEvents.find((e) => e.input.eventType === "chat.thread.reply");
    const mentionEvent = publishedEvents.find((e) => e.input.eventType === "chat.mention.new");

    assert.equal(messageEvent, undefined, "a thread reply must never fan out chat.message.new to the whole channel");
    assert.ok(threadEvent, "expected chat.thread.reply to fire for thread participants");
    assert.deepEqual(
      [...threadEvent.input.recipients.userIds].sort(),
      [ROOT_AUTHOR_ID, PRIOR_REPLIER_ID].sort(),
      "the mentioned participant must be excluded from chat.thread.reply (goes to chat.mention.new instead), not dropped or double-counted",
    );
    assert.ok(mentionEvent, "expected chat.mention.new to still fire on top of the thread-reply notification");
    assert.deepEqual(mentionEvent.input.recipients.userIds, [MENTIONED_USER_ID]);
  });

  it("excludes a former member from chat.thread.reply even though they're in the thread's message history", async () => {
    const rootId = "01900000-0000-7000-8000-00000000r001";
    const ROOT_AUTHOR_ID = "01900000-0000-7000-8000-0000000000a1";
    const FORMER_MEMBER_ID = "01900000-0000-7000-8000-0000000000d4"; // replied in the thread, then left the conversation
    const publishedEvents = [];
    const notificationService = { publish: async (args) => { publishedEvents.push(args); } };

    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "channel" }], // assertNotBlocked: conversation-type lookup — not direct, short-circuits
      [{ id: rootId, conversation_id: CONV_ID, thread_root_id: null, deleted_at: null, conversation_type: "channel" }],
      [{ id: "msg-thread-2", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, created_at: new Date(), metadata: {} }],
      [{
        id: "msg-thread-2", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, sender_guest_id: null,
        sender_type: "user", body: "sigo aqui", message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null, reactions: null,
      }],
      [{ user_id: ROOT_AUTHOR_ID }],                                    // otherMembers — FORMER_MEMBER_ID already left (left_at IS NOT NULL), so it's absent here
      [                                                                  // participantRows — derived from message history, still includes the former member
        { sender_user_id: ROOT_AUTHOR_ID },
        { sender_user_id: FORMER_MEMBER_ID },
      ],
      [], // resolveChatEmailRecipients (thread path) — no away recipients
    ], [
      { count: 1 },
    ]);
    prisma.membership.findFirst = async () => ({ companyId: "company-1" });

    const service = createChatService({ prisma, supabaseAdmin: {}, notificationService, broadcaster: null });
    await service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "sigo aqui", threadRootId: rootId });
    await new Promise((resolve) => setImmediate(resolve));

    const threadEvent = publishedEvents.find((e) => e.input.eventType === "chat.thread.reply");
    assert.ok(threadEvent);
    assert.deepEqual(
      threadEvent.input.recipients.userIds,
      [ROOT_AUTHOR_ID],
      "a former member who replied in the thread before leaving must not keep receiving chat.thread.reply after leaving",
    );
  });
});

describe("chat-service — pinMessage permission enforcement", () => {
  it("channel: calls assertChannelPermission with messages.pin and propagates a 403 rejection", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],                                             // resolveUserProfileId
      [{ id: "msg-1", conversation_id: CONV_ID, conversation_type: "channel" }], // message+membership+type lookup
    ]);
    let calledWith = null;
    const permissionsService = {
      assertChannelPermission: async (convId, profileId, key) => {
        calledWith = { convId, profileId, key };
        const err = new Error("No tienes permiso para realizar esta accion.");
        err.status = 403;
        throw err;
      },
    };
    const svc = createChatService({ prisma, permissionsService });
    await assert.rejects(
      () => svc.pinMessage({ messageId: "msg-1", authUserId: AUTH_USER_ID, pinned: true }),
      (err) => err.status === 403,
    );
    assert.deepEqual(calledWith, { convId: CONV_ID, profileId: PROFILE_ID, key: "messages.pin" });
  });

  it("direct: never calls assertChannelPermission — behavior unaffected", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "msg-1", conversation_id: CONV_ID, conversation_type: "direct" }],
      [{  // getMessageFull's query
        id: "msg-1", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, sender_guest_id: null,
        sender_type: "user", body: "hola", message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        pinned_at: new Date(), pinned_by_user_id: PROFILE_ID,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null, reactions: null,
      }],
    ]);
    const permissionsService = { assertChannelPermission: throwingAssertChannelPermission };
    const svc = createChatService({ prisma, permissionsService });
    const result = await svc.pinMessage({ messageId: "msg-1", authUserId: AUTH_USER_ID, pinned: true });
    assert.ok(result);
  });
});

describe("chat-service — getConversation member role fields", () => {
  it("includes roleId/roleName/roleColor/rolePosition/roleIsSystem for each member", async () => {
    const memberRow = {
      id: "m1", userId: "u1", role: "owner", joinedAt: new Date(), leftAt: null, lastReadAt: null,
      displayName: "Ada", avatarFileId: null, authAvatarUrl: null, email: "ada@example.com",
      roleId: "role-owner", roleName: "Owner", roleColor: null, rolePosition: 100, roleIsSystem: true,
      rolePermissions: { "messages.pin": true },
    };
    const prisma = buildPrismaMock([
      [{ id: "u1" }], // resolveUserProfileId
      [{ id: "m1" }], // assertMember
      [{ id: "conv1", type: "channel", members: [memberRow] }], // getConversation main query
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const conv = await service.getConversation({ conversationId: "conv1", authUserId: "auth-1" });
    assert.equal(conv.members[0].roleId, "role-owner");
    assert.equal(conv.members[0].roleName, "Owner");
    assert.equal(conv.members[0].rolePosition, 100);
    assert.equal(conv.members[0].roleIsSystem, true);
    // Frontend permission gating (e.g. messages.pin for the Fijar mensaje
    // action) reads member.rolePermissions directly — regression coverage
    // for the bug where getConversation's SQL selected every role field
    // except this one, leaving canPin permanently false client-side.
    assert.deepEqual(conv.members[0].rolePermissions, { "messages.pin": true });
  });
});

describe("chat-service — conversation avatar resolution", () => {
  it("getConversation resolves avatar_file_id to a signed avatarUrl and clears the dead avatar_url field", async () => {
    const fileId = "01900000-0000-7000-8000-00000000f002";
    const objectKey = "conv-avatar-a1/original.png";
    const signedUrl = "https://signed.example/conv-avatar-a1";

    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember
      [{ id: CONV_ID, avatar_file_id: fileId, avatar_url: null, avatar_emoji: null, members: null }], // getConversation main query
    ]);
    prisma.fileAsset.findMany = async ({ where }) => {
      assert.deepEqual(where.id.in, [fileId], "batchSignAvatarUrls must be called with exactly the conversation's own avatar_file_id");
      return [{ id: fileId, bucket: "chat-files", objectKey }];
    };
    const supabaseAdmin = buildSupabaseAdminMock({ [objectKey]: signedUrl });

    const service = createChatService({ prisma, supabaseAdmin });
    const result = await service.getConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });

    assert.equal(result.avatarUrl, signedUrl);
    assert.equal(result.avatar_url, undefined, "the dead raw column must not leak into the response");
  });

  it("getConversation returns avatarUrl: null when no avatar_file_id is set (emoji-only)", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ id: CONV_ID, avatar_file_id: null, avatar_url: null, avatar_emoji: "🎉", members: null }],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const result = await service.getConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });
    assert.equal(result.avatarUrl, null);
    assert.equal(result.avatar_emoji, "🎉");
    assert.equal(result.avatar_url, undefined);
  });

  it("getConversation returns avatarUrl: null when there is no avatar at all (no file, no emoji)", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ id: CONV_ID, avatar_file_id: null, avatar_url: null, avatar_emoji: null, members: null }],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const result = await service.getConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });
    assert.equal(result.avatarUrl, null);
    assert.equal(result.avatar_emoji, null);
    assert.equal(result.avatar_url, undefined);
  });

  it("listConversations resolves each conversation's own avatar_file_id independently from its members' avatarFileIds, across multiple rows, without mixing them up", async () => {
    const fileConvA = "01900000-0000-7000-8000-00000000c0a1";
    const fileConvB = "01900000-0000-7000-8000-00000000c0b1";
    const fileMemberA = "01900000-0000-7000-8000-00000000m0a1";
    const fileMemberB = "01900000-0000-7000-8000-00000000m0b1";

    const assetById = {
      [fileConvA]: { bucket: "chat-files", objectKey: "oc-conv-a" },
      [fileConvB]: { bucket: "chat-files", objectKey: "oc-conv-b" },
      [fileMemberA]: { bucket: "chat-files", objectKey: "oc-mem-a" },
      [fileMemberB]: { bucket: "chat-files", objectKey: "oc-mem-b" },
    };
    const signedUrlByObjectKey = {
      "oc-conv-a": "https://signed.example/conv-a",
      "oc-conv-b": "https://signed.example/conv-b",
      "oc-mem-a": "https://signed.example/mem-a",
      "oc-mem-b": "https://signed.example/mem-b",
    };

    const rowA = {
      id: "conv-a", type: "group", title: "Group A", avatar_url: null,
      avatar_file_id: fileConvA, avatar_emoji: null, status: "open",
      last_message_at: new Date(), last_message_id: null, website_id: null,
      company_id: null, metadata: {}, created_at: new Date(), unread_count: 0,
      last_message: null, is_archived: false,
      members: [{ userId: "u1", role: "member", displayName: "Member A", avatarFileId: fileMemberA, authAvatarUrl: null, lastReadAt: null }],
    };
    const rowB = {
      id: "conv-b", type: "group", title: "Group B", avatar_url: null,
      avatar_file_id: fileConvB, avatar_emoji: null, status: "open",
      last_message_at: new Date(), last_message_id: null, website_id: null,
      company_id: null, metadata: {}, created_at: new Date(), unread_count: 0,
      last_message: null, is_archived: false,
      members: [{ userId: "u2", role: "member", displayName: "Member B", avatarFileId: fileMemberB, authAvatarUrl: null, lastReadAt: null }],
    };

    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [rowA, rowB], // listConversations main query
    ]);
    prisma.fileAsset.findMany = async ({ where }) => {
      const ids = where.id.in;
      return ids.map((id) => ({ id, ...assetById[id] }));
    };
    const supabaseAdmin = buildSupabaseAdminMock(signedUrlByObjectKey);

    const service = createChatService({ prisma, supabaseAdmin });
    const result = await service.listConversations({ authUserId: AUTH_USER_ID });

    const [a, b] = result.data;
    assert.equal(a.avatarUrl, "https://signed.example/conv-a");
    assert.equal(a.members[0].avatarUrl, "https://signed.example/mem-a");
    assert.equal(b.avatarUrl, "https://signed.example/conv-b");
    assert.equal(b.members[0].avatarUrl, "https://signed.example/mem-b");

    // Risk 3 (spec Section 24): a conversation's own avatar must never resolve
    // to a member's avatar URL (or another conversation's), even though both
    // are keyed off the same shared avatarUrlMap.
    assert.notEqual(a.avatarUrl, a.members[0].avatarUrl);
    assert.notEqual(a.avatarUrl, b.avatarUrl);
    assert.notEqual(a.members[0].avatarUrl, b.members[0].avatarUrl);
    assert.equal(a.avatar_url, undefined);
    assert.equal(b.avatar_url, undefined);
  });
});

describe("chat-service — deleteMessage decrements thread counter", () => {
  it("decrements the root's thread_reply_count when a reply is deleted", async () => {
    const rootId = "01900000-0000-7000-8000-00000000r001";
    const replyId = "01900000-0000-7000-8000-00000000r003";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: replyId, thread_root_id: rootId }], // ownership lookup, now also selects thread_root_id
    ], [
      { count: 1 }, // UPDATE ... SET deleted_at = NOW()
      { count: 1 }, // UPDATE chat_messages SET thread_reply_count = GREATEST(thread_reply_count - 1, 0) WHERE id = rootId
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await service.deleteMessage({ messageId: replyId, authUserId: AUTH_USER_ID });
    // Real proof both UPDATEs ran (not a vacuous assertion): buildPrismaMock now
    // tracks _executeRawCallCount the same way it already tracks
    // _transactionCallCount. If deleteMessage failed to issue the counter-decrement
    // UPDATE, this would read 1, not 2.
    assert.equal(prisma._executeRawCallCount, 2);
  });

  it("does not touch any counter when deleting a top-level (non-reply) message", async () => {
    const msgId = "01900000-0000-7000-8000-00000000m001";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: msgId, thread_root_id: null }],
    ], [
      { count: 1 }, // only the deleted_at UPDATE is expected
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await service.deleteMessage({ messageId: msgId, authUserId: AUTH_USER_ID });
    // Proves the counter-decrement branch was skipped entirely, not just that
    // nothing threw — a top-level message (including a thread ROOT that has
    // replies pointing at it, since a root's OWN row always has
    // thread_root_id = null per the data model) must never trigger a decrement.
    assert.equal(prisma._executeRawCallCount, 1);
  });

  it("decrement UPDATE targets the reply's root id with a GREATEST(...,0) floor guard (spy-based)", async () => {
    const rootId = "01900000-0000-7000-8000-00000000r001";
    const replyId = "01900000-0000-7000-8000-00000000r003";
    const executeRawCalls = [];
    const queryRawResults = [
      [{ id: PROFILE_ID }],
      [{ id: replyId, thread_root_id: rootId }],
    ];
    let qIdx = 0;
    const prisma = {
      $queryRaw: async () => queryRawResults[qIdx++],
      $executeRaw: async (strings, ...values) => {
        executeRawCalls.push({ sql: strings.join(""), values });
        return { count: 1 };
      },
      $transaction: async (fn) => fn(prisma),
      membership: { findFirst: async () => null },
    };
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await service.deleteMessage({ messageId: replyId, authUserId: AUTH_USER_ID });
    assert.equal(executeRawCalls.length, 2);
    const decrementCall = executeRawCalls[1];
    assert.ok(
      decrementCall.sql.includes("GREATEST") && decrementCall.sql.includes("thread_reply_count"),
      "the decrement UPDATE must use GREATEST(thread_reply_count - 1, 0) so the counter can never go negative",
    );
    assert.ok(
      decrementCall.values.includes(rootId),
      "the decrement UPDATE must target the reply's root id",
    );
    assert.ok(
      !decrementCall.values.includes(replyId),
      "the decrement UPDATE must NOT target the reply's own id",
    );
  });
});

describe("chat-service — listThreadReplies", () => {
  it("returns the root and its replies in chronological order", async () => {
    const rootId = "01900000-0000-7000-8000-00000000r001";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],                             // resolveUserProfileId
      [{ id: rootId, conversation_id: CONV_ID, thread_root_id: null }], // target lookup (membership folded in — root itself)
      [{ id: rootId, conversation_id: CONV_ID, sender: null, attachments: null, reactions: null }], // getMessageFull(root)
      [{ id: "reply-a" }, { id: "reply-b" }],             // reply id list, ORDER BY created_at ASC
      [{ id: "reply-a", conversation_id: CONV_ID, sender: null, attachments: null, reactions: null }], // getMessageFull(reply-a)
      [{ id: "reply-b", conversation_id: CONV_ID, sender: null, attachments: null, reactions: null }], // getMessageFull(reply-b)
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const result = await service.listThreadReplies({ messageId: rootId, authUserId: AUTH_USER_ID });
    assert.equal(result.root.id, rootId);
    assert.deepEqual(result.replies.map((r) => r.id), ["reply-a", "reply-b"]);
  });

  it("auto-flattens: reading a reply's own id resolves to its root's thread", async () => {
    const rootId = "01900000-0000-7000-8000-00000000r001";
    const replyId = "01900000-0000-7000-8000-00000000r002";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: replyId, conversation_id: CONV_ID, thread_root_id: rootId }], // lookup on the reply id resolves thread_root_id
      [{ id: rootId, conversation_id: CONV_ID, sender: null, attachments: null, reactions: null }],
      [],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const result = await service.listThreadReplies({ messageId: replyId, authUserId: AUTH_USER_ID });
    // The queried messageId (replyId) and the returned root's id (rootId) are
    // deliberately different values here — this only passes if listThreadReplies
    // actually resolved thread_root_id from the lookup row instead of just
    // echoing back whatever id it was called with.
    assert.equal(result.root.id, rootId);
    assert.notEqual(result.root.id, replyId);
    assert.deepEqual(result.replies, []);
  });

  it("throws 404 for a nonexistent message id", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.listThreadReplies({ messageId: "does-not-exist", authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
  });

  it("throws 404 (not 403) for a message that exists but belongs to a conversation the caller isn't a member of", async () => {
    // Membership is folded into the target lookup's INNER JOIN (same
    // non-leaking convention as pinMessage) — a non-member gets the exact
    // same empty-result 404 as a nonexistent id, not a distinguishing 403
    // that would confirm the message exists.
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [], // INNER JOIN on chat_conversation_members excludes the row — caller isn't a member
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.listThreadReplies({ messageId: "01900000-0000-7000-8000-00000000fff1", authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 404 && err.message === "Mensaje no encontrado.",
    );
  });
});

describe("chat-service — block enforcement", () => {
  it("sendMessage rejects when the recipient has blocked the sender", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId (sender)
      [{ id: "member-row" }], // assertMember
      [{ type: "direct" }], // assertNotBlocked: conversation type lookup
      [{ user_id: OTHER_PROFILE_ID }], // assertNotBlocked: other member lookup
      [{ blocker_user_id: OTHER_PROFILE_ID, blocked_user_id: PROFILE_ID }], // assertNotBlocked: block row found
    ]);
    const service = createChatService({ prisma, supabaseAdmin: buildSupabaseAdminMock() });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "hola" }),
      (err) => err instanceof ChatServiceError && err.status === 403,
    );
  });

  it("assertNotBlocked's blocks query is parameterized with ALL other members' ids, not just one (regression guard for the LIMIT-1 bug)", async () => {
    // buildPrismaMock is call-order-indexed and blind to actual SQL/params —
    // it can't distinguish "checked all members correctly" from "checked one
    // arbitrary member and got lucky", so a canned-response-only test here
    // would be vacuous (it would pass identically against the old buggy
    // `LIMIT 1` implementation). This test uses its own $queryRaw spy that
    // records the raw tagged-template values for every call, so the
    // assertions below can prove BOTH other members' ids actually reached the
    // blocks-lookup query — the one thing the LIMIT 1 bug could never do,
    // since its "other members" query fetched at most one id in the first
    // place.
    const OTHER_PROFILE_ID_2 = "01900000-0000-7000-8000-0000000000p3";
    const capturedCalls = [];
    const prisma = {
      $queryRaw: async (strings, ...values) => {
        capturedCalls.push(values);
        const callIndex = capturedCalls.length;
        if (callIndex === 1) return [{ id: PROFILE_ID }]; // resolveUserProfileId
        if (callIndex === 2) return [{ id: "member-row" }]; // assertMember
        if (callIndex === 3) return [{ type: "direct" }]; // assertNotBlocked: conversation type lookup
        if (callIndex === 4) return [{ user_id: OTHER_PROFILE_ID }, { user_id: OTHER_PROFILE_ID_2 }]; // assertNotBlocked: other members (both, no LIMIT)
        if (callIndex === 5) return [{ blocker_user_id: OTHER_PROFILE_ID_2, blocked_user_id: PROFILE_ID }]; // assertNotBlocked: blocks lookup — found
        throw new Error(`Unexpected $queryRaw call #${callIndex}`);
      },
      $executeRaw: async () => ({ count: 1 }),
    };
    const service = createChatService({ prisma, supabaseAdmin: buildSupabaseAdminMock() });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "hola" }),
      (err) => err instanceof ChatServiceError && err.status === 403,
    );

    // The 5th $queryRaw call is the blocks lookup. Its interpolated values
    // include two Prisma.join(otherIds) fragments (one per IN (...) clause,
    // for the two OR'd block directions). Verified empirically against this
    // repo's real @prisma/client: Prisma.join(['a','b']) interpolated into a
    // tagged template produces a `_Sql` object shaped
    // { values: ['a','b'], strings: [...] } — same pattern this test file
    // already documents elsewhere for Prisma.join(sets, ", ") in the
    // updateConversation avatar tests above. Flatten defensively so this
    // assertion survives either a raw array value or a Prisma.join fragment.
    assert.equal(capturedCalls.length, 5, "expected exactly 5 $queryRaw calls before the rejection");
    const blocksCallValues = capturedCalls[4];
    const flatIds = blocksCallValues.flatMap((v) =>
      v && typeof v === "object" && Array.isArray(v.values) ? v.values : [v],
    );
    assert.ok(
      flatIds.includes(OTHER_PROFILE_ID),
      "blocks query must include the FIRST other member's id",
    );
    assert.ok(
      flatIds.includes(OTHER_PROFILE_ID_2),
      "blocks query must include the SECOND other member's id — the old LIMIT 1 bug's other-members query could never have surfaced this id at all",
    );
  });

  it("sendMessage proceeds normally in a group conversation (block check skipped)", async () => {
    // Real call order traced from the current source (no notificationService/
    // broadcaster supplied, so neither the notify block nor the broadcast
    // block issue any query here): resolveUserProfileId -> assertMember ->
    // assertNotBlocked's conversation-type lookup (short-circuits on "group",
    // no otherRow/block queries) -> INSERT ... RETURNING * -> (executeRaw)
    // updateConversationLastMessage -> getMessageFull. That's 5 $queryRaw
    // calls total, not the 4 a naive guess at "mention scan etc." would
    // assume — mentionsService is absent here so parseMentionIds' cheap
    // regex short-circuit never even fires a query.
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: "member-row" }], // assertMember
      [{ type: "group" }], // assertNotBlocked: conversation type lookup — not direct, short-circuits
      [{ id: "msg-1", conversation_id: CONV_ID, created_at: new Date(), body: "hola", sender_user_id: PROFILE_ID, sender_type: "user", message_type: "text", attachment_count: 0, metadata: {} }], // INSERT ... RETURNING *
      [], // getMessageFull finds no row — sendMessage falls back to the raw insert row via `fullMsg ?? msg`
    ], [
      { count: 1 }, // updateConversationLastMessage
    ]);
    const service = createChatService({ prisma, supabaseAdmin: buildSupabaseAdminMock() });
    const result = await service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "hola" });
    assert.equal(result.id, "msg-1");
  });

  it("createConversation rejects starting a direct chat with someone who blocked you", async () => {
    // assertNotBlockedByTarget runs BEFORE the existing-direct-conversation
    // uniqueness lookup (chat-service.js createConversation), so only 2
    // $queryRaw calls happen: resolveUserProfileId, then the block check
    // itself. If the existing-conversation lookup ran first (or at all), a
    // 3rd call here would throw "Unexpected $queryRaw call" and fail this
    // test — proving a blocked user can't even discover whether a prior
    // conversation exists.
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId (creator)
      [{ blocker_user_id: OTHER_PROFILE_ID, blocked_user_id: PROFILE_ID }], // assertNotBlockedByTarget: block row found
    ]);
    const service = createChatService({ prisma, supabaseAdmin: buildSupabaseAdminMock() });
    await assert.rejects(
      () => service.createConversation({ companyId: MOCK_COMPANY_ID, authUserId: AUTH_USER_ID, type: "direct", memberUserIds: [OTHER_PROFILE_ID] }),
      (err) => err instanceof ChatServiceError && err.status === 403,
    );
  });
});

describe("chat-service — sendMessage messages.send permission enforcement", () => {
  it("rejects sending in a channel when the sender's role lacks messages.send", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],   // resolveUserProfileId
      [{ id: "member-row" }], // assertMember
      [{ type: "channel" }],  // conversation type lookup (shared by assertNotBlocked + the permission gate)
    ]);
    const permissionsService = {
      assertChannelPermission: async () => { throw new (class extends Error { constructor() { super("No tienes permiso para realizar esta accion."); this.status = 403; } })(); },
    };
    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "hola" }),
      (err) => err.status === 403,
    );
  });

  it("allows sending in a channel when the sender's role grants messages.send", async () => {
    let assertedWith = null;
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "channel" }],
      [{ id: "msg1", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, created_at: new Date(), metadata: {} }], // INSERT ... RETURNING *
      [{
        id: "msg1", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, sender_guest_id: null,
        sender_type: "user", body: "hola", message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null,
      }],
    ]);
    const permissionsService = {
      assertChannelPermission: async (conversationId, profileId, permissionKey) => {
        assertedWith = { conversationId, profileId, permissionKey };
        return { position: 0, isSystem: false };
      },
    };
    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService });
    await service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "hola" });
    assert.deepEqual(assertedWith, { conversationId: CONV_ID, profileId: PROFILE_ID, permissionKey: "messages.send" });
  });

  it("skips the permission check entirely for direct conversations (no roles to gate against)", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "direct" }],
      [{ user_id: OTHER_PROFILE_ID }], // assertNotBlocked: other member lookup
      [], // assertNotBlocked: no block found
      [{ id: "msg1", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, created_at: new Date(), metadata: {} }],
      [{
        id: "msg1", conversation_id: CONV_ID, sender_user_id: PROFILE_ID, sender_guest_id: null,
        sender_type: "user", body: "hola", message_type: "text", attachment_count: 0,
        metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
        sender: { id: null, displayName: null, avatarFileId: null }, attachments: null,
      }],
    ]);
    const permissionsService = {
      assertChannelPermission: async () => { throw new Error("must not be called for a direct conversation"); },
    };
    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService });
    await service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "hola" });
  });
});

describe("chat-service — deleteConversation", () => {
  it("soft-deletes a channel when the actor has channel.manage, and broadcasts to every active member", async () => {
    let executeCallCount = 0;
    let executedText = "";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],               // getUserProfileId
      [{ id: "member-row" }],             // assertMember
      [{ type: "channel" }],              // conv-type + deleted_at IS NULL lookup
      [{ user_id: PROFILE_ID }, { user_id: OTHER_PROFILE_ID }], // broadcaster member-ids query
    ]);
    prisma.$executeRaw = async (strings) => { executeCallCount++; executedText = strings.join(""); return { count: 1 }; };
    let broadcastCall = null;
    const broadcaster = { broadcastToUsers: async (userIds, event, payload) => { broadcastCall = { userIds, event, payload }; } };
    const permissionsService = { assertChannelPermission: async () => ({ position: 100, isSystem: true }) };

    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService, broadcaster });
    const result = await service.deleteConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });

    assert.deepEqual(result, { ok: true });
    assert.equal(executeCallCount, 1);
    assert.ok(executedText.includes("deleted_at"), "the UPDATE must touch deleted_at");
    assert.deepEqual(broadcastCall, {
      userIds: [PROFILE_ID.toString(), OTHER_PROFILE_ID.toString()],
      event: "chat.conversation.deleted",
      payload: { conversationId: CONV_ID },
    });
  });

  it("rejects deleting a direct conversation (only channel/group are deletable)", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "direct" }],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.deleteConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 400,
    );
  });

  it("propagates a 403 when the actor lacks channel.manage", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "group" }],
    ]);
    const permissionsService = {
      assertChannelPermission: async () => { const e = new Error("No tienes permiso para realizar esta accion."); e.status = 403; throw e; },
    };
    const service = createChatService({ prisma, supabaseAdmin: {}, permissionsService });
    await assert.rejects(
      () => service.deleteConversation({ conversationId: CONV_ID, authUserId: AUTH_USER_ID }),
      (err) => err.status === 403,
    );
  });
});

describe("chat-service — listConversations exposes is_muted", () => {
  it("passes through ccm.muted_at IS NOT NULL as is_muted on each row", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{
        id: CONV_ID, type: "direct", title: null, avatar_url: null, avatar_file_id: null,
        avatar_emoji: null, status: "active", last_message_at: new Date(), last_message_id: null,
        website_id: null, company_id: null, metadata: {}, created_at: new Date(),
        unread_count: 0, last_message: null, members: [], is_archived: false, is_muted: true,
      }],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: buildSupabaseAdminMock() });
    const result = await service.listConversations({ authUserId: AUTH_USER_ID });
    assert.equal(result.data[0].is_muted, true);
  });
});

describe("chat-service — createConversation with a channel link", () => {
  it("returns the existing conversation when one already holds the requested link (idempotent)", async () => {
    const existing = { id: CONV_ID, linked_module: "atlas.projects", linked_entity_id: "proj-1" };
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }], // getUserProfileId
        [{ id: "member-row" }], // assertMember, inside the final getConversation call
        [{ ...existing, members: null }], // getConversation's SELECT c.*, members
      ],
      [],
    );
    const channelLinksService = {
      assertBothOrNeither: () => {},
      findByLink: async (mod, id) => { assert.equal(mod, "atlas.projects"); assert.equal(id, "proj-1"); return existing; },
      assertLinkAvailable: async () => { throw new Error("should not be called when a link already exists"); },
    };
    const chatService = createChatService({ prisma, channelLinksService });
    const result = await chatService.createConversation({ companyId: MOCK_COMPANY_ID,
      authUserId: AUTH_USER_ID, type: "channel", title: "Proyecto X", memberUserIds: [],
      linkedModule: "atlas.projects", linkedEntityId: "proj-1",
    });
    assert.equal(result.id, CONV_ID);
  });

  it("propagates a 409 from assertLinkAvailable instead of creating a duplicate channel", async () => {
    const prisma = buildPrismaMock([[{ id: PROFILE_ID }]], []);
    const channelLinksService = {
      assertBothOrNeither: () => {},
      findByLink: async () => null,
      assertLinkAvailable: async () => { throw new ChatServiceError("Ese registro ya tiene un canal vinculado.", 409); },
    };
    const chatService = createChatService({ prisma, channelLinksService });
    await assert.rejects(
      () => chatService.createConversation({ companyId: MOCK_COMPANY_ID,
        authUserId: AUTH_USER_ID, type: "channel", title: "Proyecto X", memberUserIds: [],
        linkedModule: "atlas.projects", linkedEntityId: "proj-1",
      }),
      (err) => { assert.equal(err.status, 409); return true; },
    );
  });

  it("propagates a 422 from assertBothOrNeither when only linkedModule is provided, before touching prisma", async () => {
    const prisma = buildPrismaMock([], []); // no $queryRaw/$executeRaw calls expected — must fail before any DB access
    const channelLinksService = {
      assertBothOrNeither: () => { throw new ChatServiceError("linkedModule y linkedEntityId deben enviarse juntos.", 422); },
      findByLink: async () => { throw new Error("should not be called"); },
      assertLinkAvailable: async () => { throw new Error("should not be called"); },
    };
    const chatService = createChatService({ prisma, channelLinksService });
    await assert.rejects(
      () => chatService.createConversation({ companyId: MOCK_COMPANY_ID,
        authUserId: AUTH_USER_ID, type: "channel", title: "Proyecto X", memberUserIds: [],
        linkedModule: "atlas.projects",
      }),
      (err) => { assert.equal(err.status, 422); return true; },
    );
  });
});

describe("chat-service — updateConversation link/unlink", () => {
  it("links a channel to a project via applyLinkUpdate, called with the right updates/conversationId", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],       // getUserProfileId
        [{ id: "member-row" }],     // assertMember (in updateConversation)
        [{ type: "channel" }],      // conversation type lookup
        [{ id: "member-row" }],     // assertMember (again, inside the final getConversation call)
        [{ id: CONV_ID, members: null }], // getConversation's main SELECT
      ],
      [{ count: 1 }], // the UPDATE itself
    );
    let calledWith = null;
    const channelLinksService = {
      assertBothOrNeither: () => {},
      // Returns [] here deliberately — applyLinkUpdate's own fragment-building
      // is already covered by Step 0's tests; this test only verifies
      // updateConversation calls it correctly and handles the result.
      applyLinkUpdate: async (updates, conversationId) => {
        calledWith = { updates, conversationId };
        return [];
      },
    };
    const permissionsService = { assertChannelPermission: async () => {} };
    const chatService = createChatService({ prisma, permissionsService, channelLinksService });
    const result = await chatService.updateConversation({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID,
      updates: { linkedModule: "atlas.projects", linkedEntityId: "proj-1" },
    });
    assert.deepEqual(calledWith, { updates: { linkedModule: "atlas.projects", linkedEntityId: "proj-1" }, conversationId: CONV_ID });
    assert.equal(result.id, CONV_ID);
  });

  it("unlinks a channel by sending both link fields as null — applyLinkUpdate still gets called (it decides internally that no availability check is needed)", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],
        [{ id: "member-row" }],
        [{ type: "channel" }],
        [{ id: "member-row" }],
        [{ id: CONV_ID, members: null }],
      ],
      [{ count: 1 }],
    );
    let called = false;
    const channelLinksService = {
      assertBothOrNeither: () => {},
      applyLinkUpdate: async () => { called = true; return []; },
    };
    const permissionsService = { assertChannelPermission: async () => {} };
    const chatService = createChatService({ prisma, permissionsService, channelLinksService });
    const result = await chatService.updateConversation({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID,
      updates: { linkedModule: null, linkedEntityId: null },
    });
    assert.equal(called, true);
    assert.equal(result.id, CONV_ID);
  });

  it("propagates a 409 raised inside applyLinkUpdate (project already linked elsewhere)", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],
        [{ id: "member-row" }],
        [{ type: "channel" }],
      ],
      [],
    );
    const channelLinksService = {
      assertBothOrNeither: () => {},
      applyLinkUpdate: async () => { throw new ChatServiceError("Ese registro ya tiene un canal vinculado.", 409); },
    };
    const permissionsService = { assertChannelPermission: async () => {} };
    const chatService = createChatService({ prisma, permissionsService, channelLinksService });
    await assert.rejects(
      () => chatService.updateConversation({
        conversationId: CONV_ID, authUserId: AUTH_USER_ID,
        updates: { linkedModule: "atlas.projects", linkedEntityId: "proj-1" },
      }),
      (err) => { assert.equal(err.status, 409); return true; },
    );
  });

  it("propagates a 422 from assertBothOrNeither when only linkedEntityId is provided, before touching prisma beyond membership checks", async () => {
    const prisma = buildPrismaMock(
      [
        [{ id: PROFILE_ID }],   // getUserProfileId
        [{ id: "member-row" }], // assertMember
        [{ type: "channel" }],  // conversation type lookup
      ],
      [],
    );
    const channelLinksService = {
      assertBothOrNeither: () => { throw new ChatServiceError("linkedModule y linkedEntityId deben enviarse juntos.", 422); },
      applyLinkUpdate: async () => { throw new Error("should not be called"); },
    };
    const permissionsService = { assertChannelPermission: async () => {} };
    const chatService = createChatService({ prisma, permissionsService, channelLinksService });
    await assert.rejects(
      () => chatService.updateConversation({
        conversationId: CONV_ID, authUserId: AUTH_USER_ID,
        updates: { linkedEntityId: "proj-1" },
      }),
      (err) => { assert.equal(err.status, 422); return true; },
    );
  });
});

describe("chat-service — listMessages separates message-level and attachment-level reactions", () => {
  it("returns message-level reactions in `reactions` and per-attachment reactions nested in `attachments`", async () => {
    const msgId = "01900000-0000-7000-8000-00000000m005";
    const attId = "01900000-0000-7000-8000-00000000a001";
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [{ id: PROFILE_ID }], // assertMember lookup
      [
        {
          id: msgId,
          conversation_id: CONV_ID,
          sender_user_id: PROFILE_ID,
          sender_type: "user",
          body: null,
          message_type: "image",
          attachment_count: 1,
          metadata: {},
          created_at: new Date(),
          edited_at: null,
          deleted_at: null,
          pinned_at: null,
          pinned_by_user_id: null,
          thread_root_id: null,
          thread_reply_count: 0,
          thread_last_reply_at: null,
          sender: { id: PROFILE_ID, displayName: "Ada", avatarFileId: null },
          attachments: [
            { id: attId, fileName: "foto.jpg", mimeType: "image/jpeg", sizeBytes: 100, width: null, height: null, objectKey: "k", bucket: "runly-chat", reactions: [{ emoji: "\u{1F602}", userIds: [OTHER_PROFILE_ID] }] },
          ],
          reactions: [{ emoji: "\u{1F44D}", userIds: [PROFILE_ID] }],
        },
      ],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const result = await service.listMessages({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });
    assert.deepEqual(result.data[0].reactions, [{ emoji: "\u{1F44D}", userIds: [PROFILE_ID] }]);
    assert.deepEqual(result.data[0].attachments[0].reactions, [{ emoji: "\u{1F602}", userIds: [OTHER_PROFILE_ID] }]);
  });
});

describe("chat-service — deleteAttachment", () => {
  const ATT_ID = "01900000-0000-7000-8000-00000000a010";
  const MSG_ID = "01900000-0000-7000-8000-00000000m010";

  // A supabaseAdmin stub whose storage.from(bucket).remove(keys) records calls.
  function buildStorageStub() {
    const removed = [];
    return {
      removed,
      storage: {
        from(bucket) {
          return {
            async remove(keys) {
              removed.push({ bucket, keys });
              return { data: keys.map((k) => ({ name: k })), error: null };
            },
          };
        },
      },
    };
  }

  it("throws 404 when the attachment row doesn't exist", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], // resolveUserProfileId
      [],                    // attachment row lookup: no match
    ]);
    const service = createChatService({ prisma, supabaseAdmin: buildStorageStub() });
    await assert.rejects(
      () => service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
  });

  it("pending: uploader deletes the row and the storage object", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: ATT_ID, message_id: null, bucket: "runly-chat", object_key: "conversations/c/x.jpg", uploaded_by_user_id: PROFILE_ID }],
    ], [
      { count: 1 }, // DELETE FROM chat_attachments
    ]);
    const supabaseAdmin = buildStorageStub();
    const service = createChatService({ prisma, supabaseAdmin });
    const result = await service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID });
    assert.deepEqual(result, { ok: true, pending: true });
    assert.deepEqual(supabaseAdmin.removed, [{ bucket: "runly-chat", keys: ["conversations/c/x.jpg"] }]);
    assert.equal(prisma._executeRawCallCount, 1);
  });

  it("pending: a non-uploader gets 404 and nothing is deleted", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: ATT_ID, message_id: null, bucket: "runly-chat", object_key: "conversations/c/x.jpg", uploaded_by_user_id: OTHER_PROFILE_ID }],
    ]);
    const supabaseAdmin = buildStorageStub();
    const service = createChatService({ prisma, supabaseAdmin });
    await assert.rejects(
      () => service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
    assert.deepEqual(supabaseAdmin.removed, []);
    assert.equal(prisma._executeRawCallCount, 0);
  });

  it("sent: throws 404 when the caller isn't the message sender", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: ATT_ID, message_id: MSG_ID, bucket: "runly-chat", object_key: "k", uploaded_by_user_id: PROFILE_ID }],
      [], // message-context lookup: no row (not the sender / deleted)
    ]);
    const service = createChatService({ prisma, supabaseAdmin: buildStorageStub() });
    await assert.rejects(
      () => service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID }),
      (err) => err instanceof ChatServiceError && err.status === 404,
    );
  });

  it("sent: removes just the attachment, decrements attachment_count, deletes the object", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: ATT_ID, message_id: MSG_ID, bucket: "runly-chat", object_key: "k1", uploaded_by_user_id: PROFILE_ID }],
      [{ body: "mira esto", attachment_count: 3, metadata: {} }],
    ], [
      { count: 1 }, // DELETE FROM chat_attachments
      { count: 1 }, // UPDATE chat_messages SET attachment_count = ...
    ]);
    const supabaseAdmin = buildStorageStub();
    const service = createChatService({ prisma, supabaseAdmin });
    const result = await service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID });
    assert.deepEqual(result, { ok: true, messageDeleted: false });
    assert.deepEqual(supabaseAdmin.removed, [{ bucket: "runly-chat", keys: ["k1"] }]);
    assert.equal(prisma._executeRawCallCount, 2);
  });

  it("sent: soft-deletes the message when it's the last attachment with no body or entity refs, deletes the object", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: ATT_ID, message_id: MSG_ID, bucket: "runly-chat", object_key: "k2", uploaded_by_user_id: PROFILE_ID }],
      [{ body: "", attachment_count: 1, metadata: {} }],
    ], [
      { count: 1 }, // UPDATE chat_messages SET deleted_at = NOW()
      { count: 1 }, // DELETE FROM chat_attachments
    ]);
    const supabaseAdmin = buildStorageStub();
    const service = createChatService({ prisma, supabaseAdmin });
    const result = await service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID });
    assert.deepEqual(result, { ok: true, messageDeleted: true });
    assert.deepEqual(supabaseAdmin.removed, [{ bucket: "runly-chat", keys: ["k2"] }]);
  });

  it("sent: keeps the message when the last attachment leaves body text behind", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: ATT_ID, message_id: MSG_ID, bucket: "runly-chat", object_key: "k3", uploaded_by_user_id: PROFILE_ID }],
      [{ body: "no borres esto", attachment_count: 1, metadata: {} }],
    ], [
      { count: 1 },
      { count: 1 },
    ]);
    const service = createChatService({ prisma, supabaseAdmin: buildStorageStub() });
    const result = await service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID });
    assert.deepEqual(result, { ok: true, messageDeleted: false });
  });

  it("sent: keeps the message when the last attachment leaves an entity ref behind", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: ATT_ID, message_id: MSG_ID, bucket: "runly-chat", object_key: "k4", uploaded_by_user_id: PROFILE_ID }],
      [{ body: null, attachment_count: 1, metadata: { entityRefs: [{ entityType: "contact", recordId: "x" }] } }],
    ], [
      { count: 1 },
      { count: 1 },
    ]);
    const service = createChatService({ prisma, supabaseAdmin: buildStorageStub() });
    const result = await service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID });
    assert.deepEqual(result, { ok: true, messageDeleted: false });
  });

  it("swallows a storage-removal error and still deletes the row", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: ATT_ID, message_id: null, bucket: "runly-chat", object_key: "boom", uploaded_by_user_id: PROFILE_ID }],
    ], [
      { count: 1 },
    ]);
    const supabaseAdmin = {
      storage: { from: () => ({ remove: async () => ({ data: null, error: new Error("network") }) }) },
    };
    const service = createChatService({ prisma, supabaseAdmin });
    const result = await service.deleteAttachment({ attachmentId: ATT_ID, authUserId: AUTH_USER_ID });
    assert.deepEqual(result, { ok: true, pending: true });
    assert.equal(prisma._executeRawCallCount, 1);
  });
});

// ---------------------------------------------------------------------------
// Reply-to-message (inline quoted reply) — 2026-08-28
// ---------------------------------------------------------------------------
describe("chat-service — listMessages reply_to preview", () => {
  const MSG_A = "01900000-0000-7000-8000-0000000000a1"; // quoted original
  const MSG_B = "01900000-0000-7000-8000-0000000000b2"; // the reply

  function mainRow(overrides = {}) {
    return {
      id: MSG_B, conversation_id: CONV_ID, sender_user_id: PROFILE_ID, sender_guest_id: null,
      sender_type: "user", body: "de acuerdo", message_type: "text", attachment_count: 0,
      metadata: {}, created_at: new Date(), edited_at: null, deleted_at: null,
      pinned_at: null, pinned_by_user_id: null,
      thread_root_id: null, thread_reply_count: 0, thread_last_reply_at: null,
      reply_to_message_id: MSG_A, sender: null, attachments: null, reactions: null,
      ...overrides,
    };
  }

  it("attaches a resolved reply_to preview to a reply row", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],           // resolveUserProfileId
      [{ id: "member-row" }],         // assertMember
      [mainRow()],                    // listMessages main SELECT
      [                              // fetchReplyPreviewRows
        { id: MSG_A, sender_user_id: "01900000-0000-7000-8000-0000000000u9",
          body: "\u00bfVamos con A?", message_type: "text", deleted_at: null,
          sender_name: "Ana", attachment_mime: null, has_entity_refs: false },
      ],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const res = await service.listMessages({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });
    const reply = res.data.find((m) => m.id === MSG_B);
    assert.equal(reply.reply_to.id, MSG_A);
    assert.equal(reply.reply_to.senderName, "Ana");
    assert.equal(reply.reply_to.kind, "text");
    assert.equal(reply.reply_to.bodyPreview, "\u00bfVamos con A?");
  });

  it("sets reply_to to null when the row has no reply_to_message_id", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [mainRow({ reply_to_message_id: null })],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const res = await service.listMessages({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });
    assert.equal(res.data[0].reply_to, null);
  });

  it("returns a preview with isDeleted:true when the quoted original was soft-deleted", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [mainRow()],
      [
        { id: MSG_A, sender_user_id: "01900000-0000-7000-8000-0000000000u9",
          body: "original", message_type: "text", deleted_at: new Date(),
          sender_name: "Ana", attachment_mime: null, has_entity_refs: false },
      ],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const res = await service.listMessages({ conversationId: CONV_ID, authUserId: AUTH_USER_ID });
    assert.equal(res.data[0].reply_to.isDeleted, true);
    assert.equal(res.data[0].reply_to.kind, "deleted");
  });
});

describe("chat-service — sendMessage replyToMessageId", () => {
  const MSG_A = "01900000-0000-7000-8000-0000000000a1";
  const MSG_B = "01900000-0000-7000-8000-0000000000b2";

  it("rejects a reply target from another conversation with 400", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],                                  // resolveUserProfileId
      [{ id: "member-row" }],                                // assertMember
      [{ type: "direct" }],                                  // conversation type
      [],                                                    // assertNotBlocked: other members
      [{ id: MSG_A, conversation_id: "OTHER-CONV", deleted_at: null }], // reply target lookup
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "x", replyToMessageId: MSG_A }),
      (err) => err instanceof ChatServiceError && err.status === 400,
    );
  });

  it("rejects a soft-deleted reply target with 400", async () => {
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "direct" }],
      [],
      [{ id: MSG_A, conversation_id: CONV_ID, deleted_at: new Date() }],
    ]);
    const service = createChatService({ prisma, supabaseAdmin: {} });
    await assert.rejects(
      () => service.sendMessage({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "x", replyToMessageId: MSG_A }),
      (err) => err instanceof ChatServiceError && err.status === 400,
    );
  });

  it("persists reply_to_message_id in the INSERT when the target is valid", async () => {
    let insertSql = "";
    let qIdx = 0;
    const results = [
      [{ id: PROFILE_ID }],
      [{ id: "member-row" }],
      [{ type: "direct" }],
      [],
      [{ id: MSG_A, conversation_id: CONV_ID, deleted_at: null }],       // reply target OK
      [{ id: MSG_B, created_at: new Date(), reply_to_message_id: MSG_A }], // INSERT ... RETURNING *
      [{ id: MSG_B, sender: null, attachments: null, reactions: null, reply_to_message_id: MSG_A }], // getMessageFull SELECT
      [{ id: MSG_A, sender_user_id: "u9", body: "orig", message_type: "text", deleted_at: null,
         sender_name: "Ana", attachment_mime: null, has_entity_refs: false }], // fetchReplyPreviewRows
    ];
    const prisma = {
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes("INSERT INTO chat_messages")) insertSql = sql;
        return results[qIdx++];
      },
      $executeRaw: async () => ({ count: 1 }),
      $transaction: async (fn) => fn(prisma),
      membership: { findFirst: async () => null },
    };
    const service = createChatService({ prisma, supabaseAdmin: {} });
    const out = await service.sendMessage({
      conversationId: CONV_ID, authUserId: AUTH_USER_ID, body: "de acuerdo", replyToMessageId: MSG_A,
    });
    assert.ok(insertSql.includes("reply_to_message_id"), "INSERT should name reply_to_message_id");
    assert.equal(out.reply_to.id, MSG_A);
  });
});


describe('chat membership notifications', () => {
  it('notifies a newly added channel member through all channels before returning', async () => {
    const published = [];
    const prisma = buildPrismaMock([
      [{ id: PROFILE_ID }], [{ id: 'membership' }], [{ display_name: 'Invitado' }],
      [{ id: CONV_ID, company_id: MOCK_COMPANY_ID, type: 'channel', title: 'Equipo' }],
    ], [1, 1, 1]);
    const svc = createChatService({ prisma, notificationService: { publish: async args => published.push(args) } });
    const result = await svc.addMembers({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, userIds: [OTHER_PROFILE_ID, OTHER_PROFILE_ID] });
    assert.deepEqual(result.added, [OTHER_PROFILE_ID]);
    assert.equal(published.length, 1);
    assert.equal(published[0].companyId, MOCK_COMPANY_ID);
    assert.deepEqual(published[0].input.recipients.userIds, [OTHER_PROFILE_ID]);
    assert.deepEqual(published[0].input.channels, ['in_app', 'email', 'web_push']);
    assert.equal(published[0].input.link, `/app/m/runly.chat/chat/inbox/${CONV_ID}`);
  });
  it('does not notify or write a system message for an existing active member', async () => {
    const prisma = buildPrismaMock([[{ id: PROFILE_ID }], [{ id: 'membership' }]], [0]);
    const svc = createChatService({ prisma, notificationService: { publish: async () => assert.fail('must not publish') } });
    const result = await svc.addMembers({ conversationId: CONV_ID, authUserId: AUTH_USER_ID, userIds: [OTHER_PROFILE_ID] });
    assert.deepEqual(result.added, []);
    assert.equal(prisma._executeRawCallCount, 1);
  });
});


it('creating a channel notifies initial members but not its creator', async () => {
  const conv = { id: CONV_ID, company_id: MOCK_COMPANY_ID, type: 'channel', title: 'General' };
  const prisma = buildPrismaMock([[{ id: PROFILE_ID }], [conv], [{ id: 'member-row' }], [{ ...conv, members: null }]]);
  const published = [];
  const svc = createChatService({ prisma, notificationService: { publish: async args => published.push(args) } });
  await svc.createConversation({ companyId: MOCK_COMPANY_ID, authUserId: AUTH_USER_ID, type: 'channel', title: 'General', memberUserIds: [OTHER_PROFILE_ID] });
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].input.recipients.userIds, [OTHER_PROFILE_ID]);
});
