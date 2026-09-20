import { createContext, useContext, useEffect, useRef } from 'react'
import { onlineManager } from '@tanstack/react-query'
import { RunlyOfflineDatabase } from './db.js'
import { OnlineDetector } from './online-detector.js'
import { offlineDatabaseName } from './offline-scope.js'
import { SyncEngine } from './sync-engine.js'
import { createOfflineTransport } from './offline-transport.js'
import { useOfflineStore } from './offline-store.js'
import { OFFLINE_MODULES } from './offline-modules.js'
import { LedgerSQLiteStore, isTauriAvailable } from './ledger-sqlite.js'
import { LedgerSyncAdapter } from './ledger-sync-adapter.js'
import { createDatabaseLifecycle } from './database-lifecycle.js'

const PULL_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes
const LEDGER_MODULE_KEY = 'runly.ledger'

const OfflineContext = createContext(null)

export function OfflineProvider({ children, apiBaseUrl, onTransportReady, session }) {
  const sessionRef = useRef(session)
  useEffect(() => { sessionRef.current = session }, [session])
  const companyId = session?.companyId
  const userId = session?.userProfile?.id
  const detectorRef = useRef(null)
  const dbRef = useRef(null)
  const engineRef = useRef(null)
  const intervalRef = useRef(null)
  const ledgerStoreRef = useRef(null)
  const ledgerSyncAdapterRef = useRef(null)

  const setOnline = useOfflineStore((s) => s.setOnline)
  const setLastSyncAt = useOfflineStore((s) => s.setLastSyncAt)
  const setSyncing = useOfflineStore((s) => s.setSyncing)
  const setPendingCount = useOfflineStore((s) => s.setPendingCount)

  useEffect(() => {
    const databaseName = offlineDatabaseName({ apiBaseUrl, userId, companyId })
    if (!databaseName) return
    const database = new RunlyOfflineDatabase(databaseName)
    dbRef.current = database
    const lifecycle = createDatabaseLifecycle(database, (err) => {
      console.warn('[runly/offline] IndexedDB failed to open - offline features unavailable', err)
    })
    let ledgerStore = null
    let ledgerSyncAdapter = null

    const getSession = async () => {
      const current = sessionRef.current
      return lifecycle.isActive() && current?.companyId === companyId && current?.userProfile?.id === userId ? current : null
    }
    const getToken = async () => (await getSession())?.accessToken ?? null
    const engine = new SyncEngine({
      db: database,
      apiBaseUrl,
      getToken,
      companyId,
    })
    engineRef.current = engine

    const transport = createOfflineTransport({
      db: database,
      getSession,
    })

    if (onTransportReady) {
      onTransportReady(transport)
    }

    async function updatePendingCount() {
      try {
        const count = await transport.mutationQueue.getPendingCount()
        if (lifecycle.isActive()) setPendingCount(count)
      } catch (err) {
        console.warn('[runly/offline] getPendingCount failed', err?.message ?? err)
      }
    }

    async function disposeLedgerRuntime() {
      const previousStore = ledgerStore
      if (ledgerSyncAdapterRef.current === ledgerSyncAdapter) ledgerSyncAdapterRef.current = null
      if (ledgerStoreRef.current === previousStore) ledgerStoreRef.current = null
      ledgerSyncAdapter = null
      ledgerStore = null
      if (previousStore) {
        await previousStore.close().catch(() => {})
      }
    }

    async function ensureLedgerRuntime() {
      if (!isTauriAvailable()) return null

      const session = await getSession()
      if (!lifecycle.isActive()) return null
      const companyId = session?.companyId ?? null

      if (!companyId) {
        await disposeLedgerRuntime()
        return null
      }

      if (ledgerStore?.companyId === companyId && ledgerSyncAdapter) {
        return ledgerSyncAdapter
      }

      await disposeLedgerRuntime()

      if (!lifecycle.isActive()) return null
      ledgerStore = new LedgerSQLiteStore({ companyId, userId })
      await ledgerStore.open()
      if (!lifecycle.isActive()) return null

      ledgerSyncAdapter = new LedgerSyncAdapter({
        db: database,
        apiBaseUrl,
        getToken,
        companyId,
        ledgerStore,
      })

      ledgerStoreRef.current = ledgerStore
      ledgerSyncAdapterRef.current = ledgerSyncAdapter
      return ledgerSyncAdapter
    }

    function runSync() {
      return lifecycle.run(async (isActive) => {
        setSyncing(true)
        try {
          let ledgerSyncAdapter = null
          if (isTauriAvailable()) {
            try {
              ledgerSyncAdapter = await ensureLedgerRuntime()
            } catch (err) {
              console.warn('[runly/offline] Ledger SQLite unavailable - runly.ledger stays online-only', err?.message ?? err)
            }
          }

          // Push first, then pull so the server sees our changes before we refresh.
          if (!isActive()) return
          await engine.push().catch((err) => {
            console.warn('[runly/offline] Push failed', err?.message ?? err)
          })
          if (!isActive()) return
          await engine.pull({ modules: OFFLINE_MODULES.filter((moduleKey) => moduleKey !== LEDGER_MODULE_KEY) })
          if (!isActive()) return
          if (ledgerSyncAdapter) {
            await ledgerSyncAdapter.pull().catch((err) => {
              console.warn('[runly/offline] Ledger pull failed', err?.message ?? err)
            })
          }
          if (isActive()) setLastSyncAt(new Date().toISOString())
        } catch (err) {
          console.warn('[runly/offline] Pull failed', err?.message ?? err)
        } finally {
          if (isActive()) {
            setSyncing(false)
            await updatePendingCount()
          }
        }
      }).catch((err) => {
        if (lifecycle.isActive()) console.warn('[runly/offline] Sync failed', err?.message ?? err)
      })
    }

    const detector = new OnlineDetector({
      probeUrl: apiBaseUrl ? `${apiBaseUrl}/health` : null,
    })
    detectorRef.current = detector

    const initialOnline = detector.isOnline()
    setOnline(initialOnline)
    onlineManager.setOnline(initialOnline)

    detector.onChange((online) => {
      setOnline(online)
      onlineManager.setOnline(online)
      if (online) runSync()
    })

    intervalRef.current = setInterval(() => {
      if (detector.isOnline()) runSync()
    }, PULL_INTERVAL_MS)

    if (initialOnline) runSync()

    return () => {
      detector.destroy()
      clearInterval(intervalRef.current)
      onTransportReady?.(null)
      setSyncing(false)
      lifecycle.dispose(disposeLedgerRuntime).catch((err) => {
        console.warn('[runly/offline] Cleanup failed', err?.message ?? err)
      })
    }
  }, [apiBaseUrl, companyId, userId, setOnline, setLastSyncAt, setSyncing, setPendingCount, onTransportReady])

  return (
    <OfflineContext.Provider value={{ dbRef, engineRef, ledgerStoreRef, ledgerSyncAdapterRef }}>
      {children}
    </OfflineContext.Provider>
  )
}

export function useOfflineContext() {
  return useContext(OfflineContext)
}
