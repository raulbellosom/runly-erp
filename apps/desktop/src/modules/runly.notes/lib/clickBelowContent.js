// Pure predicate for NoteEditor.jsx's scroll-container click handler: should
// a click at this DOM target focus the end of the document? True only when
// the click landed on a background layer (blank space below/around the
// content), not on any real node rendered inside it — otherwise every
// ordinary click inside the editor would also refocus to the end.
//
// Two backgrounds count: the scroll container itself (currentTarget), and
// NoteSheet's own `.note-sheet` div. NoteSheet is `min-h-full`, so on a short
// note (e.g. just the empty title) it fills most of the visible page below
// the actual content — that blank area's click target is `.note-sheet`, not
// the scroll container, since NoteSheet sits one level in. Without this,
// clicking anywhere in that page-filling blank space silently did nothing.
export function shouldFocusDocumentEnd(target, currentTarget) {
  return target === currentTarget || Boolean(target?.classList?.contains?.('note-sheet'))
}
