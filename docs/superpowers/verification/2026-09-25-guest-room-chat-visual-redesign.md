# Verification — Rediseño visual del chat ligero de invitados

Date: 2026-09-25
Spec: [Rediseño visual del chat ligero de invitados de llamada](../specs/2026-09-25-guest-room-chat-visual-redesign-design.md)
Plan: [Implementation plan](../plans/2026-09-25-guest-room-chat-visual-redesign.md)
Status: Implementation verified by automated checks; visual manual QA in a running dev server pending.

## Build and automated checks

- [x] `node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/roomChat.test.js`: 7 passed, 0 failed (3 pre-existing `mergeRoomMessages` tests + 4 new `groupConsecutiveBySender` tests — no regression).
- [x] `pnpm build`: exit 0 across the whole workspace (validators, sdk, api, desktop web build, and the Tauri native build/installer) — no build errors or new warnings beyond the pre-existing chunk-size notice.
- [x] `pnpm lint`: exit 0, no output (no violations).

Verified: 2026-09-25 (commands above). Pure frontend change — no `pnpm db:generate`/`migrate`/`seed` applicable (spec §11).

## Scope checks

N/A for this feature — no backend, SDK, validator, manifest, navigation, RBAC, storage, or data-model changes (spec §§10–22 all N/A). Confirmed by `git diff` scope: only `RoomChatView.jsx`, `calls/lib/roomChat.js`, and its test file changed.

## Functional checks — pending manual QA

Require a running dev server and a live/simulated call to see the rendered result. Not marked done.

- [ ] Three consecutive messages from the same sender: name shown only on the first, avatar only on the last, distinct bubble corners on first/middle/last.
- [ ] A message with an image + caption renders as one fused card (image flush at top, caption below), not two separate elements.
- [ ] Scrolling up mid-burst does not auto-jump to bottom; the "↓ Nuevo mensaje" button appears and works.
- [ ] At-bottom auto-scroll still fires automatically when a new message arrives and the viewer was already at the bottom.
- [ ] Same behavior confirmed on both the desktop sidebar layout and the mobile full-screen chat view.

## Documentation and scope

- [x] Spec status: left as `Draft` pending the manual visual pass above.
- [x] Plan checkboxes reflect completed implementation tasks (1–3) separately from the still-pending manual verification items in Task 4.
- [ ] `docs/TASKS.md` — not added; same precedent as the call-guest-chat-attachments verification doc (small scoped visual change, not a new phase).

## Summary

Verification completed: 2026-09-25 (automated portion only)

Commands executed:

```
node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/roomChat.test.js
pnpm build
pnpm lint
```

Outcome: PASS for all automated checks. Visual manual QA (grouping, fused image+caption card, scroll-position-aware auto-scroll, desktop + mobile) is the only remaining item before this feature can be marked `Complete` in the spec.
