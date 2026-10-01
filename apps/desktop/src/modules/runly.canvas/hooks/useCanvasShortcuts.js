import { useEffect, useRef, useState } from 'react'

const TOOL_KEYS = { v: 'select', h: 'pan', r: 'rectangle', p: 'hotspot' }

function isEditableTarget(target) {
  if (!target) return false
  const tag = target.tagName
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

// Editor keyboard map. Ignored while typing in fields or with a dialog open so
// shortcuts never hijack form input. Holding Space pans temporarily.
export function useCanvasShortcuts({ enabled, onTool, onDelete, onEscape, onZoomIn, onZoomOut, onReset, onFit }) {
  const [spacePan, setSpacePan] = useState(false)
  const handlers = useRef({})
  useEffect(() => { handlers.current = { onTool, onDelete, onEscape, onZoomIn, onZoomOut, onReset, onFit } })

  useEffect(() => {
    if (!enabled) return undefined
    function keyDown(event) {
      if (isEditableTarget(event.target) || document.querySelector('[role="dialog"]')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const h = handlers.current, key = event.key.toLowerCase()
      if (key === ' ') { event.preventDefault(); setSpacePan(true); return }
      if (TOOL_KEYS[key]) { h.onTool(TOOL_KEYS[key]); return }
      if (key === 'delete' || key === 'backspace') { event.preventDefault(); h.onDelete(); return }
      if (key === 'escape') { h.onEscape(); return }
      if (key === '+' || key === '=') { h.onZoomIn(); return }
      if (key === '-') { h.onZoomOut(); return }
      if (key === '0') { h.onReset(); return }
      if (key === '1') h.onFit()
    }
    function keyUp(event) { if (event.key === ' ') setSpacePan(false) }
    function blur() { setSpacePan(false) }
    window.addEventListener('keydown', keyDown)
    window.addEventListener('keyup', keyUp)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('keyup', keyUp)
      window.removeEventListener('blur', blur)
    }
  }, [enabled])

  return { spacePan }
}
