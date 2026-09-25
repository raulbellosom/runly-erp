# Verification — Chat de invitados de llamada con adjuntos

Date: 2026-09-25
Spec: [Chat de invitados de llamada con adjuntos](../specs/2026-09-25-call-guest-chat-attachments-design.md)
Plan: [Implementation plan](../plans/2026-09-25-call-guest-chat-attachments.md)
Status: Implementation verified by automated checks; live manual QA (real guest join, real ChatWindow) pending.

## Build and automated checks

- [x] `node --check packages/validators/src/calls.js`: exit 0.
- [x] `node --check apps/api/src/routes/calls/call-guest-service.js`: exit 0.
- [x] `node --check apps/api/src/routes/calls/call-messages-service.js`: exit 0.
- [x] `node --check apps/api/src/routes/calls/guest-routes.js`: exit 0.
- [x] `node --check packages/sdk/src/domains/calls.js`: exit 0.
- [x] `node --check apps/desktop/src/modules/runly.chat/calls/guest/useGuestCall.js`: exit 0.
- [x] `node --check apps/desktop/src/modules/runly.chat/calls/guest/useGuestChatUpload.js`: exit 0.
- [x] `node --test apps/api/src/routes/calls/__tests__/call-guest-service.test.js apps/api/src/routes/calls/__tests__/call-messages-service.test.js`: 32 passed, 0 failed (includes the pre-existing suite for both files — no regression, plus new coverage for presign validation/scoping, signed-URL scoping, attachment linking, and the stale-id no-op).
- [x] `node --test apps/api/src/routes/calls/__tests__/*.test.js` (full `calls/` suite, not just the two touched files): 155 passed, 0 failed, 37 suites — no regression anywhere else in `calls/`.
- [x] `pnpm build`: exit 0 across the whole workspace (validators, sdk, api, desktop web build, and the Tauri native build/installer) — `.jsx` changes (`RoomChatView.jsx`, `GuestCallRoom.jsx`, `GuestRoomChat.jsx`, `GuestCallScreen.jsx`) compile; no build errors or new warnings beyond the pre-existing chunk-size notice.
- [x] `pnpm lint`: exit 0, no output (no violations).

Verified: 2026-09-25 (commands above). No `prisma/schema.prisma` change, so `pnpm db:generate`/`pnpm db:migrate`/`pnpm db:seed` are N/A for this feature (spec §11).

## Scope / RBAC / navigation checks

N/A for this feature — no permission catalog entries, no navigation items, no manifest change (spec §§15–18). The two new endpoints (`POST /calls/guest/attachments/presign`, `GET /calls/guest/attachments/:attachmentId/url`) are gated exclusively by the existing `call_guest` session-token mechanism, identical to every other `/calls/guest/*` endpoint — verified by code review of `guest-routes.js` (no `requirePermission` on any guest route, consistent with the pre-existing ones) and by the new unit tests asserting a non-`ADMITTED` guest and a foreign `conversationId` are both rejected.

## Functional checks — pending manual QA

These require a running dev environment with real Supabase Storage and a live LiveKit call, which this session did not have available. Not marked done.

- [ ] Join a call as a guest via a real invite link, attach a PNG under 20MB from the desktop sidebar chat; confirm it renders with a thumbnail for the guest and appears in real time as a downloadable image attachment in a member's `ChatWindow`.
- [ ] Confirm the same message/attachment is still visible and downloadable in `ChatWindow` after the call ends.
- [ ] Attempt a >20MB file and a disallowed type (e.g. `.exe`); confirm the exact Spanish error text ("Archivo demasiado grande (máx. 20 MB)." / "Tipo de archivo no permitido.") renders and no message is sent.
- [ ] Repeat the successful-attachment flow on mobile (chat replaces video) to confirm no regression of the separately-shipped `GuestCallRoom` layout fix.

## Documentation and scope

- [x] Spec status: left as `Draft` pending the acceptance-criteria manual pass above (spec §2 uses `Complete` only once all acceptance criteria — spec §25 — are confirmed, several of which require the live QA above).
- [x] Plan checkboxes reflect completed implementation tasks (1–10) separately from the still-pending manual verification items in Task 11.
- [ ] `docs/TASKS.md` entry — not added; this feature is a small, self-contained addition to the existing RME3-Phase-independent `runly.chat` calls feature, not a new phase. Per CLAUDE.md's own precedent (the MirAI verification doc above), a dedicated verification doc under `docs/superpowers/verification/` stands in without requiring a `docs/TASKS.md` phase entry for scoped, non-phase changes.

## Summary

Verification completed: 2026-09-25 (automated portion only)

Commands executed:

```
node --check packages/validators/src/calls.js
node --check apps/api/src/routes/calls/call-guest-service.js
node --check apps/api/src/routes/calls/call-messages-service.js
node --check apps/api/src/routes/calls/guest-routes.js
node --check packages/sdk/src/domains/calls.js
node --check apps/desktop/src/modules/runly.chat/calls/guest/useGuestCall.js
node --check apps/desktop/src/modules/runly.chat/calls/guest/useGuestChatUpload.js
node --test apps/api/src/routes/calls/__tests__/call-guest-service.test.js apps/api/src/routes/calls/__tests__/call-messages-service.test.js
node --test apps/api/src/routes/calls/__tests__/*.test.js
pnpm build
pnpm lint
```

Outcome: PASS for all automated checks. Live manual QA (guest join + real attachment upload/download + member `ChatWindow` confirmation + mobile pass) is the only remaining item before this feature can be marked `Complete` in the spec.
