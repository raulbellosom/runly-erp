// Single source of truth for the "Tabla" options menu, shared by the desktop
// toolbar popover (NoteToolbar.jsx) and the touch floating sheet
// (TableFloatingMenu.jsx) so both stay in sync.
export function getTableMenuActions(editor) {
  return [
    { label: 'Agregar columna a la derecha', group: 'add',
      onClick: () => editor.chain().focus().addColumnAfter().run() },
    { label: 'Agregar columna a la izquierda', group: 'add',
      onClick: () => editor.chain().focus().addColumnBefore().run() },
    { label: 'Agregar fila abajo', group: 'add',
      onClick: () => editor.chain().focus().addRowAfter().run() },
    { label: 'Agregar fila arriba', group: 'add',
      onClick: () => editor.chain().focus().addRowBefore().run() },
    { label: 'Eliminar columna', group: 'delete-cell', destructive: true,
      onClick: () => editor.chain().focus().deleteColumn().run() },
    { label: 'Eliminar fila', group: 'delete-cell', destructive: true,
      onClick: () => editor.chain().focus().deleteRow().run() },
    { label: 'Eliminar tabla', group: 'delete-table', destructive: true,
      onClick: () => editor.chain().focus().deleteTable().run() },
  ]
}

// Groups consecutive actions that share the same `group`, so callers can
// render a divider between groups without hardcoding positions.
export function tableMenuSections(actions) {
  const sections = []
  for (const action of actions) {
    const last = sections[sections.length - 1]
    if (last && last.group === action.group) last.items.push(action)
    else sections.push({ group: action.group, items: [action] })
  }
  return sections
}
