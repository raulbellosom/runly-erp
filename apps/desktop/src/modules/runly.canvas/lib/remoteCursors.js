// Ephemeral cursor/selection state from other editors (relay event `cursor`).
export const CURSOR_TTL_MS = 10_000
export const CURSOR_SEND_MS = 120
const PALETTE = ['#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3']

export function colorFor(id = '') {
  let hash = 0
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return PALETTE[hash % PALETTE.length]
}

export function reduceCursor(state, payload, { selfId, now = Date.now() }) {
  if (!payload?.actorId || payload.actorId === selfId) return state
  const next = new Map(state)
  next.set(payload.actorId, { actorId: payload.actorId, pageId: payload.pageId, x: payload.x, y: payload.y, selectedIds: Array.isArray(payload.selectedIds) ? payload.selectedIds : [], at: now })
  return next
}

// Cursors to draw: same page, updated within the TTL, user still present.
export function visibleCursors(state, { pageId, presence, now = Date.now() }) {
  const names = new Map(presence.map((user) => [user.id, user.name]))
  return [...state.values()]
    .filter((cursor) => cursor.pageId === pageId && now - cursor.at < CURSOR_TTL_MS && names.has(cursor.actorId))
    .map((cursor) => ({ id: cursor.actorId, name: names.get(cursor.actorId), color: colorFor(cursor.actorId), x: cursor.x, y: cursor.y, selectedIds: cursor.selectedIds }))
}

// Leading call, then at most one trailing call per interval with the latest value.
export function createThrottle(fn, interval) {
  let last = 0, timer = null, pending
  return (value) => {
    pending = value
    const wait = interval - (Date.now() - last)
    if (wait <= 0 && !timer) { last = Date.now(); fn(value); return }
    if (timer) return
    timer = setTimeout(() => { timer = null; last = Date.now(); fn(pending) }, Math.max(wait, 0))
  }
}
