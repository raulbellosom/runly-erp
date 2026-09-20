# External Chat Feature Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the external/guest support chat to parity with the main chat — the operator "Bandeja externa" reuses `ChatWindow`, and the storefront guest widget gains inline attachment previews plus typing/read indicators.

**Architecture:** `ChatWindow` gets a `variant` prop; a new `useChatWindowData(conversationId, variant)` hook selects between the existing internal data hooks and a new external data hook, so `ChatWindow`'s body never branches. Backend adds five small endpoints (guest attachment URL, typing ×2, read ×2) plus a bug fix (guest attachments never linked to their message) and one column (`chat_guest_sessions.guest_last_read_at`). The storefront widget stays hand-rolled with inline styles (runs on third-party sites — no Tailwind/`@atlas/ui`).

**Tech Stack:** Node.js + Hono API, raw SQL via `prisma.$queryRaw`, Node built-in test runner (`node --test`), React + TanStack Query + Supabase Realtime broadcast, `@raulbellosom/atlas-sdk` (storefront SDK, built to `dist/`).

**Spec:** `docs/superpowers/specs/2026-09-08-external-chat-feature-parity-design.md`

**Reference before starting:**
- `apps/api/src/routes/chat/index.js` — `pub` (public guest) + `internal` (operator) sub-apps; both mounted at the bottom (`app.route("/public/chat", pub)`, `app.route("/chat", internal)`).
- `apps/api/src/routes/chat/guest-service.js` — `createGuestChatService`; `sendGuestMessage`, `listGuestMessages`, `resolveGuestSession`.
- `apps/api/src/routes/chat/chat-external-inbox-service.js` — `createChatExternalInboxService`; `listExternalInbox`, `markExternalRead`, `closeExternalConversation`.
- `apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx` (1112 lines) + `hooks/useChatMessages.js` + `hooks/useExternalInbox.js`.
- `packages/storefront-sdk/src/react/ChatWidget.jsx` + `src/react/useGuestChat.js` + `src/guestChat.js`.

**Conventions:** JavaScript only. UI text in Spanish, code/comments in English. No emojis. UUID v7 (DB `DEFAULT uuidv7()` — never generate in JS). No file over 1000 lines. Commit after every green step. Work on `main` (no branches). End commit messages with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

**Testing commands:**
- API: `node --test apps/api/src/routes/chat/__tests__/<file>.test.js`
- Syntax check: `node --check <file>`
- Build: `pnpm build` (or `pnpm --filter @atlas/desktop build`, `pnpm --filter @raulbellosom/atlas-sdk build`)
- Lint: `pnpm lint`

---

## Phase 1 — Cleanup + Backend

### Task 1: Delete the dead in-app widget

**Files:**
- Delete: `apps/desktop/src/modules/atlas.chat/widget/ExternalChatWidget.jsx`
- Modify: `apps/desktop/src/modules/atlas.chat/lib/chatUtils.js` (remove `saveGuestSession`, `loadGuestSession`, `clearGuestSession`)

- [ ] **Step 1: Confirm the widget and helpers are unreferenced**

Run:
```bash
grep -rn "ExternalChatWidget" apps/ packages/ --include=*.js --include=*.jsx --include=*.ts --include=*.tsx | grep -v node_modules
grep -rn "saveGuestSession\|loadGuestSession\|clearGuestSession" apps/ packages/ --include=*.js --include=*.jsx | grep -v node_modules
```
Expected: the only hits are the definition in `ExternalChatWidget.jsx` and its own import line, plus the three definitions in `chatUtils.js`. Nothing else.

- [ ] **Step 2: Delete the widget file and its folder**

```bash
git rm apps/desktop/src/modules/atlas.chat/widget/ExternalChatWidget.jsx
rmdir apps/desktop/src/modules/atlas.chat/widget 2>/dev/null || true
```

- [ ] **Step 3: Remove the three orphaned helpers from `chatUtils.js`**

Open `apps/desktop/src/modules/atlas.chat/lib/chatUtils.js`, find the block (around lines 165–200) containing `export function saveGuestSession`, `export function loadGuestSession`, `export function clearGuestSession` and delete all three functions and any comment header that introduces only them. Leave every other export intact.

- [ ] **Step 4: Verify nothing else broke**

Run:
```bash
grep -rn "GuestSession" apps/desktop/src/modules/atlas.chat --include=*.js --include=*.jsx | grep -v node_modules
node --check apps/desktop/src/modules/atlas.chat/lib/chatUtils.js
```
Expected: no references to the deleted helpers; `node --check` passes.

- [ ] **Step 5: Build**

Run: `pnpm --filter @atlas/desktop build`
Expected: build succeeds (no unresolved import of `ExternalChatWidget` or the helpers).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore(chat): remove dead in-app ExternalChatWidget and orphaned guest-session helpers

Not imported anywhere; the live guest widget is packages/storefront-sdk ChatWidget.
The three saveGuestSession/loadGuestSession/clearGuestSession helpers in chatUtils.js
were used only by this widget.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration — `chat_guest_sessions.guest_last_read_at`

**Files:**
- Create: `prisma/migrations/20260908000000_chat_guest_last_read/migration.sql`
- Possibly modify: `prisma/schema.prisma` (only if `chat_guest_sessions` is a Prisma model there)

- [ ] **Step 1: Check whether `chat_guest_sessions` is in the Prisma schema**

Run: `grep -n "chat_guest_sessions\|ChatGuestSession\|model.*GuestSession" prisma/schema.prisma`
- If it returns a `model` block: you will add the field there in Step 3.
- If it returns nothing (table is raw-SQL only, like other AME3/chat tables): skip the schema edit.

- [ ] **Step 2: Write the migration SQL**

Create `prisma/migrations/20260908000000_chat_guest_last_read/migration.sql`:
```sql
-- Guest-side read receipt: the timestamp the visitor last viewed the conversation.
-- Operator-side last-read is derived from chat_conversation_members.last_read_at (no column needed).
ALTER TABLE "chat_guest_sessions"
  ADD COLUMN IF NOT EXISTS "guest_last_read_at" timestamptz;
```

- [ ] **Step 3: (Conditional) add the field to the Prisma model**

Only if Step 1 found a model. Add inside the `chat_guest_sessions` model, next to the other timestamp fields, matching the file's casing/mapping convention (e.g. `guestLastReadAt DateTime? @map("guest_last_read_at") @db.Timestamptz(6)`). Do not reformat the rest of the model.

- [ ] **Step 4: Apply the migration**

Run: `pnpm db:migrate`
Expected: migration `20260908000000_chat_guest_last_read` applies cleanly. If Step 3 ran, also run `pnpm db:generate`.

- [ ] **Step 5: Verify the column exists**

