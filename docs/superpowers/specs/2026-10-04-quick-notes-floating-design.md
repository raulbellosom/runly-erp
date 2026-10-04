# Floating quick notes — design spec

Status: implemented 2026-10-04 (autonomous roadmap decision)

## Goal

A floating notes pad, like the chat bubble, that stays available across navigation
and during video calls. It opens with a keyboard shortcut, can be dragged anywhere,
and minimizes to a bubble.

## Behavior

- Shortcut `Ctrl+Alt+N` (`Cmd+Option+N` on macOS, matched by `KeyboardEvent.code`):
  closed -> open, open -> minimize, minimized -> restore. Also available as the
  "Nota rápida" action in the command palette (Ctrl+K).
- Panel 340x400 (expandable to 480x560). The header is the drag handle (except its
  buttons): note switcher, new note, open in Notes, expand, minimize, close. `Esc`
  minimizes. The minimized bubble is draggable too; a tap restores it.
- Position, open/minimized state and current note persist per device (zustand
  persist, `runly.quickNotes`). Positions are clamped to the viewport on resize.
- Shown only when `runly.notes` is available to the user.

## Data

- The pad lists the user's regular document notes (canvas notes excluded) and
  creates new ones as regular notes. On first open it continues the most recent note
  (or creates one). It uses the full NoteEditor (toolbar, slash menu).
- Editing reuses `NoteEditor` with a new `compact` prop (no toolbar, cover, icon row
  or paper sheet). It runs the same Y.js engine and autosave, so edits sync live with
  the Notes module and with collaborators. Writing plain HTML over PATCH would be
  ignored once a Y.Doc exists, so it is not used.

## Layering

Rendered through a portal on `<body>` at z-48: above the chat hub (45) and the
full-screen call room (46), below modals (50). The app shell root is
`position: fixed` (its own stacking context), so a z-index inside it could never
rise above the call room.
