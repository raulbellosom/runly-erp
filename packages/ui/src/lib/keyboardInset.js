// Pure math for mobile keyboard avoidance — see hooks/useKeyboardInset.js for
// the browser-facing visualViewport wiring this backs.

// The on-screen keyboard shrinks window.visualViewport while
// window.innerHeight stays the layout-viewport height, so the gap between
// them is (approximately) the keyboard's height.
export function computeKeyboardInset(innerHeight, viewportHeight, viewportOffsetTop) {
  const inset = innerHeight - (viewportHeight + viewportOffsetTop)
  return inset > 0 ? inset : 0
}

// Below this, a viewport height drop is browser chrome (URL bar collapse),
// not a keyboard.
export const KEYBOARD_MIN_HEIGHT = 150

// Whether the on-screen keyboard is up. Not derived from the inset: iOS Safari
// pans the visual viewport down to the focused field (offsetTop grows by the
// same amount the keyboard takes), so the inset reads 0 while the keyboard is
// open. `baselineHeight` is the tallest viewport seen at the current width,
// which also covers webviews that shrink the layout viewport (adjustResize).
export function isKeyboardOpen(baselineHeight, viewportHeight) {
  return baselineHeight - viewportHeight > KEYBOARD_MIN_HEIGHT
}

// True when the caret's bottom edge (in viewport px, e.g. from
// ProseMirror's view.coordsAtPos) is hidden behind the on-screen keyboard —
// i.e. below the visible viewport height.
export function isCaretHiddenByKeyboard(caretBottom, viewportHeight) {
  return caretBottom > viewportHeight
}

// How far (px) the scroll container must scroll down so the caret sits
// `margin` px above the visible viewport's bottom edge.
export function computeCaretScrollDelta(caretBottom, viewportHeight, margin = 16) {
  return caretBottom - viewportHeight + margin
}
