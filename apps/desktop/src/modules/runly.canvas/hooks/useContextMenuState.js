import { useCallback, useEffect, useState } from 'react'
import { sceneBounds } from '../engine/Canvas2DRenderer.js'
import { worldToScreen } from '../engine/viewport.js'

function isEditableTarget(target) {
  if (!target) return false
  const tag = target.tagName
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

// Builds the state CanvasContextMenu renders: `target` drives the
// single-object items (Enfocar, Editar texto, Conectar a datos…) and
// `selection` drives the bulk ones (Duplicar, Eliminar…). Opened from the
// viewport's right click / long press (`openAt`, screen-space) or the
// Shift+F10 / ContextMenu keyboard shortcut (`openAtSelection`, which frames
// the current selection's centre — or the viewport's centre with nothing
// selected).
//
// `CanvasViewport`'s onContextMenu contract carries no input-device flag, so
// a pre-existing selection that doesn't include the clicked target is what
// signals "this needs 'Agregar a la selección'" for both mouse and touch —
// it's always true right after a touch long press (CanvasViewport selects
// the hit before calling onContextMenu only when it wasn't already
// selected, which is exactly this condition).
export function useContextMenuState({ rows, selectedIds, select, viewport, size, enabled = true }) {
  const [menu, setMenu] = useState(null)

  const openAt = useCallback((hit, screen) => {
    const previousSelection = selectedIds
    let selection
    if (!hit) {
      selection = rows.filter((row) => previousSelection.includes(row.id))
    } else if (previousSelection.includes(hit.id)) {
      selection = rows.filter((row) => previousSelection.includes(row.id))
    } else {
      select([hit.id])
      selection = [hit]
    }
    const addSelection = hit && previousSelection.length && !previousSelection.includes(hit.id)
      ? [...previousSelection, hit.id] : null
    setMenu({ x: screen.x, y: screen.y, target: hit ?? null, selection, addSelection })
  }, [rows, selectedIds, select])

  const openAtSelection = useCallback(() => {
    const selection = rows.filter((row) => selectedIds.includes(row.id))
    const bounds = sceneBounds(selection)
    const point = bounds
      ? worldToScreen({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, viewport)
      : { x: size.width / 2, y: size.height / 2 }
    setMenu({ x: point.x, y: point.y, target: selection.length === 1 ? selection[0] : null, selection, addSelection: null })
  }, [rows, selectedIds, viewport, size])

  const close = useCallback(() => setMenu(null), [])

  // Shift+F10 and the dedicated "ContextMenu" key (most keyboards' menu key)
  // open the quick-actions menu at the selection's centre, same as a
  // physical right click — ignored while typing in a field or with a
  // dialog/menu already open, like the rest of the editor's shortcuts (see
  // useCanvasShortcuts.js).
  useEffect(() => {
    if (!enabled) return undefined
    function keyDown(event) {
      if (isEditableTarget(event.target) || document.querySelector('[role="dialog"], [role="menu"]')) return
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); openAtSelection() }
    }
    window.addEventListener('keydown', keyDown)
    return () => window.removeEventListener('keydown', keyDown)
  }, [enabled, openAtSelection])

  return { menu, openAt, openAtSelection, close }
}
