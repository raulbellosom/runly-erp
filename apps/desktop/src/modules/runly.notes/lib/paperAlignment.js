// Pure math backing the paper-style pattern's dynamic alignment — see
// hooks/usePaperAlignment.js for the DOM-measuring wiring this supports.
// Everything above the body content (sticky toolbar, icon/title row) has a
// height that isn't a multiple of the ruled-line unit and varies by
// breakpoint (the toolbar's buttons are a different size on mobile), so a
// hardcoded CSS offset can't reliably make the pattern's lines land under
// real text — this computes the correction from an actually-measured
// distance instead.

// The same typography and paper unit are used on every screen. Measurements
// from viewport rectangles must be divided by sheet zoom before calling this.
export function computeLineUnitPx(rootFontSizePx) {
  return 0.9375 * 1.72 * rootFontSizePx
}

// How far (px) to shift the pattern's background-position so a line
// coincides with content starting `distanceFromSheetTop` px down.
export function computePaperPhase(distanceFromSheetTop, lineUnitPx) {
  if (!(lineUnitPx > 0)) return 0
  return ((distanceFromSheetTop % lineUnitPx) + lineUnitPx) % lineUnitPx
}
