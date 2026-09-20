// React can unmount while IndexedDB is opening or a sync is awaiting the network.
// Stop scheduling work immediately, but close only after that work has settled.
export function createDatabaseLifecycle(database, onOpenError) {
  let disposed = false
  let pending = null
  let closing = null
  const ready = Promise.resolve().then(() => database.open()).then(() => true, (error) => {
    if (!disposed) onOpenError?.(error)
    return false
  })
  const isActive = () => !disposed

  function run(operation) {
    if (disposed) return Promise.resolve()
    if (pending) return pending
    pending = (async () => {
      if (!await ready || disposed) return
      await operation(isActive)
    })().finally(() => { pending = null })
    return pending
  }

  function dispose(beforeClose) {
    if (closing) return closing
    disposed = true
    closing = Promise.allSettled([ready, pending]).then(async () => {
      try { await beforeClose?.() } finally { database.close() }
    })
    return closing
  }

  return { run, dispose, isActive }
}
