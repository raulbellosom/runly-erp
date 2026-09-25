# Rediseño visual del chat ligero de invitados — Implementation Plan

Date: 2026-09-25
Spec: docs/superpowers/specs/2026-09-25-guest-room-chat-visual-redesign-design.md
Status: Implemented — automated checks pass; manual visual QA in a running dev server pending (see docs/superpowers/verification/2026-09-25-guest-room-chat-visual-redesign.md)

> **For agentic workers:** Declare `Mode: IMPLEMENTATION` before starting. Do not begin coding until the spec is approved and this plan is approved. Use checkbox syntax (`- [ ]`) to track progress. Mark each task completed only after its validation commands pass.

## Goal

Make `RoomChatView.jsx` look and feel like a first-class part of the
platform — sender-consecutive grouping, tailed bubble corners, a fused
image+caption card, and scroll-position-aware auto-scroll — using only
Tailwind classes and pure presentational logic, with zero new dependency on
member session/auth. Matches spec §5 exactly.

## Architecture summary

All grouping/radius logic is derived purely from the `messages` array on
each render (no new component state that could drift) — mirrors
`ChatMessageList.jsx`'s `enrichWithGroupInfo` pattern but reimplemented
standalone (that file and its siblings are not reusable as-is: they're
wired to `useAuth`, message-action menus, reactions, and other member-only
concerns per the spec's Context). The one genuinely new piece of testable
logic — grouping consecutive messages by sender — goes in
`calls/lib/roomChat.js` (already home to `mergeRoomMessages`, already has a
test file) as a pure function, so it's covered by a fast unit test instead
of only being exercised through the component. Everything else (bubble
radius lookup, the fused image+caption card, scroll-position tracking) is
small enough to stay inline in `RoomChatView.jsx`, which remains well under
the 1000-line limit after this change.

---

## File Structure Map

### Create

(none)

### Modify

- `apps/desktop/src/modules/runly.chat/calls/lib/roomChat.js` — add `groupConsecutiveBySender(messages)`
- `apps/desktop/src/modules/runly.chat/calls/lib/__tests__/roomChat.test.js` — tests for the new function
- `apps/desktop/src/modules/runly.chat/calls/RoomChatView.jsx` — grouped bubble rendering, radius lookup, fused image+caption card, scroll-position-aware auto-scroll + "↓ Nuevo mensaje" button

No backend, SDK, validator, or manifest changes — this is a pure frontend
visual change over data shapes that already exist (spec §§10–22 are all
N/A).

---

## Task 1 — Grouping helper + tests

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/roomChat.js`
- Modify: `apps/desktop/src/modules/runly.chat/calls/lib/__tests__/roomChat.test.js`

**Changes:**

- [x] Add and export `groupConsecutiveBySender(messages = [])`: for each message, compare a `${senderName}::${senderKind}` key against the previous/next message in the array (already sorted by `mergeRoomMessages`) to compute `isFirst`/`isLast` (true when there is no neighbor or the neighbor's key differs), returning a new array of `{ ...message, isFirst, isLast }`. A lone message (no matching neighbor on either side) gets `isFirst: true, isLast: true`.
- [x] Add tests: (a) three consecutive messages from the same sender get `isFirst`/`isLast` only on the ends, `false` on the middle one; (b) a sender change resets grouping (edge case 3 from the spec — differing `senderKind` with the same `senderName` still breaks the group); (c) a single message with different neighbors on both sides is `{isFirst: true, isLast: true}`; (d) empty input returns `[]`.

**Validation:**

```bash
node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/roomChat.test.js
```

Success: all tests pass, including the pre-existing `mergeRoomMessages` ones (no regression).

---

## Task 2 — Bubble grouping + radius + fused image/caption card

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/RoomChatView.jsx`

**Changes:**

- [x] Import `groupConsecutiveBySender` from `./lib/roomChat`; wrap the incoming `messages` prop in `useMemo(() => groupConsecutiveBySender(messages), [messages])` before rendering.
- [x] Add a small literal-class lookup `bubbleRadius(isOwn, isFirst, isLast)` (four fully-literal Tailwind strings per side — own/other × solo/first/last/middle — no dynamic string interpolation of class fragments, so Tailwind's scanner picks them all up) per spec §8's radius requirement.
- [x] Avatar: for a non-own message, render a 28px (`h-7 w-7`) circular initial (same violet accent already used, `bg-violet-500/20 text-violet-100`) only when `isLast`; otherwise render an `invisible` placeholder of the same size so the row alignment doesn't shift.
- [x] Sender name: render only when `isFirst && !mine` (own messages already show no name today — unchanged).
- [x] Fused image+caption card: when a message has `body` AND its first attachment is an image, render one `overflow-hidden` card (`bubbleRadius(...)` applied to the outer card) with the `<img>` flush at the top (no padding) and the caption text below it (`px-3 py-2`), instead of today's separate text-bubble + `AttachmentItem` stack. Any additional non-image attachments on the same message still render as separate chips below the card (spec explicitly doesn't require fusing more than one image+caption).
- [x] Apply `bubbleRadius(...)` to the plain-text bubble (no attachment) and to a standalone image bubble (image, no caption) as well, so all three bubble shapes share the same grouping-aware corners.

**Validation:**

```bash
pnpm build
```

---

## Task 3 — Scroll-position-aware auto-scroll

**Files:**
- Modify: `apps/desktop/src/modules/runly.chat/calls/RoomChatView.jsx`

**Changes:**

- [x] Add `listRef` (on the scrollable messages `<div>`) and `atBottomRef` (a ref, not state — updated on every scroll event, read without triggering re-renders).
- [x] `onScroll` handler: compute `distance = scrollHeight - scrollTop - clientHeight`; `atBottomRef.current = distance < 120` (same threshold as `ChatMessageList.jsx`); clear the "new message" affordance when it becomes true.
- [x] Replace the existing `useEffect(() => endRef.current?.scrollIntoView(...), [messages.length])` with: on `messages.length` growing (track the previous count in a ref), auto-scroll only if `atBottomRef.current` is true; otherwise set a `hasNewMessage` state flag.
- [x] Render a small floating button ("↓ Nuevo mensaje", `absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-violet-600 px-3 py-1 text-xs text-white shadow-lg`) when `hasNewMessage` is true; clicking it scrolls to bottom and clears the flag. Requires the outer container (`flex h-full min-h-0 flex-col ...`) to become `relative` so the button can be positioned against it.

**Validation:**

```bash
pnpm build
```

---

## Task 4 — Full verification pass

**Files:**
- None (verification only).

**Changes:**

- [x] Run every command from spec §26.
- [ ] Manual (dev server): simulate 3+ consecutive messages from the same sender, one message with an image caption, and scrolling up mid-burst — confirm all 5 acceptance criteria from the spec.
- [ ] Manual: repeat on the mobile full-screen chat view (not just the desktop sidebar) to confirm identical grouping/bubble behavior in both layouts (spec acceptance criterion 5).

**Validation:**

```bash
node --test apps/desktop/src/modules/runly.chat/calls/lib/__tests__/roomChat.test.js
pnpm build
```

---

## Rollback Notes

Entirely additive/visual, no persisted state, no migration — revert the modified files to restore prior behavior. Safe to abort between any two tasks; each task's `RoomChatView.jsx` changes are independent visual layers (grouping doesn't depend on the scroll-position work and vice versa).

---

## Verification Gate

Before marking any phase task complete in `docs/TASKS.md`:

- [x] All task validation commands have been run.
- [x] All commands exited without errors.
- [x] Verification checklist filled in: `docs/superpowers/verification/2026-09-25-guest-room-chat-visual-redesign.md`.
- [ ] `docs/TASKS.md` — not updated; N/A for this scoped visual change, per the precedent set in the attachments feature's own verification doc.
