import { useEffect, useState } from 'react'
import { computeKeyboardInset } from '../lib/keyboardInset.js'

// Tracks the on-screen keyboard's height on touch devices via the
// visualViewport API, so callers can pad/scroll content clear of it.
// Returns 0 on desktop/mouse devices and browsers without visualViewport.
export function useKeyboardInset() {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv || !window.matchMedia?.('(pointer: coarse)')?.matches) return

    function update() {
      setInset(computeKeyboardInset(window.innerHeight, vv.height, vv.offsetTop))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
