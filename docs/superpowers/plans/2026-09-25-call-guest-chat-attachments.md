# Chat de invitados de llamada con adjuntos — Implementation Plan

Date: 2026-09-25
Spec: docs/superpowers/specs/2026-09-25-call-guest-chat-attachments-design.md
Status: Implemented — automated checks pass; manual QA in a live dev environment pending (see docs/superpowers/verification/2026-09-25-call-guest-chat-attachments.md)

> **For agentic workers:** Declare `Mode: IMPLEMENTATION` before starting. Do not begin coding until the spec is approved and this plan is approved. Use checkbox syntax (`- [ ]`) to track progress. Mark each task completed only after its validation commands pass.

## Goal

Let a `call_guest` (video call guest) attach a file to a message in the
call's chat, using the same presign → upload → link pattern already proven
for the external website guest (`chat_guest_sessions`), so the attachment
lands in the call's real conversation exactly like any other
`chat_messages` row and is visible to members in `ChatWindow` during and
after the call. No schema migration, no RBAC change, no new routes on the
member side — matches spec §5 Goals 1–4 exactly, nothing beyond it.

## Architecture summary

This plan replicates, field-for-field, the already-shipped and tested
unauthenticated-guest-attachment pattern from
`apps/api/src/routes/chat/index.js` (`/public/chat/session/:token/attachments/presign`
+ `.../attachments/:id/url`) and `guest-service.js`'s `sendGuestMessage`
link logic, onto the `call_guest` surface (`call-guest-service.js`,
`call-messages-service.js`, `guest-routes.js`). No new Supabase Storage
bucket, no new `chat_attachments` column — `uploaded_by_user_id` is already
nullable and the external-guest path already inserts without it (spec §10).
On the frontend, `RoomChatView.jsx` (the shared presentational component
already used by both the retired member path and the guest path — see spec
§3) gains an attach button and attachment rendering; a new
`useGuestChatUpload.js` hook mirrors the existing `useChatUpload.js`
presign+PUT flow but authenticates with the guest token instead of a member
session. The LiveKit data-channel "instant echo" used for text messages is
deliberately NOT extended to carry attachment payloads (spec §8 UX,
implicit scope cut) — an attachment message reaches other guests in the
room via the existing 2.5s state poll, same as it already reaches members
via the existing Realtime broadcast in `postGuestMessage` (unaffected by
this plan).

---

## File Structure Map

### Create

- `apps/desktop/src/modules/runly.chat/calls/guest/useGuestChatUpload.js`

### Modify

- `packages/validators/src/calls.js` — `callRoomMessageSchema` relaxed + new `callGuestAttachmentPresignSchema`
- `packages/sdk/src/domains/calls.js` — `guest.presignAttachment`, `guest.getAttachmentUrl`, `guest.sendMessage` gains a `metadata` param
- `apps/api/src/routes/calls/call-guest-service.js` — `presignGuestAttachmentUpload`, `getGuestAttachmentUrl`; `getGuestState`'s message query gains an `attachments` json_agg column
- `apps/api/src/routes/calls/call-messages-service.js` — `postGuestMessage` links `metadata.attachmentId`, bumps `attachment_count`, includes `attachments` in the returned message shape
- `apps/api/src/routes/calls/guest-routes.js` — two new routes; `/messages` route passes `metadata` through to the parsed body
- `apps/api/src/routes/calls/__tests__/call-guest-service.test.js` — tests for the two new functions
- `apps/api/src/routes/calls/__tests__/call-messages-service.test.js` — tests for attachment linking in `postGuestMessage`
- `apps/desktop/src/modules/runly.chat/calls/guest/useGuestCall.js` — exposes `presignAttachment`/`getAttachmentUrl`; `sendMessage` accepts and forwards `metadata`
- `apps/desktop/src/modules/runly.chat/calls/guest/GuestCallScreen.jsx` — passes the two new props through to `GuestCallRoom`
- `apps/desktop/src/modules/runly.chat/calls/guest/GuestCallRoom.jsx` — wires upload/resolve functions into `GuestRoomChat`; `publishChat` accepts an optional `attachmentId` and skips the text-echo broadcast when `body` is empty
- `apps/desktop/src/modules/runly.chat/calls/guest/GuestRoomChat.jsx` — forwards the new props to `RoomChatView`
- `apps/desktop/src/modules/runly.chat/calls/RoomChatView.jsx` — attach button, upload/error state, attachment rendering (image thumbnail / file chip), `onSend(body, attachmentId?)`

No changes to `prisma/schema.prisma`, no new migration, no manifest, no navigation, no permission catalog entries — consistent with spec §§11, 15–18.

