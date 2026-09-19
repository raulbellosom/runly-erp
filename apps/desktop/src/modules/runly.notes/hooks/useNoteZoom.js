import { useState } from 'react'

const NOTE_ZOOM_KEY = 'atlas:v1:notes-zoom'
export const NOTE_ZOOM_MIN = 50
export const NOTE_ZOOM_MAX = 200
export const NOTE_ZOOM_STEP = 10

function getStoredZoom() {
  try {
    const raw = Number(localStorage.getItem(NOTE_ZOOM_KEY))
    return Number.isFinite(raw) && raw >= NOTE_ZOOM_MIN && raw <= NOTE_ZOOM_MAX ? raw : 100
  } catch {
    return 100
  }
}

function persistZoom(val) {
  try {
    localStorage.setItem(NOTE_ZOOM_KEY, String(val))
  } catch {
    // localStorage unavailable — zoom still works for the session, it just
    // won't persist across reloads.
  }
}

// Device-wide zoom preference for the note content area (not per-note),
// mirroring the localStorage pattern already used for the notes-list
// collapse preference.
export function useNoteZoom() {
  const [zoom, setZoomState] = useState(getStoredZoom)

  function setZoom(next) {
    const clamped = Math.min(NOTE_ZOOM_MAX, Math.max(NOTE_ZOOM_MIN, next))
    setZoomState(clamped)
    persistZoom(clamped)
  }

  return [zoom, setZoom]
}
