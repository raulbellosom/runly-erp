// Applies a batch of object operations to a cached object list the same way
// the API will, so the editor can paint the result before the round trip.
// The server bumps `revision` by one per update; mirroring that keeps the next
// edit's expectedRevision valid while this one is still in flight.
export function applyOperations(rows = [], operations = []) {
  let next = rows
  for (const op of operations) {
    if (op.op === 'create') {
      next = [...next, { ...op.data, id: op.clientId, revision: 1, pending: true }]
    } else if (op.op === 'update') {
      next = next.map((row) => row.id === op.id ? { ...row, ...op.data, revision: (row.revision ?? 1) + 1 } : row)
    } else if (op.op === 'delete') {
      next = next.filter((row) => row.id !== op.id)
    } else if (op.op === 'restore' && op.snapshot && !next.some((row) => row.id === op.id)) {
      // Delete and restore each bump the revision on the server.
      next = [...next, { ...op.snapshot, id: op.id, revision: (op.snapshot.revision ?? 1) + 2 }]
    }
  }
  return next
}

// Batch payload without client-only fields (restore snapshots).
export function toServerOperations(operations) {
  return operations.map(({ snapshot: _snapshot, ...op }) => op)
}

// Replaces optimistic rows with the authoritative ones returned by the batch.
export function mergeBatchResults(rows = [], results = []) {
  let next = rows
  for (const result of results) {
    if (result.op === 'create' && result.object) {
      // The realtime echo of this create may have inserted the server row
      // already; then the optimistic row is just dropped.
      if (next.some((row) => row.id === result.object.id)) {
        next = next.filter((row) => row.id !== result.clientId).map((row) => row.id === result.object.id ? result.object : row)
      } else {
        next = next.some((row) => row.id === result.clientId)
          ? next.map((row) => row.id === result.clientId ? result.object : row)
          : [...next, result.object]
      }
    } else if (result.op === 'restore' && result.object) {
      const existing = next.find((row) => row.id === result.object.id)
      const restored = { ...result.object, hotspot: result.object.hotspot ?? existing?.hotspot }
      next = existing ? next.map((row) => row.id === restored.id ? restored : row) : [...next, restored]
    } else if (result.op === 'update' && result.object) {
      next = next.map((row) => row.id === result.object.id ? { ...result.object, hotspot: row.hotspot } : row)
    } else if (result.op === 'conflict') {
      next = result.object
        ? next.map((row) => row.id === result.id ? { ...result.object, hotspot: result.object.hotspot ?? row.hotspot } : row)
        : next.filter((row) => row.id !== result.id)
    }
  }
  return next
}