---

## Task 1 — Validators

**Files:**
- Modify: `packages/validators/src/calls.js`

**Changes:**

- [x] Relax `callRoomMessageSchema.body` from `z.string().trim().min(1).max(4000)` to `z.string().trim().max(4000)`.
- [x] Add `metadata: z.object({ attachmentId: z.string().uuid() }).optional()` to `callRoomMessageSchema`.
- [x] Add a `.refine((v) => v.body.length > 0 || Boolean(v.metadata?.attachmentId), { message: "El mensaje no puede estar vacío." })` to `callRoomMessageSchema`.
- [x] Add `callGuestAttachmentPresignSchema = z.object({ fileName: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() })` and export it.

**Validation:**

```bash
node --check packages/validators/src/calls.js
```

Success: exits 0. (No dedicated test file exists for `calls.js` today — the schemas are exercised indirectly by Task 5's route-level tests.)

---

## Task 2 — Backend: guest attachment presign + read (`call-guest-service.js`)

**Files:**
- Modify: `apps/api/src/routes/calls/call-guest-service.js`

**Changes:**

- [x] Import `crypto` (already imported at the top for guest IDs — reuse `crypto.randomUUID`).
- [x] Add `presignGuestAttachmentUpload({ guestToken, fileName, mimeType, sizeBytes })`:
  - Calls `resolveAdmittedGuestForMessage({ guestToken })` (existing function — enforces `ADMITTED` + live call, same gate `postGuestMessage` already uses).
  - Loads `call = await liveCallById(callId)` for `conversationId`.
  - Validates `mimeType` against the same `ALLOWED_MIME` list used by `/public/chat/session/:token/attachments/presign` (`image/`, `application/pdf`, `text/plain`, `application/msword`, `application/vnd.openxmlformats`) and `sizeBytes <= 20 * 1024 * 1024`; throws `CallGuestError(msg, 422)` on failure with the exact Spanish messages from spec §12.
  - Builds `objectKey = \`conversations/${conversationId}/guest/${crypto.randomUUID()}.${ext}\`` (same prefix convention as the website-guest path).
  - Calls `supabaseAdmin.storage.from("runly-chat").createSignedUploadUrl(objectKey, { expiresIn: 300 })`; throws `CallGuestError("Error generando URL de subida.", 500)` on error.
  - Inserts into `chat_attachments (conversation_id, bucket, object_key, file_name, mime_type, size_bytes)` via `prisma.$queryRaw ... RETURNING id` (no `uploaded_by_user_id` — matches the nullable-column precedent in spec §10).
  - Returns `{ attachmentId, uploadUrl }`.
- [x] Add `getGuestAttachmentUrl({ guestToken, attachmentId })`:
  - Calls `resolveAdmittedGuestForMessage({ guestToken })`, then `liveCallById(callId)` for `conversationId`.
  - `SELECT bucket, object_key FROM chat_attachments WHERE id = ${attachmentId}::uuid AND conversation_id = ${conversationId}::uuid LIMIT 1`; throws `CallGuestError("Adjunto no encontrado.", 404)` if empty.
  - `supabaseAdmin.storage.from(bucket).createSignedUrl(objectKey, 300)`; throws `CallGuestError("Error generando URL del adjunto.", 500)` on error.
  - Returns `{ url, expiresIn: 300 }`.
- [x] Export both from the factory's return object.
- [x] Extend `getGuestState`'s message query (the `SELECT ... FROM chat_messages m ...` block) with an `attachments` column, mirroring the `json_agg` subquery pattern already used in `apps/api/src/routes/chat/guest-service.js` (lines ~530–539):
  ```sql
  (
    SELECT json_agg(json_build_object(
      'id', a.id, 'fileName', a.file_name, 'mimeType', a.mime_type, 'sizeBytes', a.size_bytes
    ))
    FROM chat_attachments a WHERE a.message_id = m.id
  ) AS attachments
  ```
  (No `objectKey` in the payload — the guest never needs it directly, only the signed-URL endpoint does.)

**Validation:**

```bash
node --check apps/api/src/routes/calls/call-guest-service.js
```

---

## Task 3 — Backend: link attachments in `postGuestMessage` (`call-messages-service.js`)

**Files:**
- Modify: `apps/api/src/routes/calls/call-messages-service.js`

**Changes:**

- [x] `cleanBody(body)`: allow an empty string through unchanged (trim only, no throw) — the "must have body or attachment" invariant is now enforced by the Zod schema (Task 1) before this service ever runs, matching how the equivalent website-guest path relies on its own request-shape validation rather than duplicating the check server-side twice.
- [x] `postGuestMessage({ guestToken, body, metadata = {} })`: after the existing `INSERT INTO chat_messages` (unchanged), add the same link-and-bump block already used by `chat/guest-service.js`'s `sendGuestMessage` (spec §12, edge case 2):
  ```js
  let attachments = [];
  if (metadata?.attachmentId) {
    const linked = await prisma.$executeRaw`
      UPDATE chat_attachments SET message_id = ${messageId}
      WHERE id = ${metadata.attachmentId}::uuid
        AND conversation_id = ${call.conversationId}::uuid
        AND message_id IS NULL
    `;
    if (linked > 0) {
      await prisma.$executeRaw`
        UPDATE chat_messages SET attachment_count = attachment_count + ${linked} WHERE id = ${messageId}
      `;
      const rows = await prisma.$queryRaw`
        SELECT id, file_name AS "fileName", mime_type AS "mimeType", size_bytes AS "sizeBytes"
        FROM chat_attachments WHERE id = ${metadata.attachmentId}::uuid
      `;
      attachments = rows;
    }
  }
  ```
- [x] `shape(m)`: accept and pass through `attachments: m.attachments ?? []` so the guest's own optimistic local append (in `useGuestCall.js`) renders the attachment immediately.

**Validation:**

```bash
node --check apps/api/src/routes/calls/call-messages-service.js
```

---

## Task 4 — Backend: routes (`guest-routes.js`)

**Files:**
- Modify: `apps/api/src/routes/calls/guest-routes.js`

**Changes:**

- [x] Import `callGuestAttachmentPresignSchema` alongside the existing validator imports.
- [x] Add `app.post("/attachments/presign", ...)`: parse body with `callGuestAttachmentPresignSchema`, call `guestService.presignGuestAttachmentUpload({ guestToken: guestToken(c), ...data })`, return `c.json({ data }, 201)`; ZodError → 422 `{ error: "Datos inválidos." }`; other errors → existing `fail(c, error, "No se pudo generar la URL de subida.")`.
- [x] Add `app.get("/attachments/:attachmentId/url", ...)`: call `guestService.getGuestAttachmentUrl({ guestToken: guestToken(c), attachmentId: c.req.param("attachmentId") })`, return `c.json({ data })`; errors → `fail(c, error, "No se pudo obtener el adjunto.")`.
- [x] `/messages` route: change `const { body } = callRoomMessageSchema.parse(...)` to `const { body, metadata } = callRoomMessageSchema.parse(...)` and pass `metadata` through to `messagesService.postGuestMessage({ guestToken: guestToken(c), body, metadata })`.

**Validation:**

```bash
node --check apps/api/src/routes/calls/guest-routes.js
```

---

## Task 5 — Backend tests

**Files:**
- Modify: `apps/api/src/routes/calls/__tests__/call-guest-service.test.js`
- Modify: `apps/api/src/routes/calls/__tests__/call-messages-service.test.js`

**Changes:**

- [x] `call-guest-service.test.js`: add a `describe("presignGuestAttachmentUpload")` block covering: rejects a disallowed mime type (422), rejects >20MB (422), rejects a non-admitted/non-live guest (delegates to `resolveAdmittedGuestForMessage`'s existing error), and a happy path asserting the `chat_attachments` INSERT is scoped to the guest's own `conversationId` and no `uploaded_by_user_id` is set. Add a `describe("getGuestAttachmentUrl")` block covering: 404 when the attachment belongs to a different `conversationId`, and a happy path returning the signed URL.
- [x] `call-messages-service.test.js`: add cases mirroring `guest-attachment-link.test.js` (spec §26): (a) a message with `metadata.attachmentId` links the attachment and bumps `attachment_count`, and the returned `message.attachments` includes it; (b) a stale/foreign `attachmentId` (the scoped `UPDATE` returns 0 rows) results in no `attachment_count` bump and `attachments: []`, no error thrown; (c) an empty `body` with no `metadata.attachmentId` still rejects the same way it does today (the Zod-level guard from Task 1 is what actually blocks this in production, but `cleanBody`'s behavior after Task 3's change should be re-asserted here so the service-level contract stays documented); (d) an empty `body` WITH `metadata.attachmentId` now succeeds (attachment-only message).

**Validation:**

```bash
node --test apps/api/src/routes/calls/__tests__/call-guest-service.test.js apps/api/src/routes/calls/__tests__/call-messages-service.test.js
```

Success: all tests pass, including the pre-existing ones (no regression).

---

## Task 6 — SDK

**Files:**
- Modify: `packages/sdk/src/domains/calls.js`

**Changes:**

- [x] `guest.presignAttachment: (guestToken, payload) => guestJson("/calls/guest/attachments/presign", "POST", payload, guestToken)`
- [x] `guest.getAttachmentUrl: (guestToken, attachmentId) => guestJson(\`/calls/guest/attachments/${encodeURIComponent(attachmentId)}/url\`, "GET", undefined, guestToken)`
- [x] `guest.sendMessage: (guestToken, body, metadata) => guestJson("/calls/guest/messages", "POST", metadata ? { body, metadata } : { body }, guestToken)` — keeps existing 2-arg call sites (e.g. any other caller) working unchanged since `metadata` is optional and omitted from the payload when absent.

**Validation:**

```bash
node --check packages/sdk/src/domains/calls.js
```

---

## Task 7 — Frontend hook: `useGuestCall.js`

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/useGuestCall.js`

**Changes:**

- [x] `sendMessage` gains a second param: `sendMessage = useCallback(async (body, metadata) => { const res = unwrap(await runly.calls.guest.sendMessage(gtRef.current, body, metadata)); ... }, [])` (unchanged append-to-`messages` logic, now the appended `res.message` may carry `attachments`).
- [x] Add `presignAttachment = useCallback(async ({ fileName, mimeType, sizeBytes }) => unwrap(await runly.calls.guest.presignAttachment(gtRef.current, { fileName, mimeType, sizeBytes })), [])`.
- [x] Add `getAttachmentUrl = useCallback(async (attachmentId) => unwrap(await runly.calls.guest.getAttachmentUrl(gtRef.current, attachmentId)), [])`.
- [x] Return both from the hook alongside the existing `join, fetchLivekitToken, sendMessage, leave`.

**Validation:**

```bash
node --check apps/desktop/src/modules/runly.chat/calls/guest/useGuestCall.js
```

---

## Task 8 — Frontend hook: `useGuestChatUpload.js` (new)

**Files:**
- Create: `apps/desktop/src/modules/runly.chat/calls/guest/useGuestChatUpload.js`

**Changes:**

- [x] Mirror `apps/desktop/src/modules/runly.chat/hooks/useChatUpload.js`'s `uploadFile` shape, but taking `presignAttachment` (from `useGuestCall`) as a parameter instead of reading `useAuth()`'s session token:
  ```js
  export function useGuestChatUpload(presignAttachment) {
    async function uploadFile(file) {
      const mimeType = file.type || "application/octet-stream";
      const { attachmentId, uploadUrl } = await presignAttachment({
        fileName: file.name, mimeType, sizeBytes: file.size,
      });
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: await file.arrayBuffer(),
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      return attachmentId;
    }
    return { uploadFile };
  }
  ```
- [x] No `deleteUpload` — out of scope for v1 (spec §6 Non-goal 4: orphan sweep already covers abandoned uploads; a guest has no UI to discard a pending upload before sending, matching the reduced-chrome nature of the rest of the guest composer).

**Validation:**

```bash
node --check apps/desktop/src/modules/runly.chat/calls/guest/useGuestChatUpload.js
```

---

## Task 9 — Frontend: `RoomChatView.jsx`

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/RoomChatView.jsx`

**Changes:**

- [x] New props: `onUploadFile` (async `(file) => attachmentId`, optional — when absent, no paperclip button renders, so this component keeps working unchanged for any other caller that doesn't pass it) and `onResolveAttachmentUrl` (async `(attachmentId) => url`).
- [x] Local state: `pending` (`{ attachmentId, fileName } | null`), `uploading` (bool), `uploadError` (string | null).
- [x] Hidden `<input type="file" ref={fileInputRef} onChange={...} />` + a `Paperclip` icon button (from `lucide-react`, same import source already used in this file for `Send`) next to the textarea, opening the file picker; disabled while `uploading` or while a `pending` upload already exists (v1 = one attachment per message, per plan Task 9 scope).
- [x] On file selection: set `uploading = true`, call `onUploadFile(file)`, on success set `pending = { attachmentId, fileName: file.name }` and clear `uploadError`; on failure set `uploadError` from `err.message` (fall back to the spec §8 generic "Error subiendo el archivo."), leave `pending` null. Always clear the file input's value so re-selecting the same file re-triggers `onChange`.
- [x] Show a small pending-attachment chip above the textarea (`fileName` + an "x" to clear `pending` without sending) when `pending` is set; show `uploadError` as `text-xs text-red-400` below the composer when set.
- [x] `submit()`: require `draft.trim() || pending`; call `onSend(draft.trim(), pending?.attachmentId)`; clear `draft` and `pending` on send.
- [x] Message rendering: for each `m.attachments?.length` item, render via a small inline helper (co-located in this file, not a new file — this stays well under the 1000-line limit):
  - `image/*` → `<img>` with `max-h-48 rounded-lg cursor-pointer` whose `src` is lazily resolved on mount via `onResolveAttachmentUrl(att.id)` (a small `useState` + `useEffect` per attachment, or a tiny local hook); clicking opens the resolved URL in a new tab.
  - anything else → a chip showing `att.fileName` + size (reuse the same size-formatting idea as `formatFileSize` in `apps/desktop/src/modules/runly.chat/lib/chatUtils.js` — inline a minimal version here rather than importing that member-side util, to keep this guest-safe component free of any accidental coupling to authenticated-only chat modules) and a "Descargar" button that calls `onResolveAttachmentUrl(att.id)` on click and opens the result.
- [x] All new UI copy in Spanish per spec §8.

**Validation:**

```bash
pnpm build
```

Success: build completes with no errors (this file is `.jsx`; `node --check` cannot parse JSX, so the build is the syntax/type gate here, consistent with how other `.jsx` changes in this repo are validated).

---

## Task 10 — Frontend: wiring (`GuestRoomChat.jsx`, `GuestCallRoom.jsx`, `GuestCallScreen.jsx`)

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/GuestRoomChat.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/GuestCallRoom.jsx`
- Modify: `apps/desktop/src/modules/runly.chat/calls/guest/GuestCallScreen.jsx`

**Changes:**

- [x] `GuestRoomChat.jsx`: accept `onUploadFile`/`onResolveAttachmentUrl` props and forward them to `RoomChatView` unchanged (this component stays a thin wrapper, per its existing role).
- [x] `GuestCallRoom.jsx`:
  - Accept two new props: `presignAttachment`, `getAttachmentUrl`.
  - `const { uploadFile } = useGuestChatUpload(presignAttachment);` (new import).
  - `publishChat` signature becomes `(body, attachmentId) => {...}`: only broadcast the LiveKit data-channel text echo when `body` is non-empty (an attachment-only message has nothing useful to echo instantly — see Architecture summary); always call `onSendMessage(body, attachmentId ? { attachmentId } : undefined)`.
  - Pass `onUploadFile={uploadFile}` and `onResolveAttachmentUrl={getAttachmentUrl}` to both call sites of `<GuestRoomChat ... />` (the mobile full-screen one and the new desktop `<aside>` one added by the earlier layout fix).
- [x] `GuestCallScreen.jsx`: pass `presignAttachment={gc.presignAttachment}` and `getAttachmentUrl={gc.getAttachmentUrl}` to `<GuestCallRoom ... />`, alongside the existing props.

**Validation:**

```bash
pnpm build
```

---

## Task 11 — Full verification pass

**Files:**
- None (verification only).

**Changes:**

- [x] Run every command from spec §26 Verification plan.
- [ ] Manual: join a call as a guest via a real invite link in dev, attach a PNG under 20MB from the desktop sidebar chat, confirm it appears with a thumbnail for the guest and, in real time, as a downloadable image attachment in a member's `ChatWindow`.
- [ ] Manual: confirm the same message and attachment are still visible in `ChatWindow` after the call ends.
- [ ] Manual: attempt a >20MB file and a disallowed type (e.g. `.exe`); confirm the exact Spanish error text from spec §8/§12 appears and no message is sent.
- [ ] Manual: repeat the successful-attachment flow on mobile (chat replaces video) to confirm no regression of the separately-shipped layout fix.

**Validation:**

```bash
pnpm build
node --test apps/api/src/routes/calls/__tests__/call-guest-service.test.js apps/api/src/routes/calls/__tests__/call-messages-service.test.js
```

---

## Rollback Notes

- Entirely additive, no migration — see spec §27. If aborted at any point, revert the modified/created files listed in the File Structure Map; no data cleanup is needed, and no other file in the repo depends on the new SDK methods or hook exports being present.
- If aborted after Task 3/4 but before Task 9/10: the backend accepts `metadata.attachmentId` but nothing in the frontend sends one yet — inert, no user-visible effect, safe to pause between backend and frontend tasks.

---

## Verification Gate

Before marking any phase task complete in `docs/TASKS.md`:

- [x] All task validation commands have been run.
- [x] All commands exited without errors.
- [x] Verification checklist filled in: `docs/superpowers/verification/2026-09-25-call-guest-chat-attachments.md` (adapted from the template — this feature has no migration/RBAC/navigation sections to check, per spec §§11, 15–18).
- [ ] `docs/TASKS.md` — not updated; see the verification doc's Documentation section for why (small scoped addition, not a new phase).
