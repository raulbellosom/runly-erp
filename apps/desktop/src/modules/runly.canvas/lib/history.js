// Undo/redo for board objects. Every user action is recorded as a list of
// changes `{ id, before, after }`, where `before`/`after` are object snapshots
// or null (null = the object does not exist in that state). Replaying a state
// turns into batch operations computed against the *current* rows, so the
// expected revisions are always fresh:
//   target null              -> delete
//   target present, row gone -> restore (same id, keeps hotspot/links/files)
//   both present             -> update the tracked fields
export const TRACKED_FIELDS = ['transform', 'geometry', 'style', 'properties', 'position', 'layerId', 'type']
const LIMIT = 100

export function snapshot(row) {
  if (!row) return null
  const { pending: _pending, ...rest } = row
  return rest
}

function pickTracked(row) {
  const data = {}
  for (const key of TRACKED_FIELDS) if (row[key] !== undefined) data[key] = row[key]
  return data
}

export function buildOperations(changes, direction, rows, resolveId = (id) => id) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const operations = []
  for (const change of changes) {
    const id = resolveId(change.id), target = direction === 'undo' ? change.before : change.after
    const current = byId.get(id)
    if (!target) {
      if (current) operations.push({ op: 'delete', id, expectedRevision: current.revision })
    } else if (!current) {
      operations.push({ op: 'restore', id, snapshot: { ...target, id } })
    } else {
      operations.push({ op: 'update', id, expectedRevision: current.revision, data: pickTracked(target) })
    }
  }
  return operations
}

export function createHistory(limit = LIMIT) {
  const undoStack = [], redoStack = [], aliases = new Map()
  const resolveId = (id) => aliases.get(id) ?? id
  return {
    // `coalesce` merges a burst of the same action on the same objects (e.g.
    // arrow-key nudges) into one undo step.
    record(changes, label = '', { coalesce = null, now = Date.now() } = {}) {
      const useful = changes.filter((change) => change.before || change.after)
      if (!useful.length) return
      const last = undoStack.at(-1)
      const sameTargets = last && last.changes.length === useful.length && useful.every((change) => last.changes.some((prev) => prev.id === change.id))
      if (coalesce && last?.coalesce === coalesce && now - last.time < 1200 && sameTargets) {
        last.changes = last.changes.map((prev) => ({ ...prev, after: useful.find((change) => change.id === prev.id).after }))
        last.time = now
        redoStack.length = 0
        return
      }
      undoStack.push({ changes: useful, label, coalesce, time: now })
      if (undoStack.length > limit) undoStack.shift()
      redoStack.length = 0
    },
    // Temporary client ids are replaced by server ids once a create lands.
    alias(clientId, serverId) { aliases.set(clientId, serverId) },
    resolveId,
    takeUndo() { const entry = undoStack.pop(); if (entry) redoStack.push(entry); return entry ?? null },
    takeRedo() { const entry = redoStack.pop(); if (entry) undoStack.push(entry); return entry ?? null },
    // Puts an entry back when replaying it failed, so the stacks stay honest.
    revert(direction) {
      if (direction === 'undo') { const entry = redoStack.pop(); if (entry) undoStack.push(entry) }
      else { const entry = undoStack.pop(); if (entry) redoStack.push(entry) }
    },
    get canUndo() { return undoStack.length > 0 },
    get canRedo() { return redoStack.length > 0 },
    peekUndo() { return undoStack.at(-1) ?? null },
    peekRedo() { return redoStack.at(-1) ?? null },
  }
}
