import { useEffect, useRef, useState } from 'react'

const TOOL_KEYS = { v: 'select', h: 'pan', r: 'rectangle', o: 'ellipse', l: 'line', a: 'arrow', t: 'text', p: 'hotspot' }
const ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }

function isEditableTarget(target) {
  if (!target) return false
  const tag = target.tagName
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

// Editor keyboard map. Ignored while typing in fields or with a dialog open so
// shortcuts never hijack form input. Holding Space pans temporarily.
export function useCanvasShortcuts({ enabled, ...handlers }) {
  const [spacePan, setSpacePan] = useState(false)
  const handlersRef = useRef(handlers)
  useEffect(() => { handlersRef.current = handlers })

  useEffect(() => {
    if (!enabled) return undefined
    function keyDown(event) {
      if (isEditableTarget(event.target) || document.querySelector('[role="dialog"], [role="menu"]')) return
      const h = handlersRef.current, key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'd') { event.preventDefault(); h.onDuplicate(); return }
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (key === ' ') { event.preventDefault(); setSpacePan(true); return }
      if (ARROWS[key]) { event.preventDefault(); const [dx, dy] = ARROWS[key], step = event.shiftKey ? 10 : 1; h.onNudge(dx * step, dy * step); return }
      if (TOOL_KEYS[key]) { h.onTool(TOOL_KEYS[key]); return }
      if (key === 'i') { h.onInsert(); return }
      if (key === 'delete' || key === 'backspace') { event.preventDefault(); h.onDelete(); return }
      if (key === 'enter') { h.onOpen(); return }
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
