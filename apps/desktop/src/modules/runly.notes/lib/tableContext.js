// Pure predicate: does the position at `pos` have a table-cell ancestor?
// Used to route an image's edit UI to a modal instead of cramped inline
// controls when it's inside a table cell — see
// docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md.
export function isInsideTableCell(state, pos) {
  const $pos = state.doc.resolve(pos)
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name
    if (name === 'tableCell' || name === 'tableHeader') return true
  }
  return false
}
