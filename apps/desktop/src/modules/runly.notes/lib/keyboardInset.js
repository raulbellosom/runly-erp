// Pure math for mobile keyboard avoidance — see hooks/useKeyboardInset.js for
// the browser-facing visualViewport wiring this backs.

// The on-screen keyboard shrinks window.visualViewport while
// window.innerHeight stays the layout-viewport height, so the gap between
// them is (approximately) the keyboard's height.
export function computeKeyboardInset(innerHeight, viewportHeight, viewportOffsetTop) {
  const inset = innerHeight - (viewportHeight + viewportOffsetTop)
  return inset > 0 ? inset : 0
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
