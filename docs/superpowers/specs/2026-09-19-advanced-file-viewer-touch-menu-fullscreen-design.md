# Advanced file viewer: touch double-tap fix, context menu restyle, fullscreen redesign

Date: 2026-09-19
Status: Approved
Scope: `packages/ui/src/components/AdvancedFileViewer.jsx` and the shared `packages/ui/src/components/ContextMenu.jsx` (which is also consumed by `apps/desktop/src/modules/runly.chat/components/MessageAttachments.jsx`, `FileReferenceGroup.jsx`, and `ConversationRowActions.jsx`).

## Problem

Three independent issues in the "advanced file viewer" (the fullscreen-ish modal used to preview images/PDFs/video/audio/files, opened from chat attachments, notes, etc.):

1. **Touch double-tap-to-zoom sometimes fails**, producing a visible "zoom in then snap back" glitch instead of settling at 2x.
2. **The right-click / long-press context menu already exists** (added 2026-09-15, `AdvancedFileViewer.jsx:787-1148`) with Descargar/Copiar/etc., but visually it reads as cramped compared to the richer, larger-row style used by the chat message action sheet (`MessageActionSheet.jsx`) — the user wants that same visual density and hover feedback applied to `ContextMenu.jsx` everywhere it's used, not a copy of the message-bubble-specific "lifted card" touch animation (that mechanic clones a chat bubble DOM node and doesn't apply to a fullscreen media viewer).
3. **The viewer is not fullscreen.** It renders as a floating modal with margins and rounded corners (`fixed inset-safe rounded-2xl`), wasting screen space that should go to the media itself.

## Non-goals

- No changes to `MessageActionSheet.jsx` or its bubble-lift touch animation — that stays chat-bubble-specific.
- No new context-menu items or actions beyond what already exists (Descargar, Copiar imagen, Copiar enlace, Abrir en pestaña nueva, rotar/voltear/restablecer, navegación).
- No changes to `PDFViewer.jsx`'s own internal toolbar.
- Fullscreen applies uniformly to all screen sizes (confirmed with user) — no separate desktop-only floating-modal variant.

## Design

### 1. Touch double-tap zoom fix

Root cause: `AdvancedFileViewer.jsx`'s manual double-tap detection (`onTouchStart`, lines ~379-403) sets `zoom` to 2 and computes an anchored `pan` on a real double-tap. Because that `touchstart` branch never calls `preventDefault()`, mobile browsers additionally synthesize a native `dblclick` `MouseEvent` from the two taps. `handleImageDoubleClick` (line 558) is meant to be a *mouse-only* double-click handler, guarded by `event.pointerType === "touch"` — but a synthesized `dblclick` is a `MouseEvent`, which has no meaningful `pointerType` (`undefined`), so the guard doesn't match and the handler runs anyway. It reads `zoom > 1` (true, since the manual handler just set it) and immediately toggles back to `zoom = 1`, producing the "zooms in then snaps back" glitch.

Fix, defense in depth:

- In the `onTouchStart` double-tap branch, call `e.preventDefault()` before scheduling the zoom/pan update, so the browser does not synthesize the trailing `click`/`dblclick` in the first place.
- Harden `handleImageDoubleClick` to ignore a `dblclick` that arrives immediately after a touch-originated double-tap already handled (e.g. a short-lived ref timestamp set alongside `lastTapRef` when the manual handler fires, checked at the top of `handleImageDoubleClick`), as a fallback for browsers where `preventDefault` on `touchstart` doesn't suppress the synthetic event.

No behavior change for the existing desktop mouse double-click path.

### 2. `ContextMenu.jsx` visual restyle (global)

`ContextMenuItem` in `packages/ui/src/components/ContextMenu.jsx` currently uses compact spacing (`px-2 py-1.5 text-sm`) and only highlights via `focus:bg-[hsl(var(--muted))]` (Radix's roving-focus model). `MessageActionSheet.jsx`'s own menu rows (`px-4 py-2.5 text-[13px]`, explicit `hover:bg-[hsl(var(--muted))] active:bg-[hsl(var(--muted))]`) read as more substantial and more responsive to touch/mouse feedback.

Change `ContextMenuItem` (and `ContextMenuCheckboxItem`/`ContextMenuRadioItem` for consistency) to adopt the larger padding and add explicit `hover:`/`active:` background classes alongside the existing `focus:` ones, so highlighting is visually identical whether it comes from pointer hover, touch, or keyboard focus. The container (`ContextMenuContent`: `glass-strong rounded-xl shadow-lg`) already matches `MessageActionSheet`'s panel styling and is unchanged.

Because `ContextMenu.jsx` is shared, this automatically applies to:
- `AdvancedFileViewer.jsx`'s context menu (the original ask),
- `MessageAttachments.jsx`'s `FileCard` attachment menu,
- `FileReferenceGroup.jsx`,
- `ConversationRowActions.jsx`.

This is intentional per user direction — a single consistent context-menu feel across the app rather than a one-off style local to the file viewer.

Risk: existing narrow menus (`w-56`) with longer labels may wrap awkwardly with the larger horizontal padding; verify visually during implementation and add `truncate` where needed.

### 3. Fullscreen (edge-to-edge) redesign

`AdvancedFileViewer.jsx`'s `DialogPrimitive.Content` (line ~677) changes from:

```
fixed inset-safe flex flex-col rounded-2xl overflow-hidden glass-strong shadow-2xl ...
```

to an edge-to-edge fixed panel covering the full viewport (`fixed inset-0`), dropping `rounded-2xl` and `shadow-2xl` (both meaningless once the panel has no visible margin), keeping `overflow-hidden` and `glass-strong` for the internal surface treatment. Applies at all breakpoints — no floating-modal variant retained for desktop.

Safe-area handling moves from the modal's own inset (`.inset-safe`, which added `0.75rem`–`1.25rem` margin plus safe-area insets on all four sides) to per-bar padding:
- Top bar (`AdvancedFileViewer.jsx:694`) gains the existing `.safe-top` utility class so it clears the iOS notch/dynamic island instead of relying on modal inset.
- Bottom toolbar (line 1159) already has `.safe-bottom` — unchanged.
- `DialogPrimitive.Overlay` is unchanged (still needed for the open/close fade transition, even though it's fully covered once the content is edge-to-edge).

## Testing

- Manual verification on a touch device (or Chrome DevTools touch emulation): double-tap zooms in and stays at 2x; double-tap again returns to fit; no visible snap-back glitch.
- Manual verification of context menu: right-click (desktop) and long-press (touch) on the file viewer, a chat attachment card, and a conversation row all show the same visual density/hover behavior.
- Manual verification of fullscreen: viewer covers 100% of the viewport with no visible margin/rounded corners on both a notched mobile viewport and desktop; top bar clears the notch in a simulated safe-area environment.
- No automated tests exist for this component today (no test file found under `packages/ui/src/components/__tests__` for `AdvancedFileViewer` or `ContextMenu`); this spec does not add new automated coverage since the changes are almost entirely visual/gesture behavior best verified manually, consistent with the rest of this component's history.