Run: `pnpm db:studio` is optional; instead verify via a quick query in the next task's test. For now:
```bash
node --check prisma/migrations/20260908000000_chat_guest_last_read/migration.sql 2>/dev/null || true
```
(SQL isn't JS — this is a no-op guard; real verification is the migrate success above.)

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/20260908000000_chat_guest_last_read prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(chat): add chat_guest_sessions.guest_last_read_at for guest read receipts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Fix — link guest attachments to their message

**Files:**
- Modify: `apps/api/src/routes/chat/guest-service.js` (`sendGuestMessage`)
- Test: `apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js` (create)

`chatGuestMessageSchema` already allows `metadata` (an optional record), and the route
already forwards `data.metadata` to `sendGuestMessage`. The bug is purely that
`sendGuestMessage` never uses `metadata.attachmentId`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js`. Follow the harness style of `apps/api/src/routes/chat/__tests__/chat-service.test.js` (in-memory/prisma-stub or a real test DB connection — match whatever that file does). The test builds a fake `prisma` whose `$executeRaw` and `$queryRaw` record calls and return canned rows:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestChatService } from "../guest-service.js";

function makePrismaStub() {
  const calls = [];
  const stub = {
    calls,
    async $queryRaw(strings, ...values) {
      const sql = strings.join("?");
      calls.push({ kind: "query", sql, values });
      if (sql.includes("FROM chat_guest_sessions")) return [{ id: "sess-1", email: "v@x.com", name: "Vic" }];
      if (sql.includes("FROM chat_conversations")) return [{ id: "conv-1", company_id: null, assigned_user_id: null }];
      if (sql.includes("INSERT INTO chat_messages")) return [{ id: "msg-1", created_at: new Date("2026-09-08T00:00:00Z") }];
      return [];
    },
    async $executeRaw(strings, ...values) {
      const sql = strings.join("?");
      calls.push({ kind: "execute", sql, values });
      if (sql.includes("UPDATE chat_attachments") && sql.includes("SET message_id")) return 1;
      return 0;
    },
  };
  return stub;
}

test("sendGuestMessage links a pending attachment to the new message", async () => {
  const prisma = makePrismaStub();
  const svc = createGuestChatService({ prisma, supabaseAdmin: {}, notificationService: null, broadcaster: null });
  await svc.sendGuestMessage({
    rawToken: "tok",
    body: "foto.png",
    messageType: "file",
    metadata: { attachmentId: "att-1", fileName: "foto.png", mimeType: "image/png", sizeBytes: 1234 },
  });
  const linkCall = prisma.calls.find(
    (c) => c.kind === "execute" && c.sql.includes("UPDATE chat_attachments") && c.sql.includes("SET message_id"),
  );
  assert.ok(linkCall, "expected an UPDATE chat_attachments SET message_id call");
  assert.ok(linkCall.values.includes("att-1"), "should scope the update to the attachmentId");
  const countCall = prisma.calls.find(
    (c) => c.kind === "execute" && c.sql.includes("UPDATE chat_messages") && c.sql.includes("attachment_count"),
  );
  assert.ok(countCall, "expected attachment_count to be bumped when a row was linked");
});

test("sendGuestMessage without attachmentId does not touch chat_attachments", async () => {
  const prisma = makePrismaStub();
  const svc = createGuestChatService({ prisma, supabaseAdmin: {}, notificationService: null, broadcaster: null });
  await svc.sendGuestMessage({ rawToken: "tok", body: "hola", messageType: "text", metadata: {} });
  const linkCall = prisma.calls.find((c) => c.sql.includes("UPDATE chat_attachments"));
  assert.equal(linkCall, undefined);
});
```

> If `chat-service.test.js` uses a real DB connection instead of a stub, mirror that instead — create a guest session + conversation + presigned attachment row via the service/SQL, call `sendGuestMessage`, then `SELECT message_id FROM chat_attachments WHERE id = …` and assert it equals the new message id.

- [ ] **Step 2: Run the test — verify it fails**

Run: `node --test apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js`
Expected: FAIL — "expected an UPDATE chat_attachments SET message_id call".

- [ ] **Step 3: Implement the link in `sendGuestMessage`**

In `apps/api/src/routes/chat/guest-service.js`, inside `sendGuestMessage`, immediately after `const msg = msgRows[0];` and before the `Promise.all([...])` that updates the conversation, add:

```js
// Link a guest-presigned attachment (created by /attachments/presign) to this
// message. Scoped to the conversation and to rows not yet linked so a stale or
// foreign attachmentId is a no-op.
if (metadata?.attachmentId) {
  const linked = await prisma.$executeRaw`
    UPDATE chat_attachments
    SET message_id = ${msg.id}
    WHERE id = ${metadata.attachmentId}::uuid
      AND conversation_id = ${conversationId}::uuid
      AND message_id IS NULL
  `;
  if (linked > 0) {
    await prisma.$executeRaw`
      UPDATE chat_messages
      SET attachment_count = attachment_count + ${linked}
      WHERE id = ${msg.id}
    `;
  }
}
```

Confirm `sendGuestMessage`'s destructured params include `metadata = {}` (they do today: `sendGuestMessage({ rawToken, body, messageType = "text", metadata = {} })`).

- [ ] **Step 4: Run the test — verify it passes**

Run: `node --test apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Regression — full chat suite**

Run: `node --test apps/api/src/routes/chat/__tests__/`
Expected: no new failures vs. baseline.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/chat/guest-service.js apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js
git commit -m "$(cat <<'EOF'
fix(chat): link guest-presigned attachments to their message

sendGuestMessage received metadata.attachmentId but never set chat_attachments.message_id,
so guest-sent images/files rendered for nobody (list queries join on message_id).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Endpoint — guest attachment signed URL

**Files:**
- Modify: `apps/api/src/routes/chat/guest-service.js` (add `getGuestAttachmentUrl`)
- Modify: `apps/api/src/routes/chat/index.js` (add `pub.get("/session/:token/attachments/:attachmentId/url", …)`)
- Test: `apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js` (extend)

- [ ] **Step 1: Write the failing test (service level)**

Append to `guest-attachment-link.test.js`:
```js
test("getGuestAttachmentUrl returns a signed url for an attachment in the session's conversation", async () => {
  const prisma = makePrismaStub();
  // override query stub for the attachment lookup
  const origQuery = prisma.$queryRaw.bind(prisma);
  prisma.$queryRaw = async (strings, ...values) => {
    const sql = strings.join("?");
    if (sql.includes("FROM chat_attachments") && sql.includes("object_key")) {
      return [{ bucket: "atlas-chat", object_key: "conversations/conv-1/guest/abc.png" }];
    }
    return origQuery(strings, ...values);
  };
  const supabaseAdmin = {
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://x/signed" }, error: null }) }) },
  };
  const svc = createGuestChatService({ prisma, supabaseAdmin, notificationService: null, broadcaster: null });
  const res = await svc.getGuestAttachmentUrl({ rawToken: "tok", attachmentId: "att-1" });
  assert.equal(res.url, "https://x/signed");
});

test("getGuestAttachmentUrl throws 404 when the attachment is not in the conversation", async () => {
  const prisma = makePrismaStub();
  prisma.$queryRaw = async (strings, ...values) => {
    const sql = strings.join("?");
    if (sql.includes("FROM chat_guest_sessions")) return [{ id: "sess-1" }];
    if (sql.includes("FROM chat_conversations")) return [{ id: "conv-1" }];
    if (sql.includes("FROM chat_attachments")) return [];
    return [];
  };
  const svc = createGuestChatService({ prisma, supabaseAdmin: {}, notificationService: null, broadcaster: null });
  await assert.rejects(() => svc.getGuestAttachmentUrl({ rawToken: "tok", attachmentId: "att-x" }), /no encontrado|not found/i);
});
```

- [ ] **Step 2: Run — verify fail**

Run: `node --test apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js`
Expected: FAIL — `svc.getGuestAttachmentUrl is not a function`.

- [ ] **Step 3: Implement `getGuestAttachmentUrl` in `guest-service.js`**

Add inside `createGuestChatService`, near `listGuestMessages`:
```js
async function getGuestAttachmentUrl({ rawToken, attachmentId }) {
  const session = await resolveGuestSession(rawToken);
  const convRows = await prisma.$queryRaw`
    SELECT c.id FROM chat_conversations c
    INNER JOIN chat_conversation_members ccm
      ON ccm.conversation_id = c.id AND ccm.guest_session_id = ${session.id}
    WHERE c.deleted_at IS NULL
    ORDER BY c.created_at DESC
    LIMIT 1
  `;
  if (!convRows.length) throw new GuestChatServiceError("No hay conversacion activa.", 404);
  const conversationId = convRows[0].id;

  const attRows = await prisma.$queryRaw`
    SELECT bucket, object_key
    FROM chat_attachments
    WHERE id = ${attachmentId}::uuid AND conversation_id = ${conversationId}::uuid
    LIMIT 1
  `;
  if (!attRows.length) throw new GuestChatServiceError("Adjunto no encontrado.", 404);

  const { bucket, object_key: objectKey } = attRows[0];
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(objectKey, 300);
  if (error || !data?.signedUrl) throw new GuestChatServiceError("Error generando URL del adjunto.", 500);
  return { url: data.signedUrl, expiresIn: 300 };
}
```
Add `getGuestAttachmentUrl` to the object returned at the bottom of `createGuestChatService`.

- [ ] **Step 4: Add the public route in `index.js`**

In `apps/api/src/routes/chat/index.js`, next to `pub.post("/session/:token/attachments/presign", …)` (around line 1014), add:
```js
// GET /public/chat/session/:token/attachments/:attachmentId/url
pub.get("/session/:token/attachments/:attachmentId/url", async (c) => {
  try {
    const rawToken = c.req.param("token");
    const attachmentId = c.req.param("attachmentId");
    const result = await guestService.getGuestAttachmentUrl({ rawToken, attachmentId });
    return c.json({ data: result });
  } catch (err) {
    return handleError(c, err, "Error obteniendo URL del adjunto.");
  }
});
```

- [ ] **Step 5: Run tests — verify pass**

Run: `node --test apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js`
Expected: PASS (all tests).

- [ ] **Step 6: Syntax check the route file**

Run: `node --check apps/api/src/routes/chat/index.js`
Expected: OK.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/chat/guest-service.js apps/api/src/routes/chat/index.js apps/api/src/routes/chat/__tests__/guest-attachment-link.test.js
git commit -m "$(cat <<'EOF'
feat(chat): public endpoint for guest attachment signed URLs

GET /public/chat/session/:token/attachments/:id/url — validates the attachment
belongs to the session's conversation, returns a 300s signed URL.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Endpoints — typing (guest and operator)

**Files:**
- Modify: `apps/api/src/routes/chat/guest-service.js` (add `broadcastGuestTyping`)
- Modify: `apps/api/src/routes/chat/chat-external-inbox-service.js` (add `broadcastOperatorTyping`)
- Modify: `apps/api/src/routes/chat/index.js` (two routes)
- Test: `apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestChatService } from "../guest-service.js";
import { createChatExternalInboxService } from "../chat-external-inbox-service.js";

function makeBroadcaster() {
  const events = [];
  return { events, broadcastToChannel: (channel, event, payload) => events.push({ channel, event, payload }) };
}

function guestPrismaStub() {
  return {
    async $queryRaw(strings) {
      const sql = strings.join("?");
      if (sql.includes("FROM chat_guest_sessions")) return [{ id: "sess-1", email: "v@x.com", name: "Vic" }];
      if (sql.includes("FROM chat_conversations")) return [{ id: "conv-1" }];
      return [];
    },
    async $executeRaw() { return 0; },
  };
}

test("broadcastGuestTyping emits guest_typing on the conversation channel", async () => {
  const broadcaster = makeBroadcaster();
  const svc = createGuestChatService({ prisma: guestPrismaStub(), supabaseAdmin: {}, notificationService: null, broadcaster });
  await svc.broadcastGuestTyping({ rawToken: "tok" });
  assert.equal(broadcaster.events.length, 1);
  assert.equal(broadcaster.events[0].channel, "chat:conv:conv-1");
  assert.equal(broadcaster.events[0].event, "guest_typing");
  assert.ok(broadcaster.events[0].payload.at);
});

