# Call spotlight polish, round 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four live-call UX issues found in `runly.chat`'s `calls/`: phone cameras look stretched in filmstrip tiles, guest chat is a throwaway side table instead of the real conversation, a screen-sharer's camera disappears, and there's no active-speaker indicator/priority.

**Architecture:** Backend: extend `chat_messages` with a `sender_call_guest_id` column and rewire the call-guest chat endpoint to write/read the real conversation instead of the ephemeral `call_message` table; retire the now-dead member-side ephemeral-chat routes/SDK methods. Frontend: teach `ParticipantTile`'s video renderer to detect portrait camera tracks and switch to `object-contain`; consolidate `SpotlightLayout`'s "who's in the strip" logic into the already-written-but-unused `spotlightStrip` helper (fixing the screen-share/camera split as part of that consolidation); add a small stateful "who's speaking" hook backed by a pure, debounced decision function.

**Tech Stack:** Hono (API), Prisma `$queryRaw` (raw SQL, no ORM models for `chat_messages`), React + LiveKit client (`livekit-client`), Node's built-in `node:test` runner.

Spec: `docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md`

---

## File Structure

**Backend**
- New: `prisma/migrations/20260923000000_chat_messages_call_guest_sender/migration.sql`
- Modify: `apps/api/src/routes/chat/chat-service.js` (sender resolution joins)
- Modify: `apps/api/src/routes/calls/call-messages-service.js` (rewrite `postGuestMessage`, drop member functions)
- Modify: `apps/api/src/routes/calls/call-guest-service.js` (`getGuestState` reads `chat_messages`)
- Modify: `apps/api/src/routes/calls/index.js` (drop member chat routes)
- Modify: `packages/sdk/src/domains/calls.js` (drop member chat methods)
- Modify: `apps/api/src/routes/calls/__tests__/call-messages-service.test.js`
- Modify: `apps/api/src/routes/calls/__tests__/call-guest-service.test.js`

**Frontend — chat unification**
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallChatPanel.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallRoom.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/GuestRoomChat.jsx`
- Delete: `apps/desktop/src/modules/runly.chat/calls/CallRoomChat.jsx`
- Delete: `apps/desktop/src/modules/runly.chat/calls/hooks/useCallRoomMessages.js`

**Frontend — aspect ratio**
- Modify: `apps/desktop/src/modules/runly.chat/calls/ParticipantTile.jsx`

**Frontend — screen+camera split (+ consolidation)**
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/callLayout.js`
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js`
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallRoomLayout.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/GuestCallRoom.jsx`

**Frontend — active speaker**
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/callLayout.js` (same file as above, separate task)
- New: `apps/desktop/src/modules/runly.chat/calls/hooks/useSpeakingOrder.js`
- Modify: `apps/desktop/src/modules/runly.chat/calls/ParticipantTile.jsx` (same file as aspect-ratio task, separate task)
- Modify: `apps/desktop/src/modules/runly.chat/calls/SpotlightLayout.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallRoomLayout.jsx`, `CallRoom.jsx`, `guest/GuestCallRoom.jsx` (wire `activeSpeakers` down)

---

## Task 1: Migration — `chat_messages.sender_call_guest_id`

**Files:**
- Create: `prisma/migrations/20260923000000_chat_messages_call_guest_sender/migration.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Attribute a chat message to a call guest (call_guest), distinct from the
-- existing sender_guest_id (chat_guest_sessions — the website-inbox guest).
-- See docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §10.
ALTER TABLE "chat_messages"
  ADD COLUMN "sender_call_guest_id" UUID REFERENCES "call_guest"("id") ON DELETE SET NULL;

CREATE INDEX "chat_messages_sender_call_guest_id_idx"
  ON "chat_messages" ("sender_call_guest_id")
  WHERE "sender_call_guest_id" IS NOT NULL;
```

- [ ] **Step 2: Apply it**

Run: `pnpm db:migrate`
Expected: `chat_messages_call_guest_sender` applies cleanly. If the dev Supabase instance is unreachable from this environment (IP not allowlisted), leave the file in place — the user applies it before deploying — and continue with the rest of this plan (later tasks' tests use a fake `prisma`, not a live DB).

- [ ] **Step 3: Commit**

```bash
git add prisma/migrations/20260923000000_chat_messages_call_guest_sender/migration.sql
git commit -m "feat(chat): add chat_messages.sender_call_guest_id for call-guest chat"
```

---

## Task 2: Resolve call-guest sender names in `chat-service.js`

Member-facing `ChatWindow` reads (`listMessages`, and the single-message `getMessageFull` used after every send) currently only resolve a sender's name via `user_profile`. Once call-guest messages land in `chat_messages` (Task 3), these two queries must also resolve a name from `call_guest`.

**Files:**
- Modify: `apps/api/src/routes/chat/chat-service.js`

- [ ] **Step 1: Add the COALESCE'd sender object (both `listMessages` and `getMessageFull` share this exact block — one `replace_all` edit)**

Find (appears twice, identical):
```js
        json_build_object(
          'id', up.id,
          'displayName', up.display_name,
          'avatarFileId', up.avatar_file_id::text
        ) AS sender,
```

Replace both occurrences with:
```js
        json_build_object(
          'id', COALESCE(up.id, cg.id),
          'displayName', COALESCE(up.display_name, cg.display_name),
          'avatarFileId', up.avatar_file_id::text
        ) AS sender,
```

- [ ] **Step 2: Add the `call_guest` join in `listMessages`**

Find:
```js
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      WHERE m.conversation_id = ${conversationId}
        AND m.thread_root_id IS NULL
```

Replace with:
```js
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      LEFT JOIN call_guest cg ON cg.id = m.sender_call_guest_id
      WHERE m.conversation_id = ${conversationId}
        AND m.thread_root_id IS NULL
```

- [ ] **Step 3: Add the `call_guest` join in `getMessageFull`**

Find:
```js
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      WHERE m.id = ${messageId}
      LIMIT 1
```

Replace with:
```js
      FROM chat_messages m
      LEFT JOIN user_profile up ON up.id = m.sender_user_id
      LEFT JOIN call_guest cg ON cg.id = m.sender_call_guest_id
      WHERE m.id = ${messageId}
      LIMIT 1
```

- [ ] **Step 4: Run the existing chat service tests to confirm no regression**

Run: `node --test apps/api/src/routes/chat/__tests__/chat-service.test.js`
Expected: PASS (these tests use `sender_type: "user"` fixtures — `cg.id`/`cg.display_name` are simply `NULL` for those rows in a real DB, and the tests mock `$queryRaw` directly so the extra `LEFT JOIN` text doesn't change any assertion).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/chat/chat-service.js
git commit -m "feat(chat): resolve call-guest sender name/id in message reads"
```

---

## Task 3: Rewrite `postGuestMessage` against `chat_messages`

Mirrors the existing pattern in `apps/api/src/routes/calls/call-service.js`'s `postSystemMessage` (insert → bump `chat_conversations.last_message_*` → broadcast `chat.message.new` to real members). `postMemberMessage`, `listMessages`, and `listMessagesGuarded` become dead code (members now always use the real chat endpoints via `ChatWindow` — Task 8) and are removed.

**Files:**
- Modify: `apps/api/src/routes/calls/call-messages-service.js`
- Test: `apps/api/src/routes/calls/__tests__/call-messages-service.test.js`

- [ ] **Step 1: Write the failing tests (full rewrite of the test file)**

