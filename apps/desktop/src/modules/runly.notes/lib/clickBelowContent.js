// Pure predicate for NoteEditor.jsx's scroll-container click handler: should
// a click at this DOM target focus the end of the document? True only when
// the click landed on the container's own background (blank space below the
// last block), not on any node rendered inside it — otherwise every
// ordinary click inside the editor would also refocus to the end.
export function shouldFocusDocumentEnd(target, currentTarget) {
  return target === currentTarget
}