test("broadcastOperatorTyping emits operator_typing", async () => {
  const broadcaster = makeBroadcaster();
  const svc = createChatExternalInboxService({ prisma: { async $queryRaw() { return []; }, async $executeRaw() { return 0; } }, broadcaster });
  await svc.broadcastOperatorTyping({ conversationId: "conv-9" });
  assert.equal(broadcaster.events[0].channel, "chat:conv:conv-9");
  assert.equal(broadcaster.events[0].event, "operator_typing");
});
```

- [ ] **Step 2: Run — verify fail**

Run: `node --test apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js`
Expected: FAIL — `svc.broadcastGuestTyping is not a function`.

- [ ] **Step 3: Implement `broadcastGuestTyping` in `guest-service.js`**

Add inside `createGuestChatService`:
```js
async function broadcastGuestTyping({ rawToken }) {
  const session = await resolveGuestSession(rawToken);
  const convRows = await prisma.$queryRaw`
    SELECT c.id FROM chat_conversations c
    INNER JOIN chat_conversation_members ccm
      ON ccm.conversation_id = c.id AND ccm.guest_session_id = ${session.id}
    WHERE c.deleted_at IS NULL AND c.status != 'closed'
    ORDER BY c.created_at DESC LIMIT 1
  `;
  if (!convRows.length) return { ok: true };
  broadcaster?.broadcastToChannel(`chat:conv:${convRows[0].id}`, "guest_typing", {
    conversationId: convRows[0].id, at: new Date().toISOString(),
  });
  return { ok: true };
}
```
Export it from the returned object.

- [ ] **Step 4: Implement `broadcastOperatorTyping` in `chat-external-inbox-service.js`**

Add inside `createChatExternalInboxService` (it already receives `{ prisma, broadcaster = null }`):
```js
async function broadcastOperatorTyping({ conversationId }) {
  broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "operator_typing", {
    conversationId, at: new Date().toISOString(),
  });
  return { ok: true };
}
```
Add `broadcastOperatorTyping` to the returned object.

- [ ] **Step 5: Add the two routes in `index.js`**

Public (near the other `pub.post("/session/:token/...")` routes):
```js
// POST /public/chat/session/:token/typing — fire-and-forget
pub.post("/session/:token/typing", async (c) => {
  try {
    await guestService.broadcastGuestTyping({ rawToken: c.req.param("token") });
    return c.body(null, 204);
  } catch (err) {
    return handleError(c, err, "Error notificando escritura.");
  }
});
```

Operator (near `internal.post("/external/:conversationId/close", …)`):
```js
// POST /chat/external/:conversationId/typing
internal.post("/external/:conversationId/typing", requirePermission("chat.support.manage"), async (c) => {
  try {
    await chatExternalInboxService.broadcastOperatorTyping({ conversationId: c.req.param("conversationId") });
    return c.body(null, 204);
  } catch (err) {
    return handleError(c, err, "Error notificando escritura.");
  }
});
```

- [ ] **Step 6: Run tests — verify pass**

Run: `node --test apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js`
Expected: PASS.

- [ ] **Step 7: Syntax check + commit**

```bash
node --check apps/api/src/routes/chat/index.js
git add apps/api/src/routes/chat/guest-service.js apps/api/src/routes/chat/chat-external-inbox-service.js apps/api/src/routes/chat/index.js apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js
git commit -m "$(cat <<'EOF'
feat(chat): bidirectional typing broadcast for external support chat

POST /public/chat/session/:token/typing -> guest_typing
POST /chat/external/:id/typing          -> operator_typing
Both fire-and-forget, no persistence.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Read receipts — guest write + operator broadcast + exposure on reads

**Files:**
- Modify: `apps/api/src/routes/chat/guest-service.js` (`markGuestRead`; `listGuestMessages` returns `operatorLastReadAt`)
- Modify: `apps/api/src/routes/chat/chat-external-inbox-service.js` (`markExternalRead` broadcasts `operator_read`; `listExternalInbox` selects `guest_last_read_at`)
- Modify: `apps/api/src/routes/chat/index.js` (`pub.post("/session/:token/read")`)
- Test: `apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `external-chat-realtime.test.js`:
```js
test("markGuestRead sets guest_last_read_at and broadcasts guest_read", async () => {
  const broadcaster = makeBroadcaster();
  const executed = [];
  const prisma = {
    async $queryRaw(strings) {
      const sql = strings.join("?");
      if (sql.includes("FROM chat_guest_sessions")) return [{ id: "sess-1" }];
      if (sql.includes("FROM chat_conversations")) return [{ id: "conv-1" }];
      return [];
    },
    async $executeRaw(strings, ...values) {
      executed.push({ sql: strings.join("?"), values });
      return 1;
    },
  };
  const svc = createGuestChatService({ prisma, supabaseAdmin: {}, notificationService: null, broadcaster });
  await svc.markGuestRead({ rawToken: "tok" });
  assert.ok(executed.some((e) => e.sql.includes("UPDATE chat_guest_sessions") && e.sql.includes("guest_last_read_at")));
  assert.ok(broadcaster.events.some((e) => e.event === "guest_read" && e.channel === "chat:conv:conv-1"));
});

test("markExternalRead broadcasts operator_read", async () => {
  const broadcaster = makeBroadcaster();
  const prisma = {
    async $queryRaw() { return [{ id: "profile-1" }]; },
    async $executeRaw() { return 1; },
  };
  const svc = createChatExternalInboxService({ prisma, broadcaster });
  await svc.markExternalRead({ conversationId: "conv-5", authUserId: "auth-1" });
  assert.ok(broadcaster.events.some((e) => e.event === "operator_read" && e.channel === "chat:conv:conv-5"));
});
```

- [ ] **Step 2: Run — verify fail**

Run: `node --test apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js`
Expected: FAIL — `svc.markGuestRead is not a function` / no `operator_read` event.

- [ ] **Step 3: Implement `markGuestRead` in `guest-service.js`**

```js
async function markGuestRead({ rawToken }) {
  const session = await resolveGuestSession(rawToken);
  const convRows = await prisma.$queryRaw`
    SELECT c.id FROM chat_conversations c
    INNER JOIN chat_conversation_members ccm
      ON ccm.conversation_id = c.id AND ccm.guest_session_id = ${session.id}
    WHERE c.deleted_at IS NULL
    ORDER BY c.created_at DESC LIMIT 1
  `;
  await prisma.$executeRaw`
    UPDATE chat_guest_sessions SET guest_last_read_at = NOW(), last_seen_at = NOW()
    WHERE id = ${session.id}
  `;
  if (convRows.length) {
    broadcaster?.broadcastToChannel(`chat:conv:${convRows[0].id}`, "guest_read", {
      conversationId: convRows[0].id, at: new Date().toISOString(),
    });
  }
  return { ok: true };
}
```
Export it.

- [ ] **Step 4: `listGuestMessages` returns `operatorLastReadAt`**

In `listGuestMessages`, after `conversationId` is resolved and before/after the messages query, add:
```js
const readRows = await prisma.$queryRaw`
  SELECT MAX(last_read_at) AS operator_last_read_at
  FROM chat_conversation_members
  WHERE conversation_id = ${conversationId} AND user_id IS NOT NULL AND left_at IS NULL
`;
```
Change the return from `{ data: rows.reverse(), conversationId }` to:
```js
return { data: rows.reverse(), conversationId, operatorLastReadAt: readRows[0]?.operator_last_read_at ?? null };
```

- [ ] **Step 5: `markExternalRead` broadcasts `operator_read`**

In `chat-external-inbox-service.js#markExternalRead`, after the two `UPDATE chat_conversation_members` statements, add:
```js
broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "operator_read", {
  conversationId, at: new Date().toISOString(),
});
```

- [ ] **Step 6: `listExternalInbox` selects `guest_last_read_at`**

In `chat-external-inbox-service.js#listExternalInbox`, in the big `SELECT`, add `gs.guest_last_read_at` to the list of `gs.*` columns already being selected (next to `gs.idle_expires_at`).

- [ ] **Step 7: Add the public read route in `index.js`**

```js
// POST /public/chat/session/:token/read
pub.post("/session/:token/read", async (c) => {
  try {
    await guestService.markGuestRead({ rawToken: c.req.param("token") });
    return c.body(null, 204);
  } catch (err) {
    return handleError(c, err, "Error marcando como leido.");
  }
});
```

- [ ] **Step 8: Run tests — verify pass**

Run:
```bash
node --test apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js
node --test apps/api/src/routes/chat/__tests__/
```
Expected: new tests PASS; no regressions.

- [ ] **Step 9: Commit**

