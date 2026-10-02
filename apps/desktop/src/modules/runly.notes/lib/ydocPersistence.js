import * as Y from 'yjs'
import { bytesToBase64, base64ToBytes } from './SupabaseYjsProvider.js'

// Builds the body of a PUT /notes/:id/ydoc. The API merges whatever it gets
// into the stored doc, so instead of the full state we send only what the
// server doesn't have yet (the diff past its last known state vector) — small
// enough to fit a keepalive request when the page is closing.
export function buildYDocSave(ydoc, serverStateVector) {
  const sentStateVector = Y.encodeStateVector(ydoc)
  const update = serverStateVector
    ? Y.encodeStateAsUpdate(ydoc, serverStateVector)
    : Y.encodeStateAsUpdate(ydoc)
  return {
    update: bytesToBase64(update),
    stateVector: bytesToBase64(sentStateVector),
    sentStateVector,
  }
}

// The save response carries `missing`: what the merged server doc holds that
// this client never received (e.g. a dropped realtime broadcast). Applying it
// makes every saving client converge on the same content.
export function applyServerCatchUp(ydoc, response) {
  const payload = response && typeof response === 'object' && response.data != null ? response.data : response
  const missing = payload?.missing
  if (typeof missing !== 'string' || missing.length === 0) return false
  Y.applyUpdate(ydoc, base64ToBytes(missing), 'server-load')
  return true
}
