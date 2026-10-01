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
    }
  }
  return next
}

// Replaces optimistic rows with the authoritative ones returned by the batch.
export function mergeBatchResults(rows = [], results = []) {
  let next = rows
  for (const result of results) {
    if (result.op === 'create' && result.object) {
      next = next.some((row) => row.id === result.clientId)
        ? next.map((row) => row.id === result.clientId ? result.object : row)
        : [...next, result.object]
    } else if (result.op === 'update' && result.object) {
      next = next.map((row) => row.id === result.object.id ? { ...result.object, hotspot: row.hotspot } : row)
    }
  }
  return next
}