```bash
node --check apps/api/src/routes/chat/index.js
git add apps/api/src/routes/chat/guest-service.js apps/api/src/routes/chat/chat-external-inbox-service.js apps/api/src/routes/chat/index.js apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js
git commit -m "$(cat <<'EOF'
feat(chat): read receipts for external support chat

Guest: POST /public/chat/session/:token/read sets guest_last_read_at + guest_read broadcast.
Operator: markExternalRead now emits operator_read; listExternalInbox exposes guest_last_read_at;
listGuestMessages returns operatorLastReadAt.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Endpoint — operator deletes an external message

**Files:**
- Modify: `apps/api/src/routes/chat/index.js` (`internal.delete("/external/:conversationId/messages/:messageId", …)`)
- Test: `apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js` (extend) — or a route-level test if `chat-service.test.js` mounts the app

`chatService.deleteMessage({ messageId, authUserId })` already enforces "author only" + soft-delete. No new service code.

- [ ] **Step 1: Write the failing test**

Append to `external-chat-realtime.test.js` a test that stubs `chatService`:
```js
test("DELETE external message route delegates to chatService.deleteMessage and broadcasts", async () => {
  // This mirrors the route body: verify the two collaborators are called.
  const broadcaster = makeBroadcaster();
  const chatService = {
    deleteMessage: async ({ messageId, authUserId }) => {
      assert.equal(messageId, "msg-7");
      assert.equal(authUserId, "auth-1");
      return { ok: true };
    },
  };
  // Simulate the handler inline (the route is a thin wrapper):
  async function handler({ conversationId, messageId, authUserId }) {
    const r = await chatService.deleteMessage({ messageId, authUserId });
    broadcaster.broadcastToChannel(`chat:conv:${conversationId}`, "new_operator_message", { conversationId, messageId, deleted: true });
    return r;
  }
  const res = await handler({ conversationId: "conv-1", messageId: "msg-7", authUserId: "auth-1" });
  assert.deepEqual(res, { ok: true });
  assert.ok(broadcaster.events.some((e) => e.event === "new_operator_message" && e.payload.deleted === true));
});
```
> If `chat-service.test.js` already mounts the Hono app with a fake prisma, prefer a real route test there instead: `await app.request("/chat/external/conv-1/messages/msg-7", { method: "DELETE", headers })` and assert 200 + soft-delete SQL.

- [ ] **Step 2: Run — verify fail (or red for the route test)**

Run: `node --test apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js`
Expected: the new test fails until the assertions match a real implementation shape (for the inline-simulation test it may pass immediately — in that case treat Step 3 as "make the real route match this shape").

- [ ] **Step 3: Add the route in `index.js`**

Near `internal.post("/external/:conversationId/close", …)`:
```js
// DELETE /chat/external/:conversationId/messages/:messageId
internal.delete("/external/:conversationId/messages/:messageId", requirePermission("chat.support.manage"), async (c) => {
  try {
    const authUserId = c.get("authUserId");
    const conversationId = c.req.param("conversationId");
    const messageId = c.req.param("messageId");
    const result = await chatService.deleteMessage({ messageId, authUserId });
    broadcaster?.broadcastToChannel(`chat:conv:${conversationId}`, "new_operator_message", {
      conversationId, messageId, deleted: true,
    });
    return c.json(result);
  } catch (err) {
    return handleError(c, err, "Error eliminando mensaje.");
  }
});
```

- [ ] **Step 4: Run — verify pass**

Run: `node --test apps/api/src/routes/chat/__tests__/`
Expected: green.

- [ ] **Step 5: Commit**

```bash
node --check apps/api/src/routes/chat/index.js
git add apps/api/src/routes/chat/index.js apps/api/src/routes/chat/__tests__/external-chat-realtime.test.js
git commit -m "$(cat <<'EOF'
feat(chat): DELETE /chat/external/:id/messages/:messageId for operators

Reuses chatService.deleteMessage (author-only, soft-delete) and broadcasts a
deleted marker so the guest widget refreshes.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: SDK methods — internal (`@atlas/sdk`) and storefront (`@raulbellosom/atlas-sdk`)

**Files:**
- Modify: `packages/sdk/src/domains/chat.js` (`sendExternalTyping`, `deleteExternalMessage`)
- Modify: `packages/storefront-sdk/src/guestChat.js` (`sendTyping`, `markRead`, `getAttachmentUrl`; extend `subscribeToReplies`; `listMessages` return shape)
- Modify: `packages/storefront-sdk/src/react/useGuestChat.js` (consume new `listMessages` shape)
- Test: `packages/storefront-sdk` — check for an existing test setup; if none, add `packages/storefront-sdk/src/__tests__/guestChat.test.js` runnable via `node --test`

- [ ] **Step 1: Internal SDK — add two methods**

In `packages/sdk/src/domains/chat.js`, in the "External inbox (operators)" block, add:
```js
sendExternalTyping: (conversationId, token) =>
  request(`/chat/external/${encodeURIComponent(conversationId)}/typing`, {
    method: "POST",
    headers: withAuthHeaders(token),
    body: JSON.stringify({}),
  }),

deleteExternalMessage: (conversationId, messageId, token) =>
  request(
    `/chat/external/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    { method: "DELETE", headers: withAuthHeaders(token) },
  ),
```

- [ ] **Step 2: Storefront SDK — add methods + extend subscribe + change listMessages**

In `packages/storefront-sdk/src/guestChat.js`:

Add to the returned object:
```js
async function sendTyping(token) {
  return request('POST', `/public/chat/session/${token}/typing`)
}
async function markRead(token) {
  return request('POST', `/public/chat/session/${token}/read`)
}
async function getAttachmentUrl(token, attachmentId) {
  const res = await request('GET', `/public/chat/session/${token}/attachments/${attachmentId}/url`)
  return res?.data?.url ?? null
}
```

Change `listMessages` to return `{ messages, operatorLastReadAt }`:
```js
async function listMessages(token, { limit = 40, before = null } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', before)
  const res = await request('GET', `/public/chat/session/${token}/messages?${params}`)
  const raw = res.data
  const arr = Array.isArray(raw) ? raw : []
  const messages = arr.map((m) => ({
    id: m.id,
    body: m.body,
    sender_type: m.senderType ?? m.sender_type,
    message_type: m.messageType ?? m.message_type,
    created_at: m.createdAt ?? m.created_at,
    senderName: m.sender?.displayName ?? null,
    senderAvatarUrl: m.sender?.avatarUrl ?? null,
    metadata: m.metadata ?? null,
    attachments: m.attachments ?? null,
  }))
  return { messages, operatorLastReadAt: res.operatorLastReadAt ?? null }
}
```

Extend `subscribeToReplies` to an options object while staying back-compatible:
```js
function subscribeToReplies(conversationId, arg2, legacyOnClose) {
  const opts = typeof arg2 === 'function' ? { onMessage: arg2, onClose: legacyOnClose } : (arg2 || {})
  const { onMessage, onTyping, onRead, onClose } = opts
  let channel = null
  let cancelled = false
  async function setup() {
    let client
    try { client = await _getRealtimeClient() } catch { return }
    if (cancelled) return
    channel = client
      .channel(`chat:conv:${conversationId}`)
      .on('broadcast', { event: 'new_operator_message' }, ({ payload }) => onMessage?.(payload))
      .on('broadcast', { event: 'operator_typing' }, ({ payload }) => onTyping?.(payload))
      .on('broadcast', { event: 'operator_read' }, ({ payload }) => onRead?.(payload))
      .on('broadcast', { event: 'conversation_closed' }, () => onClose?.())
      .subscribe()
  }
  setup().catch(() => {})
  return function unsubscribe() {
    cancelled = true
    if (channel && _realtimeClient) _realtimeClient.removeChannel(channel).catch(() => {})
  }
}
```

Add `sendTyping`, `markRead`, `getAttachmentUrl` to the final `return { … }`.

- [ ] **Step 3: Update `useGuestChat.js` for the new `listMessages` shape**

In `packages/storefront-sdk/src/react/useGuestChat.js`, every `sdk.guestChat.listMessages(...)` call currently expects an array. Update the three call sites:

- Mount restore effect: `.then((res) => { if (res?.messages) setMessages(res.messages); if (res?.operatorLastReadAt) setOperatorLastReadAt(res.operatorLastReadAt); })`
- `resumeByCode`: `const res = await sdk.guestChat.listMessages(res.token); if (res?.messages) setMessages(res.messages)`  ← rename local to avoid shadowing; use `const msgRes = ...`
- 8s poll effect: `const res = await sdk.guestChat.listMessages(session.token); const msgs = res?.messages; if (!Array.isArray(msgs)) return; ...`

Add state + wiring:
```js
const [operatorTyping, setOperatorTyping] = useState(false)
const [operatorLastReadAt, setOperatorLastReadAt] = useState(null)
const typingClearRef = useRef(null)
```
In the realtime subscribe effect, switch to the options form:
```js
const unsub = sdk.guestChat.subscribeToReplies(session.conversationId, {
  onMessage: (payload) => { /* existing dedupe/append logic */ },
  onTyping: () => {
    setOperatorTyping(true)
    clearTimeout(typingClearRef.current)
    typingClearRef.current = setTimeout(() => setOperatorTyping(false), 4000)
  },
  onRead: (payload) => setOperatorLastReadAt(payload?.at ?? new Date().toISOString()),
  onClose: () => setIsClosed(true),
})
```
Add `sendTyping` / `markRead` wrappers that use `session?.token`, and return `operatorTyping`, `operatorLastReadAt`, `sendTyping`, `markRead` from the hook.

- [ ] **Step 4: Test the SDK pure logic**

Check for an existing runner: `cat packages/storefront-sdk/package.json`. If there's a `test` script using `node --test`, add `packages/storefront-sdk/src/__tests__/guestChat.test.js`; otherwise create it and run with `node --test` directly:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuestChatDomain } from "../guestChat.js";

test("listMessages returns { messages, operatorLastReadAt }", async () => {
  const request = async () => ({ data: [{ id: "m1", body: "hi", senderType: "guest", createdAt: "t" }], operatorLastReadAt: "2026-09-08T00:00:00Z" });
  const d = createGuestChatDomain(request, "http://x", "anon");
  const res = await d.listMessages("tok");
  assert.equal(res.messages.length, 1);
  assert.equal(res.messages[0].sender_type, "guest");
  assert.equal(res.operatorLastReadAt, "2026-09-08T00:00:00Z");
});

test("sendTyping and markRead hit the right paths", async () => {
  const calls = [];
  const request = async (method, path) => { calls.push([method, path]); return {}; };
  const d = createGuestChatDomain(request, "http://x", "anon");
  await d.sendTyping("tok");
  await d.markRead("tok");
  assert.deepEqual(calls, [["POST", "/public/chat/session/tok/typing"], ["POST", "/public/chat/session/tok/read"]]);
});

test("getAttachmentUrl unwraps res.data.url", async () => {
  const request = async () => ({ data: { url: "https://signed" } });
  const d = createGuestChatDomain(request, "http://x", "anon");
  assert.equal(await d.getAttachmentUrl("tok", "att-1"), "https://signed");
});

test("subscribeToReplies still accepts a bare onMessage function", () => {
  const d = createGuestChatDomain(async () => ({}), "", "");
  const unsub = d.subscribeToReplies("conv-1", () => {}, () => {});
  assert.equal(typeof unsub, "function");
  unsub();
});
```
Run: `node --test packages/storefront-sdk/src/__tests__/guestChat.test.js`
Expected: PASS.

