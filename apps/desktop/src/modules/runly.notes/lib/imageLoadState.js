// Pure predicate used by ImageCropModal.jsx (and anywhere else rendering an
// <img> whose onLoad might fire before React attaches the listener, because
// the image was already rendered elsewhere on the page and is warm in the
// browser cache). Given the DOM image element's own loaded-state fields,
// returns the natural size to store, or null if it isn't loaded yet.
export function getLoadedNaturalSize({ complete, naturalWidth, naturalHeight }) {
  if (!complete || !naturalWidth) return null
  return { w: naturalWidth, h: naturalHeight }
}