```js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCallMessagesService, CallMessageError } from "../call-messages-service.js";

const CALL = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

function sql(s) {
  return String(Array.isArray(s) ? s.join("?") : s);
}

describe("createCallMessagesService.postGuestMessage", () => {
  it("rejects an empty body", async () => {
    const svc = createCallMessagesService({ prisma: {} });
    await assert.rejects(svc.postGuestMessage({ guestToken: "gt", body: "   " }),
      (e) => e instanceof CallMessageError && e.status === 422);
  });

  it("rejects a >4000 char body", async () => {
    const svc = createCallMessagesService({ prisma: {} });
    await assert.rejects(svc.postGuestMessage({ guestToken: "gt", body: "x".repeat(4001) }),
      (e) => e instanceof CallMessageError);
  });

  it("refuses a guest that is not ADMITTED", async () => {
    const guestService = { resolveAdmittedGuestForMessage: async () => { throw new CallMessageError("no", 403); } };
    const svc = createCallMessagesService({ prisma: {}, guestService });
    await assert.rejects(svc.postGuestMessage({ guestToken: "gt", body: "hi" }), (e) => e.status === 403);
  });

  it("inserts into chat_messages with sender_call_guest_id, bumps the conversation, and broadcasts to real members", async () => {
    let insertedText = null;
    let insertedValues = null;
    let updatedConversation = null;
    let broadcastArgs = null;
    const createdAt = new Date("2026-09-23T10:00:00.000Z");
    const prisma = {
      $queryRaw: async (strings, ...values) => {
        const text = sql(strings);
        if (text.includes('FROM "call"')) return [{ id: CALL, conversationId: CONV, status: "ACTIVE" }];
        if (text.includes("INSERT INTO chat_messages")) {
          insertedText = text;
          insertedValues = values;
          return [{ id: "m1", created_at: createdAt }];
        }
        if (text.includes("SELECT user_id FROM chat_conversation_members")) {
          return [{ user_id: "member-1" }, { user_id: "member-2" }];
        }
        return [];
      },
      $executeRaw: async (strings, ...values) => {
        if (sql(strings).includes("UPDATE chat_conversations")) updatedConversation = values;
        return 1;
      },
    };
    const guestService = {
      resolveAdmittedGuestForMessage: async () => ({ guestId: "g1", callId: CALL, displayName: "Vis" }),
    };
    const broadcaster = {
      broadcastToUsers: async (userIds, event, payload) => { broadcastArgs = { userIds, event, payload }; },
    };
    const svc = createCallMessagesService({ prisma, guestService, broadcaster });

    const out = await svc.postGuestMessage({ guestToken: "gt", body: "  hola  " });

    // 'guest' is a literal in the SQL text (not a ${} placeholder, same style
    // as call-service.js's postSystemMessage), so it shows up in the joined
    // template text, not in the interpolated values array.
    assert.ok(insertedText.includes("'guest'"));
    assert.deepEqual(insertedValues, [CONV, "g1", "hola"]);
    assert.equal(updatedConversation[0], "m1");
    assert.deepEqual(broadcastArgs.userIds, ["member-1", "member-2"]);
    assert.equal(broadcastArgs.event, "chat.message.new");
    assert.equal(broadcastArgs.payload.conversationId, CONV);
    assert.equal(broadcastArgs.payload.senderName, "Vis");
    assert.equal(out.message.id, "m1");
    assert.equal(out.message.senderKind, "guest");
    assert.equal(out.message.senderName, "Vis");
    assert.equal(out.message.body, "hola");
  });

  it("does not throw if there is no broadcaster configured", async () => {
    const prisma = {
      $queryRaw: async (strings) => {
        const text = sql(strings);
        if (text.includes('FROM "call"')) return [{ id: CALL, conversationId: CONV, status: "ACTIVE" }];
        if (text.includes("INSERT INTO chat_messages")) return [{ id: "m2", created_at: new Date() }];
        return [];
      },
      $executeRaw: async () => 1,
    };
    const guestService = {
      resolveAdmittedGuestForMessage: async () => ({ guestId: "g1", callId: CALL, displayName: "Vis" }),
    };
    const svc = createCallMessagesService({ prisma, guestService });
    const out = await svc.postGuestMessage({ guestToken: "gt", body: "hola" });
    assert.equal(out.message.id, "m2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test apps/api/src/routes/calls/__tests__/call-messages-service.test.js`
Expected: FAIL (current `postGuestMessage` still calls `prisma.callMessage.create`, and `postMemberMessage`/`listMessages`/`listMessagesGuarded` describe blocks from the old file are gone from this new file so there's nothing left referencing them — the failures come from the new assertions on `chat_messages`/broadcast behavior not yet implemented).

- [ ] **Step 3: Rewrite `call-messages-service.js`**

```js
export class CallMessageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CallMessageError";
    this.status = status;
  }
}

const MAX_BODY = 4000;

function cleanBody(body) {
  const b = String(body ?? "").trim();
  if (!b) throw new CallMessageError("El mensaje no puede estar vacío.", 422);
  if (b.length > MAX_BODY) throw new CallMessageError("El mensaje es demasiado largo.", 422);
  return b;
}

export function createCallMessagesService({ prisma, guestService = null, broadcaster = null }) {
  async function loadCall(callId) {
    const rows = await prisma.$queryRaw`
      SELECT id, conversation_id AS "conversationId", status FROM "call" WHERE id = ${callId} LIMIT 1
    `;
    if (!rows.length) throw new CallMessageError("Llamada no encontrada.", 404);
    return rows[0];
  }

  function shape(m) {
    return {
      id: m.id,
      senderKind: m.senderKind,
      senderName: m.senderName,
      senderUserId: m.senderUserId ?? null,
      body: m.body,
      createdAt: m.createdAt,
    };
  }

  // Posts a call guest's chat message into the call's real conversation
  // (chat_messages) — the same conversation members see in runly.chat. See
  // docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md
  // §8.2. Mirrors the insert+bump+broadcast pattern already used for call
  // system messages in call-service.js's postSystemMessage.
  async function postGuestMessage({ guestToken, body }) {
    const clean = cleanBody(body);
    if (!guestService?.resolveAdmittedGuestForMessage) throw new CallMessageError("No disponible.", 500);
    const { guestId, callId, displayName: name } = await guestService.resolveAdmittedGuestForMessage({ guestToken });
    const call = await loadCall(callId);

    const rows = await prisma.$queryRaw`
      INSERT INTO chat_messages (conversation_id, sender_type, sender_call_guest_id, body)
      VALUES (${call.conversationId}, 'guest', ${guestId}, ${clean})
      RETURNING id, created_at
    `;
    const messageId = rows[0].id;
    const createdAt = rows[0].created_at;

    await prisma.$executeRaw`
      UPDATE chat_conversations
      SET last_message_id = ${messageId}, last_message_at = ${createdAt}, updated_at = NOW()
      WHERE id = ${call.conversationId}
    `;

    if (broadcaster) {
      const members = await prisma.$queryRaw`
        SELECT user_id FROM chat_conversation_members
        WHERE conversation_id = ${call.conversationId} AND left_at IS NULL AND user_id IS NOT NULL
      `;
      const memberIds = members.map((r) => r.user_id).filter(Boolean);
      if (memberIds.length) {
        await broadcaster.broadcastToUsers(memberIds, "chat.message.new", {
          conversationId: call.conversationId,
          messageId,
          senderId: null,
          senderName: name,
          threadRootId: null,
          replyToMessageId: null,
        }).catch(() => {});
      }
    }

    return { message: shape({ id: messageId, senderKind: "guest", senderName: name, senderUserId: null, body: clean, createdAt }) };
  }

  return { postGuestMessage };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test apps/api/src/routes/calls/__tests__/call-messages-service.test.js`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/calls/call-messages-service.js apps/api/src/routes/calls/__tests__/call-messages-service.test.js
git commit -m "feat(calls): persist guest chat messages into the real conversation"
```

---

## Task 4: `getGuestState` reads chat history from `chat_messages`

**Files:**
- Modify: `apps/api/src/routes/calls/call-guest-service.js`
- Test: `apps/api/src/routes/calls/__tests__/call-guest-service.test.js`

- [ ] **Step 1: Update the test fake to serve `chat_messages` reads and drop the now-unused `callMessage` fake**

In `apps/api/src/routes/calls/__tests__/call-guest-service.test.js`, find (inside the `getGuestState` describe block's `svcFor` helper):

```js
      callMessage: { findMany: async () => [] },
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes('FROM "call"')) return callRow ? [callRow] : [];
        return [];
      },
```

Replace with:

```js
      $queryRaw: async (strings) => {
        const sql = Array.isArray(strings) ? strings.join("?") : String(strings);
        if (sql.includes('FROM "call"')) return callRow ? [callRow] : [];
        if (sql.includes("FROM chat_messages")) return [];
        return [];
      },
```

- [ ] **Step 2: Add a test asserting the new query shape**

Add this test inside the same `describe("createCallGuestService.getGuestState", ...)` block, after the existing four tests:

```js
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
```

- [ ] **Step 3: Run to verify the new test fails**

Run: `node --test apps/api/src/routes/calls/__tests__/call-guest-service.test.js`
Expected: FAIL on the new test — `getGuestState` still queries `prisma.callMessage.findMany`, so `queriedChatMessages` stays `false`.

- [ ] **Step 4: Update `getGuestState` in `call-guest-service.js`**

Find:
```js
    let roster = [];
    let messages = [];
    if (live && guest.status === "ADMITTED") {
      const guests = await prisma.callGuest.findMany({
        where: { callId: guest.callId, status: { in: ["ADMITTED"] } },
        select: { id: true, displayName: true },
      });
      roster = guests.map((g) => ({ name: g.displayName, isYou: g.id === guest.id }));
      const rows = await prisma.callMessage.findMany({
        where: { callId: guest.callId },
        orderBy: { createdAt: "asc" }, take: 200,
        select: { id: true, senderKind: true, senderName: true, body: true, createdAt: true },
      });
      messages = rows;
    }