- [ ] **Step 5: Build both SDKs**

Run:
```bash
pnpm --filter @atlas/sdk build
pnpm --filter @raulbellosom/atlas-sdk build
```
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/domains/chat.js packages/storefront-sdk/src/guestChat.js packages/storefront-sdk/src/react/useGuestChat.js packages/storefront-sdk/src/__tests__/guestChat.test.js
git commit -m "$(cat <<'EOF'
feat(sdk): external-chat typing/read/attachment-url methods

Internal SDK: sendExternalTyping, deleteExternalMessage.
Storefront SDK: sendTyping, markRead, getAttachmentUrl; subscribeToReplies gains
operator_typing/operator_read (back-compatible with the bare-function form);
listMessages now returns { messages, operatorLastReadAt }; useGuestChat updated.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Phase 1 gate — full API suite + lint

- [ ] **Step 1: Run the whole chat test dir**

Run: `node --test apps/api/src/routes/chat/__tests__/`
Expected: all green (record the count).

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors (the `no-restricted-syntax` local-date rule especially — we used `new Date().toISOString()` for broadcast payload timestamps, which is a real UTC instant, not a local-date derivation, so it is allowed; if the rule flags a line, add `// eslint-disable-next-line ... -- ISO instant for realtime payload, not a local date`).

- [ ] **Step 3: Commit any lint fixups**

```bash
git add -A && git commit -m "chore(chat): lint fixups for phase 1" || echo "nothing to commit"
```

---

## Phase 2 — `useChatWindowData` + internal path (zero behavior change)

### Task 10: Extract `ChatHeader` to its own file

**Files:**
- Create: `apps/desktop/src/modules/atlas.chat/components/ChatHeader.jsx`
- Modify: `apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx`

- [ ] **Step 1: Move the component**

Cut the entire `function ChatHeader({ … }) { … }` definition (currently ~lines 59–400 of `ChatWindow.jsx`) into a new `components/ChatHeader.jsx`. Add the imports it needs at the top of the new file (from the current `ChatWindow.jsx` import block): `useState, useEffect, useRef` from react; `Button, DropdownMenu*, ConfirmDialog` from `@atlas/ui`; the lucide icons it uses; `usePinnedMessages` from `../hooks/usePinnedMessages`; `useGlobalPresence` from `../../../providers/RealtimeProvider`; `ConversationTypeBadge`, `MemberAvatarStack`; `getConversationDisplayName, getConversationTitleLabel` from `../lib/chatUtils`; `formatLastSeen` (move the helper too, or inline it — it's only used by ChatHeader). Export `export function ChatHeader(...)`.

- [ ] **Step 2: Import it back into `ChatWindow.jsx`**

Add: `import { ChatHeader } from "./ChatHeader";` and remove the now-dead imports from `ChatWindow.jsx` that were only used by `ChatHeader` (check each: `DropdownMenu*`, `ConfirmDialog`, `MemberAvatarStack`, `ConversationTypeBadge`, `formatLastSeen`, and any icons no longer referenced in the remainder of the file). Leave imports still used by `ChatWindow` body.

- [ ] **Step 3: Verify no behavior change**

Run:
```bash
node --check apps/desktop/src/modules/atlas.chat/components/ChatHeader.jsx
node --check apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx
pnpm --filter @atlas/desktop build
```
Expected: build passes. `wc -l apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx` should now be well under 1000.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/atlas.chat/components/ChatHeader.jsx apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx
git commit -m "$(cat <<'EOF'
refactor(chat): extract ChatHeader into its own file

Pure move, no behavior change. Makes room under the 1000-line limit for the
upcoming variant="external" branch.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `useExternalChatData` hook

**Files:**
- Create: `apps/desktop/src/modules/atlas.chat/hooks/useExternalChatData.js`
- Modify: `apps/desktop/src/modules/atlas.chat/hooks/useExternalInbox.js` (keep `useExternalInbox`; `useExternalChatData` supersedes `useExternalMessages`/`useSendExternalMessage`, which stay until Task 13 removes their last user)
- Test: `apps/desktop/src/modules/atlas.chat/hooks/__tests__/useExternalChatData.test.js` (create)

- [ ] **Step 1: Write the hook**

`useExternalChatData(conversationId, { enabled })` returns:
```
{ messages, isLoading, hasMore, isLoadingMore, loadMore,
  sendMessage, markRead, deleteMessage, deleteAttachment,
  toggleReaction, typingUsers, guestLastReadAt }
```
Implementation notes (mirror `useChatMessages.js` for pagination, `useExternalInbox.js` for the realtime subscription):

```js
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../../auth/AuthProvider";
import { atlas } from "../../../lib/atlas";
import { subscribeToMultiBroadcast } from "../lib/supabaseRealtime";
import { useToggleReaction } from "./useChatMessages";

export function useExternalChatData(conversationId, { enabled = true } = {}) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const on = Boolean(enabled && token && conversationId);

  const [olderMessages, setOlderMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [guestTyping, setGuestTyping] = useState(false);
  const [guestLastReadAt, setGuestLastReadAt] = useState(null);
  const typingClearRef = useRef(null);
  const initedRef = useRef(false);

  const query = useQuery({
    queryKey: ["chat-external-messages", conversationId],
    queryFn: () => atlas.chat.listExternalMessages(conversationId, { limit: 40 }, token),
    enabled: on,
    staleTime: 10_000,
  });

  useEffect(() => {
    initedRef.current = false;
    setOlderMessages([]); setHasMore(false); setIsLoadingMore(false);
    setGuestTyping(false); setGuestLastReadAt(null);
  }, [conversationId]);

  useEffect(() => {
    if (query.data && !initedRef.current) {
      initedRef.current = true;
      setHasMore(query.data.hasMore ?? false);
    }
  }, [query.data]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || !on) return;
    const latest = queryClient.getQueryData(["chat-external-messages", conversationId])?.data ?? [];
    const oldest = olderMessages[0] ?? latest[0];
    if (!oldest?.created_at) return;
    setIsLoadingMore(true);
    try {
      const res = await atlas.chat.listExternalMessages(conversationId, { limit: 40, before: oldest.created_at }, token);
      const newOlder = res?.data ?? [];
      setOlderMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...newOlder.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasMore(res?.hasMore ?? false);
    } finally { setIsLoadingMore(false); }
  }, [isLoadingMore, hasMore, on, conversationId, olderMessages, token, queryClient]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["chat-external-messages", conversationId] });
    queryClient.invalidateQueries({ queryKey: ["chat-external-inbox"], exact: false });
  }, [queryClient, conversationId]);

  useEffect(() => {
    if (!on) return;
    const unsub = subscribeToMultiBroadcast(`chat:conv:${conversationId}`, {
      new_guest_message: invalidate,
      new_operator_message: invalidate,
      guest_typing: () => {
        setGuestTyping(true);
        clearTimeout(typingClearRef.current);
        typingClearRef.current = setTimeout(() => setGuestTyping(false), 4000);
      },
      guest_read: (p) => setGuestLastReadAt(p?.payload?.at ?? new Date().toISOString()),
    });
    return () => { unsub?.(); clearTimeout(typingClearRef.current); };
  }, [on, conversationId, invalidate]);

  const sendMut = useMutation({
    mutationFn: (data) => atlas.chat.sendExternalMessage(conversationId, data, token),
    onSuccess: invalidate,
  });
  const deleteMut = useMutation({
    mutationFn: (messageId) => atlas.chat.deleteExternalMessage(conversationId, messageId, token),
    onSuccess: invalidate,
  });
  const { mutate: toggleReactionMutate } = useToggleReaction(conversationId);

  const combined = [...olderMessages, ...(query.data?.data ?? [])];

  return {
    messages: combined,
    isLoading: query.isLoading,
    hasMore, isLoadingMore, loadMore,
    sendMessage: (data) => sendMut.mutateAsync(data),
    markRead: () => atlas.chat.markExternalRead(conversationId, token).catch(() => {}),
    deleteMessage: (id) => deleteMut.mutate(id),
    deleteAttachment: () => {},
    toggleReaction: (messageId, emoji, attachmentId) => toggleReactionMutate({ messageId, emoji, attachmentId }),
    typingUsers: guestTyping ? [{ id: "guest", name: "El visitante" }] : [],
    guestLastReadAt,
    sendTyping: () => atlas.chat.sendExternalTyping(conversationId, token).catch(() => {}),
  };
}
```

- [ ] **Step 2: Write the test**

Create `apps/desktop/src/modules/atlas.chat/hooks/__tests__/useExternalChatData.test.js`. If the desktop app has no React hook test runner, keep it minimal and pure: test the message-combine + `loadMore` de-dupe logic by extracting the combine into a tiny exported helper `mergeExternalPages(older, latest)` and unit-testing that with `node --test`. Otherwise use the project's existing hook-testing utility (search `apps/desktop` for `renderHook`).

Minimal helper test:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeExternalPages } from "../useExternalChatData.js";

