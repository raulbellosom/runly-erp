// Pure predicate: does the position at `pos` have a table-cell ancestor?
// Used to route an image's edit UI to a modal instead of cramped inline
// controls when it's inside a table cell — see
// docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md.
//
// Called on every render of every image NodeView using its own `getPos()`,
// which can briefly return a position that's no longer valid for the
// CURRENT document right after a drag's moveNode transaction mutates it
// (React re-renders NodeViews before every getPos closure has resynced) —
// state.doc.resolve() throws a RangeError in that window instead of
// failing gracefully, so this must never let that escape: an unresolvable
// position safely means "not in a table cell" for this render.
export function isInsideTableCell(state, pos) {
  try {
    const $pos = state.doc.resolve(pos)
    for (let d = $pos.depth; d > 0; d--) {
      const name = $pos.node(d).type.name
      if (name === 'tableCell' || name === 'tableHeader') return true
    }
    return false
  } catch {
    return false
  }
}