```

Replace with:
```js
    let roster = [];
    let messages = [];
    if (live && guest.status === "ADMITTED") {
      const guests = await prisma.callGuest.findMany({
        where: { callId: guest.callId, status: { in: ["ADMITTED"] } },
        select: { id: true, displayName: true },
      });
      roster = guests.map((g) => ({ name: g.displayName, isYou: g.id === guest.id }));
      // Full history of the call's real conversation (not call-scoped) — see
      // docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §8.2.
      messages = await prisma.$queryRaw`
        SELECT
          m.id,
          m.sender_type AS "senderKind",
          COALESCE(up.display_name, cg.display_name) AS "senderName",
          m.body,
          m.created_at AS "createdAt"
        FROM chat_messages m
        LEFT JOIN user_profile up ON up.id = m.sender_user_id
        LEFT JOIN call_guest cg ON cg.id = m.sender_call_guest_id
        WHERE m.conversation_id = ${call.conversationId} AND m.deleted_at IS NULL
        ORDER BY m.created_at ASC
        LIMIT 200
      `;
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test apps/api/src/routes/calls/__tests__/call-guest-service.test.js`
Expected: PASS (all tests in the file, including the new one).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/calls/call-guest-service.js apps/api/src/routes/calls/__tests__/call-guest-service.test.js
git commit -m "feat(calls): guest chat poll reads full conversation history from chat_messages"
```

---

## Task 5: Retire the member-side ephemeral chat routes and SDK methods

**Files:**
- Modify: `apps/api/src/routes/calls/index.js`
- Modify: `packages/sdk/src/domains/calls.js`

- [ ] **Step 1: Remove the two member chat routes**

In `apps/api/src/routes/calls/index.js`, find:
```js
  // ---- call-room chat (members) ----
  internal.get("/:callId/messages", async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param("callId"));
      const sinceId = c.req.query("sinceId") || null;
      return c.json({ data: await messagesService.listMessagesGuarded({ profileId: await profileId(c), callId, sinceId }) });
    } catch (error) { return handleError(c, error, "Error obteniendo mensajes."); }
  });
  internal.post("/:callId/messages", async (c) => {
    try {
      const callId = callIdSchema.parse(c.req.param("callId"));
      const { body } = callRoomMessageSchema.parse(await c.req.json());
      return c.json({ data: await messagesService.postMemberMessage({ profileId: await profileId(c), callId, body }) });
    } catch (error) { return handleError(c, error, "Error enviando el mensaje."); }
  });

```
Delete this whole block (the two routes and the comment above them — leave the blank line pattern consistent with the surrounding code).

- [ ] **Step 2: Check for now-unused imports in `index.js`**

Run: `grep -n "callRoomMessageSchema" apps/api/src/routes/calls/index.js`
Expected: no remaining references. If none, remove `callRoomMessageSchema` from the import line at the top of the file (it stays imported in `guest-routes.js`, which is a separate module — do not touch that import).

- [ ] **Step 3: Remove the member chat SDK methods**

In `packages/sdk/src/domains/calls.js`, find:
```js
    // --- call-room chat (members) ---
    listMessages: (callId, sinceId, token) =>
      request(
        `/calls/${encodeURIComponent(callId)}/messages${sinceId ? `?sinceId=${encodeURIComponent(sinceId)}` : ""}`,
        { headers: withAuthHeaders(token) },
      ),
    sendMessage: (callId, body, token) => json(`/calls/${callId}/messages`, "POST", { body }, token),

```
Delete this block entirely (the guest methods right below, under `guest: { ... }`, are untouched).

- [ ] **Step 4: Verify nothing else references the removed SDK methods**

Run: `grep -rn "runly.calls.listMessages\|runly.calls.sendMessage" apps/desktop/src apps/api/src packages`
Expected: no matches (the only prior caller, `useCallRoomMessages.js`, is deleted in Task 9).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/calls/index.js packages/sdk/src/domains/calls.js
git commit -m "chore(calls): remove dead member-side ephemeral chat routes and SDK methods"
```

---

## Task 6: `CallChatPanel.jsx` — always the real conversation

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallChatPanel.jsx`

- [ ] **Step 1: Read the current file** (already read above — 70 lines) and rewrite it to drop `roomMode`/`callId`/`liveIncoming`/`publishData` and the `isRoom` branch entirely:

```jsx
import { Loader2 } from "lucide-react";
import "../chat-theme.css";
import {
  ChatPreferencesProvider,
  useChatPreferences,
  chatPreferencesStyle,
} from "../hooks/useChatPreferences";
import { useChatConversationDetail } from "../hooks/useChatConversationDetail";
import { ChatWindow } from "../components/ChatWindow";

function unwrap(response) {
  return response?.data ?? response;
}

// The in-call chat surface — always the real ChatWindow bound to the call's
// conversation (call-trimmed header), for members and for calls with guests
// alike. Guest messages land in this same conversation (see
// docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md
// §8.2) — there is no separate ephemeral mode anymore. Placement / show-hide
// is the caller's job; this component owns theming.
export function CallChatPanel({ conversationId, onClose }) {
  return (
    <ChatPreferencesProvider>
      <CallChatPanelInner conversationId={conversationId} onClose={onClose} />
    </ChatPreferencesProvider>
  );
}

function CallChatPanelInner({ conversationId, onClose }) {
  const { prefs } = useChatPreferences();
  const { data, isLoading, isError } = useChatConversationDetail(conversationId);
  const conversation = unwrap(data);

  return (
    <div
      className="chat-glass-theme flex h-full w-full min-h-0 flex-col overflow-hidden bg-[hsl(var(--background))] text-[hsl(var(--foreground))]"
      style={chatPreferencesStyle(prefs)}
    >
      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-[hsl(var(--muted-foreground))]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : isError || !conversation ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
          No se pudo cargar el chat de la llamada.
        </div>
      ) : (
        <ChatWindow conversation={conversation} embedded="call" onCollapse={onClose} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit** (deferred to the end of Task 7, since Task 7 updates the only caller — committing both together avoids a broken intermediate state)

---

## Task 7: `CallRoom.jsx` — always mount the real chat panel

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallRoom.jsx`

- [ ] **Step 1: Simplify the `chatPanelNode` construction**

Find (around line 540):
```js
  const chatPanelNode =
    !isMobile || mobileView === "chat"
      ? (
        <CallChatPanel
          conversationId={conversationId}
          onClose={handleChatClose}
          roomMode={hasGuests ? "call" : "conversation"}
          callId={session.call.id}
          liveIncoming={liveMessages}
          publishData={publishData}
        />
      )
      : null;
```

Replace with:
```js
  const chatPanelNode =
    !isMobile || mobileView === "chat"
      ? <CallChatPanel conversationId={conversationId} onClose={handleChatClose} />
      : null;
```

- [ ] **Step 2: Check whether `liveMessages`/`publishData`/`hasGuests` are still used elsewhere in the file**

Run: `grep -n "liveMessages\|publishData\|hasGuests" apps/desktop/src/modules/runly.chat/calls/CallRoom.jsx`

Expected and required to stay (do NOT remove these — they're used elsewhere):
- `publishData` is the generic LiveKit data-channel publisher, used by `ephemeral` (reactions/raise-hand) — keep its declaration and the `publishData` callback.
- `hasGuests` still gates `CallGuestSheet`/roster visibility and the `AloneWarningDialog`'s eligibility — keep it.
- `liveMessages`/`setLiveMessages` and the `handleData` listener inside the big `RoomEvent` effect (`if (msg?.type !== "chat") return; setLiveMessages(...)`) become dead now that no chat consumer reads `liveMessages` — remove `const [liveMessages, setLiveMessages] = useState([]);` and the `handleData`/`RoomEvent.DataReceived` wiring (the `if (msg?.type !== "chat") return;` branch and its body) **only if** `grep` confirms nothing else in the file reads `liveMessages`.

- [ ] **Step 3: Remove the now-dead chat data-channel handling** (only if Step 2 confirmed it's unused)

Find:
```js
    const handleData = (payload, participant) => {
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload));
        if (msg?.type !== "chat") return;
        setLiveMessages((prev) => [...prev.slice(-199), {
          body: msg.body,
          senderName: msg.senderName,
          senderKind: msg.senderKind
            ?? (participant?.identity?.startsWith?.("guest_") ? "guest" : "user"),
          createdAt: msg.createdAt ?? new Date().toISOString(),
        }]);
      } catch { /* not a chat data packet */ }
    };
    events.forEach((event) => room.on(event, refresh));
    room.on(RoomEvent.DataReceived, handleData);
```

Replace with:
```js
    events.forEach((event) => room.on(event, refresh));
```

And find the matching cleanup:
```js
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
      room.off(RoomEvent.DataReceived, handleData);
      room.disconnect();
```
Replace with:
```js
      room.off(RoomEvent.LocalTrackUnpublished, handleLocalTrackUnpublished);
      room.disconnect();
```

And remove the state declaration:
```js
  const [liveMessages, setLiveMessages] = useState([]);
```

- [ ] **Step 4: Build to confirm no leftover references**

Run: `pnpm --filter @runly/desktop build` (or `pnpm build` if the desktop package has no isolated build script — check `apps/desktop/package.json` `scripts` first with `grep -n '"build"' apps/desktop/package.json` and use whichever the project defines)
Expected: no errors, no "unused variable" build failures, no reference to `roomMode`/`liveMessages`/`CallRoomChat`.

- [ ] **Step 5: Commit (covers Task 6 + Task 7 together)**

```bash
git add apps/desktop/src/modules/runly.chat/calls/CallChatPanel.jsx apps/desktop/src/modules/runly.chat/calls/CallRoom.jsx
git commit -m "feat(calls): always show the real conversation chat in-call, guests included"
```

---

## Task 8: Retire the member-side ephemeral chat components

**Files:**
- Delete: `apps/desktop/src/modules/runly.chat/calls/CallRoomChat.jsx`
- Delete: `apps/desktop/src/modules/runly.chat/calls/hooks/useCallRoomMessages.js`

- [ ] **Step 1: Confirm nothing still imports them**

Run: `grep -rn "CallRoomChat\|useCallRoomMessages" apps/desktop/src`
Expected: only the two files' own definitions (no importers — `CallChatPanel.jsx` stopped importing `CallRoomChat` in Task 6).

- [ ] **Step 2: Delete both files**

```bash
git rm apps/desktop/src/modules/runly.chat/calls/CallRoomChat.jsx apps/desktop/src/modules/runly.chat/calls/hooks/useCallRoomMessages.js
```

- [ ] **Step 3: Confirm `RoomChatView`/`mergeRoomMessages` are still used (they must NOT be deleted — `GuestRoomChat.jsx` still needs them)**

Run: `grep -rn "RoomChatView\|mergeRoomMessages" apps/desktop/src/modules/runly.chat/calls`
Expected: `GuestRoomChat.jsx` and `lib/roomChat.js`/`lib/__tests__/roomChat.test.js` still present and referencing each other — leave all three untouched.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(calls): remove the member-side ephemeral call-room chat components"
```

---

## Task 9: Update the guest chat notice copy

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/GuestRoomChat.jsx`

- [ ] **Step 1: Update the notice text** — it's no longer ephemeral, so the copy claiming otherwise must go

Find:
```jsx
      notice="Chat de la llamada — solo visible aquí."
```
Replace with:
```jsx
      notice="Chat de la llamada."
```

- [ ] **Step 2: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/calls/guest/GuestRoomChat.jsx
git commit -m "fix(calls): correct guest chat notice copy now that it's persisted"
```

---

## Task 10: Aspect-ratio-aware `fit` for camera tiles

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/ParticipantTile.jsx`

- [ ] **Step 1: Rewrite `TrackRenderer` to detect portrait video and expose the effective fit as a small pure helper**

Find:
```jsx
function TrackRenderer({ participant, source, muted = false, mirror = false, fit = "cover" }) {
  const elementRef = useRef(null);
  const publication = participant?.getTrackPublication?.(source);
  const track = publication?.track;

  useEffect(() => {
    const element = elementRef.current;
    if (!track || !element) return undefined;
    track.attach(element);
    return () => track.detach(element);
  }, [track]);

  if (!track || publication?.isMuted) return null;
  return (
    // react-doctor-disable-next-line media-has-caption -- LiveKit attaches a video-only WebRTC track; remote audio is rendered separately.
    <video
      ref={elementRef}
      autoPlay
      playsInline
      muted={muted}
      className={`h-full w-full ${fit === "contain" ? "object-contain" : "object-cover"} ${mirror ? "-scale-x-100" : ""}`}
    />
  );
}
```

Replace with:
```jsx
// A caller-requested "auto" fit means cover for camera, contain for screen
// (see the `fit` prop doc on ParticipantTile below). But a portrait phone
// camera forced to `cover` in a landscape tile crops so aggressively it reads
// as distorted — so for camera tracks specifically, "auto" is resolved at
// render time from the track's own decoded dimensions instead of a fixed
// default. See
// docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §8.1.
function resolveAutoFit(isPortrait) {
  return isPortrait ? "contain" : "cover";
}

function TrackRenderer({ participant, source, muted = false, mirror = false, fit = "cover" }) {
  const elementRef = useRef(null);
  const publication = participant?.getTrackPublication?.(source);
  const track = publication?.track;
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!track || !element) return undefined;
    track.attach(element);
    const checkOrientation = () => {
      if (element.videoWidth && element.videoHeight) {
        setIsPortrait(element.videoHeight > element.videoWidth);
      }
    };
    checkOrientation();
    element.addEventListener("loadedmetadata", checkOrientation);
    element.addEventListener("resize", checkOrientation);
    return () => {
      element.removeEventListener("loadedmetadata", checkOrientation);
      element.removeEventListener("resize", checkOrientation);
      track.detach(element);
    };
  }, [track]);

  if (!track || publication?.isMuted) return null;
  const effectiveFit = fit === "auto" ? resolveAutoFit(isPortrait) : fit;
  return (
    // react-doctor-disable-next-line media-has-caption -- LiveKit attaches a video-only WebRTC track; remote audio is rendered separately.
    <video
      ref={elementRef}
      autoPlay
      playsInline
      muted={muted}
      className={`h-full w-full ${effectiveFit === "contain" ? "object-contain" : "object-cover"} ${mirror ? "-scale-x-100" : ""}`}
    />
  );
}
```

- [ ] **Step 2: Add the `useState` import**

Find (top of file):
```jsx
import { useEffect, useRef } from "react";
```
Replace with:
```jsx
import { useEffect, useRef, useState } from "react";
```

- [ ] **Step 3: Pass `"auto"` through instead of pre-resolving it for camera tiles**

Find, inside `ParticipantTile`:
```jsx
      {hasVideo ? (
        <TrackRenderer
          participant={participant}
          source={source}
          muted={isLocal}
          fit={fit === "contain" || isScreen ? "contain" : "cover"}
          mirror={isLocal && source === Track.Source.Camera && mirrorLocalCamera}
        />
```
Replace with:
```jsx
      {hasVideo ? (
        <TrackRenderer
          participant={participant}
          source={source}
          muted={isLocal}
          fit={fit === "contain" || isScreen ? "contain" : "auto"}
          mirror={isLocal && source === Track.Source.Camera && mirrorLocalCamera}
        />
```

This preserves every existing explicit-`contain` caller (the main spotlight tile, `DirectFocusLayout`'s main tile, screen shares) exactly as-is, and only changes what used to be a hardcoded `"cover"` fallback — the strip tiles, the grid's 3+ tiles, and the `DraggablePip` — into the new orientation-aware `"auto"`.

- [ ] **Step 4: Manual verification** (no automated test for this — it depends on real decoded video metadata, which `node:test` cannot simulate; this is consistent with the spec's own verification plan, §26)

Run: `pnpm dev`, join a call from a real phone in portrait orientation and from a desktop browser at the same time from a third participant's view (or two browser tabs, one with a virtual portrait camera via DevTools device emulation + a fake portrait webcam) — confirm the phone's tile in the filmstrip is letterboxed/centered, not aggressively cropped, and the desktop tile is unchanged.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/calls/ParticipantTile.jsx
git commit -m "fix(calls): letterbox portrait camera tracks in filmstrip/grid/PiP tiles"
```

---

## Task 11: `spotlightStrip` keeps the screen-sharer's camera in the strip

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/callLayout.js`
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js`

- [ ] **Step 1: Read the current test file** to see existing fixtures/style

Run: `cat apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js` (or open it) before editing, so new tests match the existing fixture shape (`{ participant: { identity } }` entries).

- [ ] **Step 2: Add the failing test**

Add this test inside the existing `describe("spotlightStrip", ...)` block:

```js
  it("keeps the screen-sharer's own camera as a strip tile when their screen is the spotlight", () => {
    const sharer = { participant: { identity: "a" } };
    const other = { participant: { identity: "b" } };
    const parts = [sharer, other];
    const screenA = { participant: { identity: "a" }, hasCamera: true };
    const out = spotlightStrip({ participants: parts, pinnedIdentity: null, screenShareEntry: screenA });
    assert.equal(out.mainEntry, screenA);
    // "b"'s camera tile plus "a"'s own camera tile (their screen is the main,
    // but their camera — if live — still shows up as an independent strip tile).
    const identities = out.others.map((e) => e.participant.identity);
    assert.deepEqual(identities.sort(), ["a", "b"]);
    assert.equal(out.showScreenTile, false);
  });

  it("does not add an extra tile for the sharer when they have no live camera", () => {
    const sharer = { participant: { identity: "a" } };
    const other = { participant: { identity: "b" } };
    const parts = [sharer, other];
    const screenA = { participant: { identity: "a" }, hasCamera: false };
    const out = spotlightStrip({ participants: parts, pinnedIdentity: null, screenShareEntry: screenA });
    const identities = out.others.map((e) => e.participant.identity);
    assert.deepEqual(identities, ["b"]);
  });
```

- [ ] **Step 3: Run to verify it fails**

Run: `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js`
Expected: FAIL on the first new test — today's `spotlightStrip` excludes `"a"` from `others` entirely regardless of `hasCamera`.

- [ ] **Step 4: Implement — `spotlightStrip` accepts a `hasCamera` flag on `screenShareEntry` and, when the sharer is the main tile, adds their camera as a strip entry**

Find:
```js
// Given the participant entries and the local pin, return the spotlight layout:
// the main tile, the strip (everyone else), and whether the screen share needs
// its own strip tile (present and not already the main).
export function spotlightStrip({ participants = [], pinnedIdentity = null, screenShareEntry = null }) {
  const mainEntry = resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry);
  if (!mainEntry) return { mainEntry: null, others: [], showScreenTile: false };
  const mainId = mainEntry.participant?.identity;
  const others = participants.filter((e) => e.participant?.identity !== mainId);
  const mainIsSharing = Boolean(screenShareEntry && screenShareEntry.participant?.identity === mainId);
  return { mainEntry, others, showScreenTile: Boolean(screenShareEntry) && !mainIsSharing };
}
```

Replace with:
```js
// Given the participant entries and the local pin, return the spotlight layout:
// the main tile, the strip (everyone else), and whether the screen share needs
// its own strip tile (present and not already the main).
//
// Camera and screen share are independent LiveKit tracks for the same
// participant — when that participant's screen is the spotlight (automatic,
// no manual pin), their own camera (if live) still gets a strip tile instead
// of disappearing. `screenShareEntry.hasCamera` tells us whether to add it —
// callers compute this from the sharer's own Track.Source.Camera publication.
// See docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §8.3.
export function spotlightStrip({ participants = [], pinnedIdentity = null, screenShareEntry = null }) {
  const mainEntry = resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry);
  if (!mainEntry) return { mainEntry: null, others: [], showScreenTile: false };
  const mainId = mainEntry.participant?.identity;
  const mainIsSharing = Boolean(screenShareEntry && screenShareEntry.participant?.identity === mainId);
  const others = participants.filter((e) => {
    if (e.participant?.identity !== mainId) return true;
    return mainIsSharing && Boolean(screenShareEntry?.hasCamera);
  });
  return { mainEntry, others, showScreenTile: Boolean(screenShareEntry) && !mainIsSharing };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js`
Expected: PASS (all tests, including the pre-existing ones — the `others` filter for the non-sharing-main case is unchanged, and every existing test's `screenShareEntry` fixture without `hasCamera` behaves as `hasCamera: undefined` → falsy → identical to today's behavior).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/calls/lib/callLayout.js apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js
git commit -m "fix(calls): keep the screen-sharer's camera as an independent strip tile"
```

---

## Task 12: Wire `spotlightStrip` into `CallRoomLayout.jsx` and `GuestCallRoom.jsx` (fixes the dead-code drift + delivers Task 11's fix)

Both files currently compute `others` with their own inline `.filter()` instead of calling `spotlightStrip` (which was written for exactly this in the 2026-09-22 spec but never actually wired up — confirmed by `spotlightStrip` having zero non-test callers before this task). Consolidating onto one tested function removes the duplication and is what makes Task 11's fix take effect in the app.

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallRoomLayout.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/GuestCallRoom.jsx`

- [ ] **Step 1: `CallRoomLayout.jsx` — compute `hasCamera` for the screen-share entry and use `spotlightStrip`**

Find:
```js
import { resolveSpotlightMain } from "./lib/callLayout";
```
Replace with:
```js
import { spotlightStrip } from "./lib/callLayout";
```

Find:
```js
  // The spotlight main: a still-valid manual pin, or (with no pin) whoever is
  // screen-sharing — see resolveSpotlightMain in lib/callLayout.js. Null
  // means "no spotlight": 1:1 falls to DirectFocusLayout, everything else to
  // the classic grid.
  const spotlightMain = resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry);
```
Replace with:
```js
  // The spotlight main: a still-valid manual pin, or (with no pin) whoever is
  // screen-sharing — see resolveSpotlightMain in lib/callLayout.js. Null
  // means "no spotlight": 1:1 falls to DirectFocusLayout, everything else to
  // the classic grid. `spotlightStrip` also resolves the strip ("everyone
  // else", including the sharer's own camera tile if they have one live).
  const screenShareHasCamera = Boolean(
    screenShareEntry?.participant?.getTrackPublication?.(Track.Source.Camera)?.track
      && !screenShareEntry.participant.getTrackPublication(Track.Source.Camera).isMuted,
  );
  const { mainEntry: spotlightMain, others: spotlightOthers } = spotlightStrip({
    participants,
    pinnedIdentity,
    screenShareEntry: screenShareEntry ? { ...screenShareEntry, hasCamera: screenShareHasCamera } : null,
  });
```

Find:
```js
        {spotlightMain ? (
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={participants.filter((p) => p.participant?.identity !== spotlightMain.participant?.identity)}
            screenShareEntry={screenShareEntry}
```
Replace with:
```js
        {spotlightMain ? (
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={spotlightOthers}
            screenShareEntry={screenShareEntry}
```

- [ ] **Step 2: Run a syntax check**

Run: `node --check apps/desktop/src/modules/runly.chat/calls/CallRoomLayout.jsx`
Expected: no output (valid syntax). Note `Track` must already be imported in this file (it is — `import { Track } from "livekit-client";` is already at the top for the existing `RemoteAudio` component).

- [ ] **Step 3: `GuestCallRoom.jsx` — same consolidation**

Find:
```js
import { resolveSpotlightMain } from "../lib/callLayout";
```
Replace with:
```js
import { spotlightStrip } from "../lib/callLayout";
```

Find:
```js
  const useFocusLayout = participants.length === 2 && !screenShareEntry;
  const spotlightMain = resolveSpotlightMain(participants, pinnedIdentity, screenShareEntry);
```
Replace with:
```js
  const useFocusLayout = participants.length === 2 && !screenShareEntry;
  const screenShareHasCamera = Boolean(
    screenShareEntry?.participant?.getTrackPublication?.(Track.Source.Camera)?.track
      && !screenShareEntry.participant.getTrackPublication(Track.Source.Camera).isMuted,
  );
  const { mainEntry: spotlightMain, others: spotlightOthers } = spotlightStrip({
    participants,
    pinnedIdentity,
    screenShareEntry: screenShareEntry ? { ...screenShareEntry, hasCamera: screenShareHasCamera } : null,
  });
```

Find:
```js
        {showChat ? (
          <GuestRoomChat polled={messages} liveIncoming={live} onSend={publishChat} myName={myName} />
        ) : spotlightMain ? (
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={participants.filter((p) => p.participant?.identity !== spotlightMain.participant?.identity)}
            screenShareEntry={screenShareEntry}
```
Replace with:
```js
        {showChat ? (
          <GuestRoomChat polled={messages} liveIncoming={live} onSend={publishChat} myName={myName} />
        ) : spotlightMain ? (
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={spotlightOthers}
            screenShareEntry={screenShareEntry}
```

- [ ] **Step 4: Run a syntax check**

Run: `node --check apps/desktop/src/modules/runly.chat/calls/guest/GuestCallRoom.jsx`
Expected: no output. `Track` is already imported at the top of this file (`import { Room, RoomEvent, Track } from "livekit-client";`).

- [ ] **Step 5: Build**

Run: `pnpm build` (root build — confirms both files compile across the monorepo)
Expected: no errors.

- [ ] **Step 6: Manual verification**

`pnpm dev`, start a 3-person call, have one participant share their screen with their camera also on — confirm their camera shows up as its own tile in the strip alongside the other participants', and the screen stays the main tile. Turn their camera off — confirm the extra tile disappears.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/calls/CallRoomLayout.jsx apps/desktop/src/modules/runly.chat/calls/guest/GuestCallRoom.jsx
git commit -m "fix(calls): wire spotlightStrip into member/guest layouts, screen+camera as independent tiles"
```

---

## Task 13: Active-speaker debounced order — pure decision function

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/callLayout.js`
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js`:

```js
describe("advanceSpeakingFocus", () => {
  it("starts with no focused speaker", () => {
    const state = advanceSpeakingFocus(null, { candidateId: null, now: 0, stableMs: 1500 });
    assert.equal(state.focusedId, null);
  });

  it("does not focus a new candidate before it has been stable for stableMs", () => {
    let state = advanceSpeakingFocus(null, { candidateId: "b", now: 0, stableMs: 1500 });
    assert.equal(state.focusedId, null);
    state = advanceSpeakingFocus(state, { candidateId: "b", now: 1000, stableMs: 1500 });
    assert.equal(state.focusedId, null);
  });

  it("focuses the candidate once it has been stable for stableMs", () => {
    let state = advanceSpeakingFocus(null, { candidateId: "b", now: 0, stableMs: 1500 });
    state = advanceSpeakingFocus(state, { candidateId: "b", now: 1500, stableMs: 1500 });
    assert.equal(state.focusedId, "b");
  });

  it("resets the stability timer if the candidate changes before stableMs", () => {
    let state = advanceSpeakingFocus(null, { candidateId: "b", now: 0, stableMs: 1500 });
    state = advanceSpeakingFocus(state, { candidateId: "c", now: 1000, stableMs: 1500 });
    state = advanceSpeakingFocus(state, { candidateId: "c", now: 2000, stableMs: 1500 });
    assert.equal(state.focusedId, null);
    state = advanceSpeakingFocus(state, { candidateId: "c", now: 2500, stableMs: 1500 });
    assert.equal(state.focusedId, "c");
  });

  it("keeps the current focus when nobody is speaking (candidateId null) instead of clearing it immediately", () => {
    let state = advanceSpeakingFocus(null, { candidateId: "b", now: 0, stableMs: 1500 });
    state = advanceSpeakingFocus(state, { candidateId: "b", now: 1500, stableMs: 1500 });
    assert.equal(state.focusedId, "b");
    state = advanceSpeakingFocus(state, { candidateId: null, now: 1600, stableMs: 1500 });
    assert.equal(state.focusedId, "b");
  });
});

describe("orderBySpeakingFocus", () => {
  it("returns the base order when there is no focused speaker", () => {
    const entries = [{ participant: { identity: "a" } }, { participant: { identity: "b" } }];
    assert.deepEqual(orderBySpeakingFocus(entries, null).map((e) => e.participant.identity), ["a", "b"]);
  });

  it("moves the focused speaker to the front, keeping the rest in order", () => {
    const entries = [
      { participant: { identity: "a" } },
      { participant: { identity: "b" } },
      { participant: { identity: "c" } },
    ];
    assert.deepEqual(orderBySpeakingFocus(entries, "c").map((e) => e.participant.identity), ["c", "a", "b"]);
  });

  it("is a no-op when the focused id is not present in entries", () => {
    const entries = [{ participant: { identity: "a" } }, { participant: { identity: "b" } }];
    assert.deepEqual(orderBySpeakingFocus(entries, "ghost").map((e) => e.participant.identity), ["a", "b"]);
  });
});
```

Also add `advanceSpeakingFocus, orderBySpeakingFocus` to the existing import line at the top of the test file:
```js
import { resolvePinnedEntry, resolveSpotlightMain, spotlightStrip, stripRowCount, advanceSpeakingFocus, orderBySpeakingFocus } from "../callLayout.js";
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js`
Expected: FAIL — `advanceSpeakingFocus`/`orderBySpeakingFocus` are not exported yet.

- [ ] **Step 3: Implement both pure functions**

Append to `apps/desktop/src/modules/runly.chat/calls/lib/callLayout.js`:

```js
// How long a single candidate must be the top "who's speaking" pick before
// the strip actually reorders — avoids jitter on every audio-level blip
// (someone clearing their throat shouldn't reshuffle the call). Named
// constant per the same pattern as STRIP_TWO_ROW_THRESHOLD, easy to retune.
export const SPEAKING_FOCUS_STABLE_MS = 1500;

// Pure debounce state machine for "who should be boosted to the front of the
// strip". `state` is `{ focusedId, pendingId, pendingSince } | null`.
// `candidateId` is whoever is the top active speaker this tick (or null if
// nobody is speaking). A `null` candidate never clears an existing focus —
// silence (or everyone briefly pausing) shouldn't un-focus the last speaker.
// See
// docs/superpowers/specs/2026-09-23-call-spotlight-polish-round2-design.md §8.4.
export function advanceSpeakingFocus(state, { candidateId, now, stableMs = SPEAKING_FOCUS_STABLE_MS }) {
  const current = state ?? { focusedId: null, pendingId: null, pendingSince: null };
  if (!candidateId || candidateId === current.focusedId) {
    return { ...current, pendingId: null, pendingSince: null };
  }
  if (candidateId !== current.pendingId) {
    return { ...current, pendingId: candidateId, pendingSince: now };
  }
  if (now - current.pendingSince >= stableMs) {
    return { focusedId: candidateId, pendingId: null, pendingSince: null };
  }
  return current;
}

// Moves the focused speaker's entry to the front of `entries`, preserving
// the relative order of everyone else. A no-op if `focusedId` is null or not
// present.
export function orderBySpeakingFocus(entries, focusedId) {
  if (!focusedId) return entries;
  const idx = entries.findIndex((e) => e.participant?.identity === focusedId);
  if (idx <= 0) return entries;
  const copy = entries.slice();
  const [focused] = copy.splice(idx, 1);
  copy.unshift(focused);
  return copy;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/calls/lib/callLayout.js apps/desktop/src/modules/runly.chat/calls/lib/__tests__/callLayout.test.js
git commit -m "feat(calls): pure debounced active-speaker focus + reorder helpers"
```

---

## Task 14: `useSpeakingOrder` hook

**Files:**
- Create: `apps/desktop/src/modules/runly.chat/calls/hooks/useSpeakingOrder.js`

- [ ] **Step 1: Write the hook** (thin glue over the pure functions from Task 13 — not unit-tested itself, consistent with this codebase's pattern of testing the pure logic and manually verifying the React wiring; see `useCallEphemeral.js` for the same style of un-tested stateful hook next to tested pure helpers)

```js
import { useEffect, useRef, useState } from "react";
import { advanceSpeakingFocus, orderBySpeakingFocus, SPEAKING_FOCUS_STABLE_MS } from "../lib/callLayout";

const TICK_MS = 300;

// Re-evaluates every TICK_MS which identity (if any) has been the top active
// speaker for SPEAKING_FOCUS_STABLE_MS, and returns `entries` reordered to
// put that identity first. `speakingIds` is a Set of identities currently in
// room.activeSpeakers (LiveKit already orders that array loudest-first).
export function useSpeakingOrder(entries, speakingIds) {
  const [focusedId, setFocusedId] = useState(null);
  const stateRef = useRef(null);

  useEffect(() => {
    const tick = () => {
      const candidateId = speakingIds.size ? [...speakingIds][0] : null;
      const next = advanceSpeakingFocus(stateRef.current, { candidateId, now: Date.now(), stableMs: SPEAKING_FOCUS_STABLE_MS });
      stateRef.current = next;
      setFocusedId((current) => (current === next.focusedId ? current : next.focusedId));
    };
    tick();
    const id = setInterval(tick, TICK_MS);
    return () => clearInterval(id);
  }, [speakingIds]);

  return orderBySpeakingFocus(entries, focusedId);
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check apps/desktop/src/modules/runly.chat/calls/hooks/useSpeakingOrder.js`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/calls/hooks/useSpeakingOrder.js
git commit -m "feat(calls): add useSpeakingOrder hook for the spotlight strip"
```

---

## Task 15: Speaking ring on `ParticipantTile` + wire `activeSpeakers` through

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/ParticipantTile.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/SpotlightLayout.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallRoomLayout.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/DirectFocusLayout.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/CallRoom.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/GuestCallRoom.jsx`

- [ ] **Step 1: `ParticipantTile.jsx` — add a `speaking` prop and ring**

Find:
```jsx
export function ParticipantTile({
  participant,
  isLocal,
  handRaised = false,
  pinned = false,
  onPin = null,
  mirrorLocalCamera = true,
  className = "",
  preferSource = "auto",
  // "auto" = contain for screen-share, cover for camera. Pass "contain" to
  // letterbox a camera feed too (used in the focus layout so a portrait phone
  // camera in a landscape tile isn't cropped).
  fit = "auto",
}) {
```
Replace with:
```jsx
export function ParticipantTile({
  participant,
  isLocal,
  handRaised = false,
  pinned = false,
  onPin = null,
  mirrorLocalCamera = true,
  className = "",
  preferSource = "auto",
  // "auto" = contain for screen-share, cover-or-contain for camera depending
  // on its decoded orientation (see resolveAutoFit above). Pass "contain" to
  // force letterboxing regardless of orientation (used by the main spotlight
  // tile).
  fit = "auto",
  // Whether this participant is a currently active speaker (LiveKit
  // room.activeSpeakers) — shows a subtle ring, Teams/Meet-style.
  speaking = false,
}) {
```

Find:
```jsx
    <div className={`group/tile relative h-full min-h-0 overflow-hidden rounded-2xl bg-slate-900 ring-1 ring-white/10 ${className}`}>
```
Replace with:
```jsx
    <div className={`group/tile relative h-full min-h-0 overflow-hidden rounded-2xl bg-slate-900 ring-1 transition-shadow ${speaking ? "ring-2 ring-emerald-400" : "ring-white/10"} ${className}`}>
```

- [ ] **Step 2: `SpotlightLayout.jsx` — accept `speakingIds`, apply `useSpeakingOrder` to `others`, pass `speaking` to every tile**

Find:
```jsx
import { ParticipantTile } from "./ParticipantTile";
import { stripRowCount } from "./lib/callLayout";
```
Replace with:
```jsx
import { ParticipantTile } from "./ParticipantTile";
import { stripRowCount } from "./lib/callLayout";
import { useSpeakingOrder } from "./hooks/useSpeakingOrder";
```

Find:
```jsx
export function SpotlightLayout({ mainEntry, others, screenShareEntry, isMobile, raisedHands, myHandRaised, myLocalIdentity, mirrorLocalCamera, onPin }) {
  const mainId = mainEntry.participant?.identity;
  const mainIsSharing = Boolean(screenShareEntry && screenShareEntry.participant?.identity === mainId);
  const showScreenTile = Boolean(screenShareEntry) && !mainIsSharing;
```
Replace with:
```jsx
export function SpotlightLayout({ mainEntry, others, screenShareEntry, isMobile, raisedHands, myHandRaised, myLocalIdentity, mirrorLocalCamera, onPin, speakingIds = new Set() }) {
  const mainId = mainEntry.participant?.identity;
  const mainIsSharing = Boolean(screenShareEntry && screenShareEntry.participant?.identity === mainId);
  const showScreenTile = Boolean(screenShareEntry) && !mainIsSharing;
  const orderedOthers = useSpeakingOrder(others, speakingIds);
```

Find:
```jsx
        <ParticipantTile
          participant={mainEntry.participant}
          isLocal={mainEntry.isLocal}
          handRaised={handFor(mainId)}
          preferSource={mainIsSharing ? "screen" : "auto"}
          pinned
          onPin={onPin}
          mirrorLocalCamera={mirrorLocalCamera}
          className="rounded-[1.5rem]"
          fit="contain"
        />
```
Replace with:
```jsx
        <ParticipantTile
          participant={mainEntry.participant}
          isLocal={mainEntry.isLocal}
          handRaised={handFor(mainId)}
          preferSource={mainIsSharing ? "screen" : "auto"}
          pinned
          onPin={onPin}
          mirrorLocalCamera={mirrorLocalCamera}
          className="rounded-[1.5rem]"
          fit="contain"
          speaking={!mainIsSharing && speakingIds.has(mainId)}
        />
```

Find:
```jsx
        {others.map(({ participant, isLocal }) => (
          <div key={participant.sid || participant.identity} className={tileCls}>
            <ParticipantTile
              participant={participant}
              isLocal={isLocal}
              handRaised={handFor(participant?.identity)}
              preferSource="camera"
              onPin={onPin}
              mirrorLocalCamera={mirrorLocalCamera}
              className="rounded-xl"
            />
          </div>
        ))}
```
Replace with:
```jsx
        {orderedOthers.map(({ participant, isLocal }) => (
          <div key={participant.sid || participant.identity} className={tileCls}>
            <ParticipantTile
              participant={participant}
              isLocal={isLocal}
              handRaised={handFor(participant?.identity)}
              preferSource="camera"
              onPin={onPin}
              mirrorLocalCamera={mirrorLocalCamera}
              className="rounded-xl"
              speaking={speakingIds.has(participant?.identity)}
            />
          </div>
        ))}
```

Also update the strip tile-count line (still needs the *unordered* count, unaffected — leave `others.length` as-is, only the `.map` target changed) and `stripTileCount`/`stripRows` lines stay referencing `others.length`, not `orderedOthers.length` (same length, no functional difference, but leave them as `others.length` to minimize the diff).

- [ ] **Step 3: `DirectFocusLayout.jsx` — pass `speaking` to both tiles**

Find:
```jsx
export function DirectFocusLayout({ localEntry, remoteEntry, raisedHands, myHandRaised, mirrorLocalCamera, swapped = false, onToggleSwap = null }) {
```
Replace with:
```jsx
export function DirectFocusLayout({ localEntry, remoteEntry, raisedHands, myHandRaised, mirrorLocalCamera, swapped = false, onToggleSwap = null, speakingIds = new Set() }) {
```

Find:
```jsx
      <ParticipantTile
        participant={mainEntry.participant}
        isLocal={mainIsLocal}
        handRaised={mainIsLocal ? myHandRaised : raisedHands.has(remoteEntry.participant?.identity)}
        mirrorLocalCamera={mirrorLocalCamera}
        className="rounded-[1.5rem]"
        fit="contain"
      />
```
Replace with:
```jsx
      <ParticipantTile
        participant={mainEntry.participant}
        isLocal={mainIsLocal}
        handRaised={mainIsLocal ? myHandRaised : raisedHands.has(remoteEntry.participant?.identity)}
        mirrorLocalCamera={mirrorLocalCamera}
        className="rounded-[1.5rem]"
        fit="contain"
        speaking={speakingIds.has(mainEntry.participant?.identity)}
      />
```

Find:
```jsx
        <ParticipantTile
          participant={pipEntry.participant}
          isLocal={pipEntry.isLocal}
          handRaised={pipEntry.isLocal ? myHandRaised : raisedHands.has(pipEntry.participant?.identity)}
          mirrorLocalCamera={mirrorLocalCamera}
          className="rounded-2xl"
        />
```
Replace with:
```jsx
        <ParticipantTile
          participant={pipEntry.participant}
          isLocal={pipEntry.isLocal}
          handRaised={pipEntry.isLocal ? myHandRaised : raisedHands.has(pipEntry.participant?.identity)}
          mirrorLocalCamera={mirrorLocalCamera}
          className="rounded-2xl"
          speaking={speakingIds.has(pipEntry.participant?.identity)}
        />
```

- [ ] **Step 4: `CallRoomLayout.jsx` — accept `speakingIds` from `view` and forward to both layouts + the classic grid**

Find:
```js
    pinnedIdentity = null,
    myLocalIdentity = null,
    directSwapped = false,
```
Replace with:
```js
    pinnedIdentity = null,
    myLocalIdentity = null,
    directSwapped = false,
    speakingIds = new Set(),
```

Find:
```jsx
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={spotlightOthers}
            screenShareEntry={screenShareEntry}
            isMobile={isMobile}
            raisedHands={raisedHands}
            myHandRaised={myHandRaised}
            myLocalIdentity={myLocalIdentity}
            mirrorLocalCamera={mirrorLocalCamera}
            onPin={actions.setPinned}
          />
        ) : useFocusLayout ? (
          <DirectFocusLayout
            localEntry={localEntry}
            remoteEntry={remoteEntries[0]}
            raisedHands={raisedHands}
            myHandRaised={myHandRaised}
            mirrorLocalCamera={mirrorLocalCamera}
            swapped={isMobile ? directSwapped : false}
            onToggleSwap={isMobile ? actions.toggleDirectSwap : null}
          />
        ) : (
          <div className={`mx-auto grid h-full max-w-6xl gap-2 sm:gap-3 ${gridClass}`}>
            {participants.map(({ participant, isLocal }) => (
              <ParticipantTile
                key={participant.sid || participant.identity || "local-participant"}
                participant={participant}
                isLocal={isLocal}
                handRaised={raisedHands.has(participant?.identity)}
                onPin={participants.length > 1 ? actions.setPinned : null}
                mirrorLocalCamera={mirrorLocalCamera}
                fit={participants.length <= 2 ? "contain" : "auto"}
              />
            ))}
          </div>
        )}
```
Replace with:
```jsx
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={spotlightOthers}
            screenShareEntry={screenShareEntry}
            isMobile={isMobile}
            raisedHands={raisedHands}
            myHandRaised={myHandRaised}
            myLocalIdentity={myLocalIdentity}
            mirrorLocalCamera={mirrorLocalCamera}
            onPin={actions.setPinned}
            speakingIds={speakingIds}
          />
        ) : useFocusLayout ? (
          <DirectFocusLayout
            localEntry={localEntry}
            remoteEntry={remoteEntries[0]}
            raisedHands={raisedHands}
            myHandRaised={myHandRaised}
            mirrorLocalCamera={mirrorLocalCamera}
            swapped={isMobile ? directSwapped : false}
            onToggleSwap={isMobile ? actions.toggleDirectSwap : null}
            speakingIds={speakingIds}
          />
        ) : (
          <div className={`mx-auto grid h-full max-w-6xl gap-2 sm:gap-3 ${gridClass}`}>
            {participants.map(({ participant, isLocal }) => (
              <ParticipantTile
                key={participant.sid || participant.identity || "local-participant"}
                participant={participant}
                isLocal={isLocal}
                handRaised={raisedHands.has(participant?.identity)}
                onPin={participants.length > 1 ? actions.setPinned : null}
                mirrorLocalCamera={mirrorLocalCamera}
                fit={participants.length <= 2 ? "contain" : "auto"}
                speaking={speakingIds.has(participant?.identity)}
              />
            ))}
          </div>
        )}
```

- [ ] **Step 5: `CallRoom.jsx` — derive `speakingIds` from `room.activeSpeakers` and pass it into `view`**

Find:
```js
  const mirrorLocalCamera = cameraFacing !== "environment";
```
Replace with:
```js
  // room.activeSpeakers is already kept fresh by the RoomEvent.ActiveSpeakersChanged
  // listener above (it calls refresh()) — derive the identity set on every render.
  const speakingIds = new Set(room.activeSpeakers.map((p) => p.identity));
  const mirrorLocalCamera = cameraFacing !== "environment";
```

Find (inside the `view={{ ... }}` object passed to `CallRoomLayout`):
```js
        pinnedIdentity,
        myLocalIdentity: room.localParticipant?.identity,
        directSwapped,
```
Replace with:
```js
        pinnedIdentity,
        myLocalIdentity: room.localParticipant?.identity,
        directSwapped,
        speakingIds,
```

- [ ] **Step 6: `GuestCallRoom.jsx` — same derivation, passed directly to the layouts it renders**

Find:
```js
  const useFocusLayout = participants.length === 2 && !screenShareEntry;
```
Replace with:
```js
  const useFocusLayout = participants.length === 2 && !screenShareEntry;
  const speakingIds = new Set(room.activeSpeakers.map((p) => p.identity));
```

Find:
```jsx
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={spotlightOthers}
            screenShareEntry={screenShareEntry}
            isMobile
            raisedHands={ephemeral.raisedHands}
            myHandRaised={ephemeral.myHandRaised}
            myLocalIdentity={room.localParticipant?.identity}
            mirrorLocalCamera
            onPin={setPinned}
          />
        ) : useFocusLayout ? (
          <DirectFocusLayout
            localEntry={localEntry}
            remoteEntry={remoteEntries[0]}
            raisedHands={ephemeral.raisedHands}
            myHandRaised={ephemeral.myHandRaised}
            mirrorLocalCamera
            swapped={directSwapped}
            onToggleSwap={toggleDirectSwap}
          />
```
Replace with:
```jsx
          <SpotlightLayout
            mainEntry={spotlightMain}
            others={spotlightOthers}
            screenShareEntry={screenShareEntry}
            isMobile
            raisedHands={ephemeral.raisedHands}
            myHandRaised={ephemeral.myHandRaised}
            myLocalIdentity={room.localParticipant?.identity}
            mirrorLocalCamera
            onPin={setPinned}
            speakingIds={speakingIds}
          />
        ) : useFocusLayout ? (
          <DirectFocusLayout
            localEntry={localEntry}
            remoteEntry={remoteEntries[0]}
            raisedHands={ephemeral.raisedHands}
            myHandRaised={ephemeral.myHandRaised}
            mirrorLocalCamera
            swapped={directSwapped}
            onToggleSwap={toggleDirectSwap}
            speakingIds={speakingIds}
          />
```

Also, in the same file's classic-grid branch:
```jsx
            {participants.map(({ participant, isLocal }) => (
              <ParticipantTile
                key={participant?.sid || participant?.identity}
                participant={participant}
                isLocal={isLocal}
                handRaised={ephemeral.raisedHands.has(participant?.identity)}
                onPin={participants.length > 1 ? setPinned : null}
                mirrorLocalCamera
                fit="contain"
              />
            ))}
```
Replace with:
```jsx
            {participants.map(({ participant, isLocal }) => (
              <ParticipantTile
                key={participant?.sid || participant?.identity}
                participant={participant}
                isLocal={isLocal}
                handRaised={ephemeral.raisedHands.has(participant?.identity)}
                onPin={participants.length > 1 ? setPinned : null}
                mirrorLocalCamera
                fit="contain"
                speaking={speakingIds.has(participant?.identity)}
              />
            ))}
```

- [ ] **Step 7: Build**

Run: `pnpm build`
Expected: no errors.

- [ ] **Step 8: Manual verification**

`pnpm dev`, a 3+ person call: speak from one participant and confirm (a) their tile gets a ring within roughly a second and a half of continuous speaking, (b) the strip reorders to bring them to the front, (c) briefly clearing your throat or a short "uh" doesn't cause a reorder, (d) in a 1:1 call and in the classic grid, the ring appears but nothing reorders.

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/modules/runly.chat/calls/ParticipantTile.jsx apps/desktop/src/modules/runly.chat/calls/SpotlightLayout.jsx apps/desktop/src/modules/runly.chat/calls/CallRoomLayout.jsx apps/desktop/src/modules/runly.chat/calls/DirectFocusLayout.jsx apps/desktop/src/modules/runly.chat/calls/CallRoom.jsx apps/desktop/src/modules/runly.chat/calls/guest/GuestCallRoom.jsx
git commit -m "feat(calls): active-speaker ring + debounced spotlight-strip reordering"
```

---

## Task 16: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Full lint**

Run: `pnpm lint`
Expected: clean (no new violations — in particular no `local-date-from-toISOString()` usage was introduced, and no file crossed the 1000-line soft limit; `ParticipantTile.jsx`, `SpotlightLayout.jsx`, `callLayout.js` all stay well under it after these changes).

- [ ] **Step 2: Full build**

Run: `pnpm build`
Expected: clean.

- [ ] **Step 3: Full backend test suite for the touched areas**

Run:
```bash
node --test apps/api/src/routes/calls/__tests__/
node --test apps/api/src/routes/chat/__tests__/chat-service.test.js
```
Expected: all green.

- [ ] **Step 4: Full frontend unit tests for the touched areas**

Run: `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/`
Expected: all green (`callLayout.test.js`, `callChat.test.js`, `callEphemeral.test.js`, `inviteResult.test.js`, `roomChat.test.js` — the last one confirms `mergeRoomMessages`/`RoomChatView`'s shared logic still works, since `GuestRoomChat.jsx` kept using it).

- [ ] **Step 5: Confirm no orphaned imports anywhere in the repo**

Run: `grep -rn "CallRoomChat\b" apps/desktop/src apps/api/src packages; grep -rn "roomMode" apps/desktop/src/modules/runly.chat; grep -rn "postMemberMessage\|listMessagesGuarded" apps/api/src apps/desktop/src packages`
Expected: no matches for any of these.

- [ ] **Step 6: Update `docs/TASKS.md`**

Add one line to whatever section tracks recent `runly.chat` calls work (check the file first with `grep -n -i "spotlight\|call-room\|calls" docs/TASKS.md` to find the right spot and match its existing bullet style), noting: call spotlight polish round 2 complete — portrait camera letterboxing, guest chat unified into the real conversation, independent screen+camera tiles, active-speaker priority. Include `Verified: 2026-09-23 (pnpm build, pnpm lint, and the listed node --test suites all green)`.

- [ ] **Step 7: Final commit**

```bash
git add docs/TASKS.md
git commit -m "docs: mark call spotlight polish round 2 complete"
```