test("mergeExternalPages dedupes by id and keeps older-first order", () => {
  const older = [{ id: "a" }, { id: "b" }];
  const latest = [{ id: "b" }, { id: "c" }];
  assert.deepEqual(mergeExternalPages(older, latest).map((m) => m.id), ["a", "b", "c"]);
});
```
(Export `mergeExternalPages` from the hook file and use it for `combined`.)

- [ ] **Step 3: Run test + build**

Run:
```bash
node --test apps/desktop/src/modules/atlas.chat/hooks/__tests__/useExternalChatData.test.js
node --check apps/desktop/src/modules/atlas.chat/hooks/useExternalChatData.js
```
Expected: PASS / OK.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/atlas.chat/hooks/useExternalChatData.js apps/desktop/src/modules/atlas.chat/hooks/__tests__/useExternalChatData.test.js
git commit -m "$(cat <<'EOF'
feat(chat): useExternalChatData hook (operator side data for ChatWindow)

Same return shape as the internal chat hooks: messages + pagination + send/
delete/reaction/markRead + typingUsers + guestLastReadAt, backed by the
/chat/external/* endpoints and chat:conv:* broadcasts.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `useChatWindowData` + wire `ChatWindow` internal path

**Files:**
- Create: `apps/desktop/src/modules/atlas.chat/hooks/useChatWindowData.js`
- Modify: `apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx`

- [ ] **Step 1: Write `useInternalChatData` + `useChatWindowData`**

Create `hooks/useChatWindowData.js`:
```js
import {
  useChatMessages, useSendMessage, useMarkRead, useDeleteMessage,
  useDeleteAttachment, useToggleReaction,
} from "./useChatMessages";
import { useChatPresence } from "./useChatPresence";
import { mapTypingNames } from "../lib/meridian";
import { useExternalChatData } from "./useExternalChatData";

function useInternalChatData(conversationId, { enabled }) {
  const msgs = useChatMessages(enabled ? conversationId : null);
  const { mutateAsync: sendMessage } = useSendMessage(conversationId);
  const { mutate: markRead } = useMarkRead(conversationId);
  const { mutate: deleteMessage } = useDeleteMessage(conversationId);
  const { mutate: deleteAttachment, isPending, variables } = useDeleteAttachment(conversationId);
  const { mutate: toggleReaction } = useToggleReaction(conversationId);
  const { typingUsersList } = useChatPresence(enabled ? conversationId : null);
  return {
    messages: msgs.data?.data ?? [],
    isLoading: msgs.isLoading,
    hasMore: msgs.hasMore, isLoadingMore: msgs.isLoadingMore, loadMore: msgs.loadMore,
    sendMessage, markRead, deleteMessage,
    deleteAttachment,
    deletingAttachmentId: isPending ? variables : null,
    toggleReaction: (messageId, emoji, attachmentId) => toggleReaction({ messageId, emoji, attachmentId }),
    typingUsers: mapTypingNames(typingUsersList),
    guestLastReadAt: null,
    sendTyping: undefined,
  };
}

