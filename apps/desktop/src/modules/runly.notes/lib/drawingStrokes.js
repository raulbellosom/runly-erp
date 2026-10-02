// Collaborative merge for a drawing block's strokes.
//
// The strokes live in a single node attribute (a JSON string). Y.js treats a
// node attribute as last-writer-wins, so when two people draw at the same time
// the second write used to replace the first one's strokes wholesale. Each
// client now remembers every stroke and erasure it has seen and re-publishes
// the union (strokes by id, minus erased ids) whenever the attribute changes.
// Union is monotone, so all clients converge on the same drawing.

function hashString(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(36)
}

// Strokes saved before ids existed get a deterministic id from their content,
// so every client derives the same id for the same legacy stroke.
export function withStrokeIds(strokes) {
  return strokes.map(s => (s.id ? s : { ...s, id: `l-${hashString(JSON.stringify(s))}` }))
}

export function parseStrokes(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? withStrokeIds(parsed) : []
  } catch {
    return []
  }
}

export function parseErased(raw) {
  try {
    const parsed = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function newStrokeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// known: { strokes: Map<id, stroke>, order: string[], erased: Set<id> } — mutated
// to absorb the remote state. Returns the merged strokes/erased lists and
// whether they differ from what the attribute currently holds.
// Ids are compared as strings (image annotations use numeric ids).
export function mergeDrawing(known, remoteStrokes, remoteErased) {
  for (const id of remoteErased) known.erased.add(String(id))
  for (const s of remoteStrokes) {
    const key = String(s.id)
    if (!known.strokes.has(key)) known.order.push(key)
    // The remote copy wins for a known id (e.g. annotations rotated in place).
    known.strokes.set(key, s)
  }
  // Remote order first (what everyone already sees), then strokes only this
  // client knows about. Order matters: eraser strokes paint over earlier ones.
  const ids = []
  const seen = new Set()
  for (const s of remoteStrokes) {
    const key = String(s.id)
    if (!seen.has(key)) { seen.add(key); ids.push(key) }
  }
  for (const key of known.order) {
    if (!seen.has(key)) { seen.add(key); ids.push(key) }
  }
  const strokes = ids.filter(key => !known.erased.has(key)).map(key => known.strokes.get(key))
  const erased = [...known.erased]
  const changed =
    strokes.length !== remoteStrokes.length ||
    strokes.some((s, i) => String(s.id) !== String(remoteStrokes[i].id)) ||
    erased.length !== new Set(remoteErased.map(String)).size
  return { strokes, erased, changed }
}

// Records the ids as erased and returns the surviving list + tombstones.
export function eraseFromDrawing(known, current, ids) {
  ids.forEach(id => known.erased.add(String(id)))
  return {
    strokes: current.filter(s => !known.erased.has(String(s.id))),
    erased: [...known.erased],
  }
}

// Registers a stroke this client just created.
export function addToDrawing(known, current, stroke) {
  const key = String(stroke.id)
  known.strokes.set(key, stroke)
  known.order.push(key)
  return { strokes: [...current, stroke], erased: [...known.erased] }
}

export function createKnownDrawing() {
  return { strokes: new Map(), order: [], erased: new Set() }
}