export function useChatWindowData(conversationId, variant) {
  const internal = useInternalChatData(conversationId, { enabled: variant !== "external" });
  const external = useExternalChatData(conversationId, { enabled: variant === "external" });
  return variant === "external" ? external : internal;
}
```
> Check the real signatures of `useSendMessage`/`useMarkRead`/`useDeleteMessage`/`useDeleteAttachment` in `useChatMessages.js` and adapt (some may return `{ mutate }` vs `{ mutateAsync }`; `ChatWindow` today uses `sendMessage` as `mutateAsync` and the rest as `mutate`). Keep the external `sendMessage` as an async fn to match.

- [ ] **Step 2: Wire `ChatWindow.jsx` to `useChatWindowData` (internal only for now)**

Add `variant = "internal"` to `ChatWindow`'s props. Replace the individual hook calls near the top (`useChatMessages`, `useSendMessage`, `useMarkRead`, `useDeleteMessage`, `useDeleteAttachment`, `useToggleReaction`, `useChatPresence`) with:
```js
const data = useChatWindowData(conversationId, variant);
```
Then substitute usages in the body: `messagesData?.data` -> `data.messages`; `hasMore`/`isLoadingMore`/`loadMore` -> `data.*`; `sendMessage` -> `data.sendMessage`; `markReadMutate` -> `data.markRead`; `deleteMessageMutate` -> `data.deleteMessage`; `deleteAttachmentMutate`/`isDeletingAttachment`/`deletingAttachmentId` -> `data.deleteAttachment` / `data.deletingAttachmentId`; `toggleReactionMutate({...})` -> `data.toggleReaction(messageId, emoji, attachmentId)`; `mapTypingNames(typingUsersList)` -> `data.typingUsers`.

Keep `onlineUsers`/`sendTyping` from a still-direct `useChatPresence(conversationId)` **only if** `variant !== "external"` — simplest: keep `const { onlineUsers, sendTyping } = useChatPresence(variant === "external" ? null : conversationId);` alongside, since `data.typingUsers` already covers the typing list. (Presence/online dots are internal-only.)

This is a large mechanical edit. Do it in one pass, then lean on the build + a manual smoke.

- [ ] **Step 3: Build + syntax check**

Run:
```bash
node --check apps/desktop/src/modules/atlas.chat/hooks/useChatWindowData.js
node --check apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx
pnpm --filter @atlas/desktop build
```
Expected: build passes.

- [ ] **Step 4: Manual smoke (internal chat unchanged)**

Run `pnpm dev`, open a normal DM and a channel: send a message, load older history, react, delete own message, see typing. All must work exactly as before. (No automated coverage here — the internal path is a pure refactor; the build + this smoke are the gate.)

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/atlas.chat/hooks/useChatWindowData.js apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx
git commit -m "$(cat <<'EOF'
refactor(chat): route ChatWindow data through useChatWindowData

Adds a variant prop (default "internal") and centralizes the ~7 data hooks behind
one selector. Internal path is unchanged behavior; external path lands next.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Phase 3 — `variant="external"` in ChatWindow + ExternalInboxScreen

### Task 13: `ChatHeader` external branch + `ChatWindow` external gating

**Files:**
- Modify: `apps/desktop/src/modules/atlas.chat/components/ChatHeader.jsx`
- Modify: `apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx`

- [ ] **Step 1: `ChatHeader` — add `variant` + `onCloseExternal` props and an external branch**

Add props `variant = "internal"`, `externalStatus = null`, `onCloseExternal = null`. Before the "Normal mode" return, add:
```jsx
if (variant === "external") {
  const guestName = conversation?.guest_name ?? conversation?.guest_email ?? "Visitante";
  const closed = externalStatus === "closed";
  return (
    <div className="chat-glass flex items-center gap-3 px-3 sm:px-4 py-3 shrink-0">
      {onClose && (
        <button type="button" onClick={onClose} className="md:hidden text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] shrink-0" aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <div className="h-9 w-9 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center text-sm font-semibold text-violet-600 dark:text-violet-300 uppercase shrink-0">
        {guestName[0]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="chat-font-display text-sm font-semibold truncate">{guestName}</p>
        {conversation?.guest_page_url && (
          <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">
            {conversation.guest_page_url.replace(/^https?:\/\//, "")}
          </p>
        )}
      </div>
      <button type="button" onClick={onSearchToggle} className={headerBtnCls} title="Buscar mensajes">
        <Search className="h-4 w-4" />
      </button>
      <button type="button" onClick={onToggleFilesView} title={filesView ? "Ver mensajes" : "Ver archivos"}
        className={[headerBtnCls, filesView ? "text-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]" : ""].join(" ")}>
        {filesView ? <MessageSquare className="h-4 w-4" /> : <FolderOpen className="h-4 w-4" />}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={headerBtnCls}><MoreVertical className="h-4 w-4" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEnterSelection}>
            <CheckSquare className="h-3.5 w-3.5 mr-2" />Seleccionar mensajes
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {!closed && onCloseExternal && (
        <Button size="sm" variant="outline" onClick={onCloseExternal} className="shrink-0">Cerrar</Button>
      )}
    </div>
  );
}
```
Keep the existing `searchMode` / `selectionMode` early returns above this — they already render fine for external.

- [ ] **Step 2: `ChatWindow` — pass external props + gate internal-only UI**

In `ChatWindow.jsx`:
- Compute `const isExternal = variant === "external";`
- `<ChatHeader … variant={variant} externalStatus={conversation?.status} onCloseExternal={isExternal ? handleCloseExternal : undefined} />` where
  ```js
  const handleCloseExternal = useCallback(async () => {
    await atlas.chat.closeExternal(conversationId, token);
    queryClient.invalidateQueries({ queryKey: ["chat-external-inbox"], exact: false });
  }, [conversationId, token, queryClient]);
  ```
  (import `atlas` + `useQueryClient` if not already there — `useQueryClient` is; add `atlas` from `../../../lib/atlas`).
- Guard these so they never run/render for `isExternal`: `useChatConversations`, `useChatConversationDetail`, `usePinnedMessages`, `useMeridianStatus`, `useCalls` results used in header/menu — most are already `type`-gated; add `&& !isExternal` to the `callsEnabled`, `onOpenMeridian`, `onArchive`, `onDeleteConversation`, `onOpenGuestLink` props passed to `ChatHeader` (pass `undefined` when `isExternal`).
- The MeridIAn panel / CallShareDialog / pinned sheet / thread panel JSX blocks: wrap the MeridIAn + CallShareDialog blocks with `{!isExternal && (…)}` (thread panel + forward modal stay — reachable and valid).
- `MessageComposer` props when `isExternal`: `conversationType="external_support"` (already flows from `conversation.type`), `onTyping={data.sendTyping}`, `placeholder="Responder al visitante..."`, and render it only when `conversation?.status !== "closed"`.
- Add the templates row above the composer when `isExternal` (import `ChatTemplatePopover` from `./ChatTemplatePopover`; copy the small block from the old `ExternalChatPane`, feeding `vars` from `conversation.guest_*` + `userProfile`).

- [ ] **Step 3: Build + syntax check**

Run:
```bash
node --check apps/desktop/src/modules/atlas.chat/components/ChatHeader.jsx
node --check apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx
pnpm --filter @atlas/desktop build
wc -l apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx apps/desktop/src/modules/atlas.chat/components/ChatHeader.jsx
```
Expected: build passes; both files under 1000 lines.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/modules/atlas.chat/components/ChatHeader.jsx apps/desktop/src/modules/atlas.chat/components/ChatWindow.jsx
git commit -m "$(cat <<'EOF'
feat(chat): ChatWindow variant="external" (header branch + internal-only gating)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: `ExternalInboxScreen` renders `ChatWindow`; delete `ExternalChatPane`

**Files:**
- Modify: `apps/desktop/src/modules/atlas.chat/screens/ExternalInboxScreen.jsx`

- [ ] **Step 1: Swap the center column**

In `ExternalInboxScreen.jsx`:
- Remove the `ExternalChatPane` function definition entirely.
- Remove now-unused imports: `ChatMessageList`, `MessageComposer`, `ChatTemplatePopover`, `useExternalMessages`, `useSendExternalMessage`, `useToggleReaction`, and the `playNotificationBeep` helper if only `ExternalChatPane` used it (keep it if the list still uses it — check).
- Add: `import { ChatWindow } from "../components/ChatWindow";`
- Replace `<ExternalChatPane conversation={selected} onBack={handleBack} />` with:
  ```jsx
  {selected ? (
    <ChatWindow conversation={selected} variant="external" onClose={handleBack} />
  ) : (
    <div className="flex-1 hidden md:flex items-center justify-center text-[hsl(var(--muted-foreground))]">
      <div className="text-center space-y-3">
        <div className="mx-auto h-14 w-14 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center">
          <MessageSquare className="h-7 w-7 text-[hsl(var(--primary)/0.4)]" />
        </div>
        <p className="text-sm">Selecciona una conversacion</p>
      </div>
    </div>
  )}
  ```
- Keep `VisitorInfoPanel`, `ReassignDropdown`, `useExpiryCountdown`, `ExternalConversationItem`, the availability toggle, search box, status tabs — all unchanged.

- [ ] **Step 2: `VisitorInfoPanel` — add "Visto por el visitante"**

In `VisitorInfoPanel`, after the "Estado" block, add:
```jsx
<div>
  <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-1">Lectura del visitante</p>
  <p className="text-xs text-[hsl(var(--muted-foreground))]">
    {conversation.guest_last_read_at
      ? `Visto ${formatRelative(conversation.guest_last_read_at)}`
      : "Aun no leido"}
  </p>
</div>
```
(`formatRelative` already exists in this file; `guest_last_read_at` now arrives on the inbox row from Task 6.)

- [ ] **Step 3: Build**

Run:
```bash
node --check apps/desktop/src/modules/atlas.chat/screens/ExternalInboxScreen.jsx
pnpm --filter @atlas/desktop build
grep -n "ExternalChatPane\|useExternalMessages\|useSendExternalMessage" apps/desktop/src/modules/atlas.chat/screens/ExternalInboxScreen.jsx
```
Expected: build passes; grep returns nothing.

- [ ] **Step 4: Clean up dead hooks (optional in this task)**

If `grep -rn "useExternalMessages\|useSendExternalMessage" apps/desktop --include=*.jsx --include=*.js | grep -v node_modules` now only matches their definitions in `useExternalInbox.js`, delete those two functions from `useExternalInbox.js` (keep `useExternalInbox` itself — still used by the screen).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/modules/atlas.chat/screens/ExternalInboxScreen.jsx apps/desktop/src/modules/atlas.chat/hooks/useExternalInbox.js
git commit -m "$(cat <<'EOF'
feat(chat): Bandeja externa reuses ChatWindow (variant="external")

Deletes the bespoke ExternalChatPane. Operator now gets history pagination,
reply, in-conversation search, delete/forward/select, attachment viewer, files
view, jump-to-message, and live "el visitante esta escribiendo". VisitorInfoPanel
shows "Visto por el visitante".

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Phase 3 gate — build, lint, responsive QA

- [ ] **Step 1: Build + lint**

Run: `pnpm build && pnpm lint`
Expected: green.

- [ ] **Step 2: Manual QA — operator**

`pnpm dev`. In Bandeja externa with at least one open external conversation:
- Send a reply; upload an image (paperclip) and confirm it appears as a bubble thumbnail and opens in the viewer.
- Scroll up → older history loads.
- Search icon → search within the conversation.
- Select mode → delete own message; forward a message to an internal channel.
- Reassign, Cerrar, availability toggle still work.
- No call buttons, no MeridIAn button, no entity-reference button, no pin UI.
- Type in the composer → (with a widget open on the other side) the widget shows typing; open the conversation → widget shows "Visto".

- [ ] **Step 3: Responsive QA — 390px and 1440px**

Run the 14-aspect checklist (`docs/ai-context/ui-screen-audit-checklist.md`) on Bandeja externa at both widths. Bottom sheets must not be full-bleed on desktop; the 3-column layout collapses to list/chat on mobile via the existing `mobileView` state; the visitor panel is `lg:` only. Screenshot both.

- [ ] **Step 4: Commit any QA fixups**

```bash
git add -A && git commit -m "fix(chat): external inbox responsive/QA fixups" || echo "nothing to commit"
```

---

## Phase 4 — Storefront widget

### Task 16: Inline image/file previews in `ChatWidget.jsx`

**Files:**
- Modify: `packages/storefront-sdk/src/react/ChatWidget.jsx`

- [ ] **Step 1: Add an attachment-URL cache + resolver**

Near the top of `ChatWidget`:
```js
const attUrlCacheRef = useRef(new Map())
const [, forceRerender] = useReducer((n) => n + 1, 0)

const resolveAttUrl = useCallback((attId) => {
  if (!attId || !session?.token) return null
  const cached = attUrlCacheRef.current.get(attId)
  if (cached) return cached
  attUrlCacheRef.current.set(attId, '') // in-flight guard
  sdk.guestChat.getAttachmentUrl(session.token, attId)
    .then((url) => { if (url) { attUrlCacheRef.current.set(attId, url); forceRerender() } })
    .catch(() => { attUrlCacheRef.current.delete(attId) })
  return null
}, [sdk, session])
```
Add `useReducer` to the React import.

- [ ] **Step 2: Render attachments in both bubble branches of `renderChat`**

Add a helper component inside the file:
```jsx
function Attachment({ att, url, onImageClick }) {
  const isImage = String(att.mimeType ?? att.mime_type ?? '').startsWith('image/')
  if (isImage) {
    if (!url) return <div style={{ width: 160, height: 120, background: '#2a2a38', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
    return <img src={url} alt={att.fileName ?? att.file_name ?? ''} onClick={() => onImageClick(url)} onError={onImageClick && undefined}
      style={{ maxWidth: 180, maxHeight: 180, borderRadius: 8, cursor: 'pointer', objectFit: 'cover', display: 'block' }} />
  }
  return (
    <a href={url ?? undefined} target="_blank" rel="noopener noreferrer"
       style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#2a2a38', borderRadius: 8, padding: '8px 10px', textDecoration: 'none', color: '#ddd', fontSize: 12 }}>
      <ClipIcon color="#ccc" />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>{att.fileName ?? att.file_name ?? 'archivo'}</span>
    </a>
  )
}
function Spinner() {
  return <span style={{ width: 16, height: 16, border: '2px solid #555', borderTopColor: '#aaa', borderRadius: '50%', display: 'inline-block', animation: 'atlasspin 0.8s linear infinite' }} />
}
```
In each message branch, after the text bubble, if `msg.attachments?.length`, map them: `msg.attachments.map((att) => <Attachment key={att.id} att={att} url={resolveAttUrl(att.id)} onImageClick={setLightboxUrl} />)`.

- [ ] **Step 3: Lightbox overlay + keyframes**

Add state `const [lightboxUrl, setLightboxUrl] = useState(null)`. Before the closing fragment of the main render, add:
```jsx
{lightboxUrl && (
  <div onClick={() => setLightboxUrl(null)}
       style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <img src={lightboxUrl} alt="" style={{ maxWidth: '92%', maxHeight: '92%', borderRadius: 8 }} />
  </div>
)}
<style>{`@keyframes atlasspin { to { transform: rotate(360deg) } } @keyframes atlasblink { 50% { opacity: 0.25 } }`}</style>
```

- [ ] **Step 4: Build the SDK + typecheck**

Run: `pnpm --filter @raulbellosom/atlas-sdk build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/storefront-sdk/src/react/ChatWidget.jsx
git commit -m "$(cat <<'EOF'
feat(storefront): inline image/file previews in the chat widget

Images render as <=180px thumbnails (tap = lightbox), other files as download
cards. URLs come from the new guest attachment-URL endpoint, cached per id.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: Widget typing + read indicators

**Files:**
- Modify: `packages/storefront-sdk/src/react/ChatWidget.jsx`

`useGuestChat` already exposes `operatorTyping`, `operatorLastReadAt`, `sendTyping`, `markRead` after Task 8.

- [ ] **Step 1: Destructure the new values**

```js
const { /* …existing… */ operatorTyping, operatorLastReadAt, sendTyping, markRead } = useGuestChat(sdk)
```

- [ ] **Step 2: Send typing + read from the widget**

- In the `textarea onChange` handler, after `setTextInput(...)`, add a throttled call:
  ```js
  const now = Date.now()
  if (now - (typingSentAtRef.current ?? 0) > 3000) { typingSentAtRef.current = now; sendTyping() }
  ```
  Add `const typingSentAtRef = useRef(0)`.
- Add an effect: when `open && screen === 'chat'`, call `markRead()` on mount and whenever `messages.length` increases while open:
  ```js
  useEffect(() => {
    if (open && screen === 'chat') markRead()
  }, [open, screen, messages.length, markRead])
  ```

- [ ] **Step 3: Render "escribiendo" row**

In `renderChat`, right before `<div ref={messagesEndRef} />`:
```jsx
{operatorTyping && (
  <div style={styles.operatorRow}>
    <div style={styles.operatorAvatar}>·</div>
    <div style={s(styles.msgBubbleOperator, { display: 'flex', gap: 3, alignItems: 'center' })}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#888', display: 'inline-block', animation: `atlasblink 1s ${i * 0.15}s infinite` }} />
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 4: Render "Visto" under the visitor's last message**

Compute once in `renderChat`:
```js
const lastGuestMsg = [...messages].reverse().find((m) => m.sender_type === 'guest')
const seen = lastGuestMsg && operatorLastReadAt && new Date(operatorLastReadAt) >= new Date(lastGuestMsg.created_at)
```
In the guest-branch render, when `msg.id === lastGuestMsg?.id`, append below the timestamp:
```jsx
<div style={s(styles.msgTimestamp, { color: seen ? '#86efac' : '#666' })}>{seen ? 'Visto' : 'Enviado'}</div>
```
(Only when `!String(msg.id).startsWith('temp-')`.)

- [ ] **Step 5: Build + commit**

Run: `pnpm --filter @raulbellosom/atlas-sdk build`
```bash
git add packages/storefront-sdk/src/react/ChatWidget.jsx
git commit -m "$(cat <<'EOF'
feat(storefront): typing + read indicators in the chat widget

Shows "el agente esta escribiendo" (operator_typing) and "Visto" on the
visitor's last message (operator_read / operatorLastReadAt). Widget also emits
guest typing (throttled) and marks read while open.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: Phase 4 gate — SDK tests, build, live verification

- [ ] **Step 1: SDK tests + build**

Run:
```bash
node --test packages/storefront-sdk/src/__tests__/guestChat.test.js
pnpm --filter @raulbellosom/atlas-sdk build
pnpm --filter @atlas/sdk build
```
Expected: green.

- [ ] **Step 2: Live end-to-end with the test site**

- `pnpm dev` (API + web).
- In `C:\path\to\storefront`: point its `.env.development` API base at the local API if not already, `pnpm dev`, open the site.
- From the widget: start a chat, send a text, send an image → thumbnail shows in the widget AND in Bandeja externa; click → lightbox.
- Operator replies with an image → shows as thumbnail in the widget.
- Operator types → widget shows "escribiendo"; operator opens/reads → widget shows "Visto".
- Visitor types → Bandeja externa shows "El visitante esta escribiendo"; visitor has widget open → VisitorInfoPanel shows "Visto <time>".
- Operator deletes their message → widget drops it within one poll cycle.

- [ ] **Step 3: Note the deploy step (do not execute)**

Record in the PR/commit body: shipping the widget requires `pnpm --filter @raulbellosom/atlas-sdk build`, publish/bump of `@raulbellosom/atlas-sdk`, and redeploy of any site embedding it. Not done here.

- [ ] **Step 4: Final full-repo gate**

Run:
```bash
node --test apps/api/src/routes/chat/__tests__/
pnpm build
pnpm lint
```
Expected: all green.

- [ ] **Step 5: Update `docs/TASKS.md`**

Add a one-line entry under the atlas.chat section noting external-chat feature parity (operator ChatWindow reuse + storefront widget previews/typing/read) shipped `2026-09-08`, with `Verified: 2026-09-08 (manual live test with racoondevs site)` only if Step 2 actually passed on-device.

- [ ] **Step 6: Commit**

```bash
git add docs/TASKS.md
git commit -m "$(cat <<'EOF'
docs(tasks): external chat feature parity shipped

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- §3 Cleanup → Task 1. ✅
- §4.1 attachment link fix → Task 3. ✅
- §4.2 attachment URL endpoint → Task 4. ✅
- §4.3/4.4 typing both directions → Task 5. ✅
- §4.5 read receipts (migration, guest write, operator broadcast, exposure) → Task 2 + Task 6. ✅
- §4.6 operator delete → Task 7. ✅
- §4.7 validators → covered by note in Task 3 (schema already allows `metadata`); no code needed. ✅
- §4.8/4.9 SDKs → Task 8. ✅
- §5.1 variant prop + screen wiring → Task 12 + Task 14. ✅
- §5.2 useChatWindowData / useExternalChatData → Task 11 + Task 12. ✅
- §5.3 gating (archive/delete/forward) → Task 13. ✅
- §5.4 external header + Cerrar + ChatHeader extraction → Task 10 + Task 13. ✅
- §5.5 "Visto por el visitante" → Task 14 Step 2. ✅
- §5.6 typing indicator + operator onTyping → Task 11 (typingUsers) + Task 13 (composer onTyping). ✅
- §6.1 previews + lightbox → Task 16. ✅
- §6.2 guest sends typing/read → Task 17 Step 2. ✅
- §6.3 useGuestChat + subscribeToReplies extension + listMessages shape → Task 8 Step 2/3. ✅
- §6.4 "escribiendo"/"Visto" render → Task 17 Step 3/4. ✅
- §6.5 dist rebuild → Task 8 Step 5, Task 16/17 builds, Task 18 Step 3 note. ✅
- §7 data model → Task 2. ✅
- §9 tests → Tasks 3, 4, 5, 6, 8, 11, plus manual QA gates in Tasks 15 & 18. ✅

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". A few steps say "match the existing harness style of `chat-service.test.js`" / "check the real signatures" — these are explicit verification instructions with concrete fallbacks (stub shapes and helper extraction given inline), not deferred work.

**Type consistency:**
- `useExternalChatData` / `useInternalChatData` / `useChatWindowData` all return the same keys: `messages, isLoading, hasMore, isLoadingMore, loadMore, sendMessage, markRead, deleteMessage, deleteAttachment, deletingAttachmentId?, toggleReaction(messageId,emoji,attachmentId), typingUsers, guestLastReadAt, sendTyping?`. `ChatWindow` (Task 12/13) consumes exactly these. ✅
- `subscribeToReplies(conversationId, { onMessage, onTyping, onRead, onClose })` defined in Task 8, consumed in Task 8 Step 3 (`useGuestChat`). Back-compat function form preserved. ✅
- `listMessages` → `{ messages, operatorLastReadAt }` defined Task 8 Step 2, consumed Task 8 Step 3 (all three call sites) + Task 17 (`operatorLastReadAt`). ✅
- Broadcast event names consistent everywhere: `guest_typing`, `operator_typing`, `guest_read`, `operator_read`, `new_guest_message`, `new_operator_message`. ✅
- SDK method names: `sendExternalTyping`, `deleteExternalMessage` (internal); `sendTyping`, `markRead`, `getAttachmentUrl` (storefront) — used consistently in Tasks 11, 13, 16, 17. ✅
- Service methods: `getGuestAttachmentUrl`, `broadcastGuestTyping`, `markGuestRead` (guest-service); `broadcastOperatorTyping` (external-inbox-service) — defined and routed consistently in Tasks 4–7. ✅
