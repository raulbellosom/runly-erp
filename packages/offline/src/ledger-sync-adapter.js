const LEDGER_MODULE_KEY = 'runly.ledger'

export class LedgerSyncAdapter {
  #db
  #apiBaseUrl
  #getToken
  #companyId
  #ledgerStore
  #fetchImpl
  #pulling = false

  constructor({ db, apiBaseUrl, getToken, companyId, ledgerStore, fetchImpl } = {}) {
    this.#db = db
    this.#apiBaseUrl = (apiBaseUrl ?? '').replace(/\/$/, '')
    this.#getToken = getToken
    this.#companyId = companyId ?? ledgerStore?.companyId
    this.#ledgerStore = ledgerStore
    this.#fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args))
  }

  async pull() {
    if (this.#pulling) return { pulled: 0, nextCursor: null }
    this.#pulling = true
    try {
      const token = await this.#getToken?.()
      if (!token || !this.#companyId) return { pulled: 0, nextCursor: null }

      const allStates = await this.#db.sync_state.toArray()
      const relevantStates = allStates.filter((state) => state.moduleKey === LEDGER_MODULE_KEY)
      const oldestCursor = relevantStates.reduce((min, state) => {
        if (!state.serverCursor) return min
        if (min === null || state.serverCursor < min) return state.serverCursor
        return min
      }, null)

      const url = new URL(`${this.#apiBaseUrl}/sync/pull`)
      url.searchParams.set('modules', LEDGER_MODULE_KEY)
      if (oldestCursor) url.searchParams.set('cursor', oldestCursor)

      const response = await this.#fetchImpl(url.toString(), {
        headers: { Authorization: `Bearer ${token}`, 'X-Runly-Company-Id': this.#companyId },
      })
      if (!response.ok) {
        throw new Error(`Ledger pull failed: ${response.status}`)
      }

      const { records = [], nextCursor = null } = await response.json()
      const grouped = new Map()

      for (const record of records) {
        if (record?.moduleKey !== LEDGER_MODULE_KEY) continue
        const bucket = grouped.get(record.entityType) ?? []
        bucket.push(record)
        grouped.set(record.entityType, bucket)
      }

      for (const [entityType, entityRecords] of grouped.entries()) {
        await this.#ledgerStore.upsertBatch(entityType, entityRecords)
      }

      if (grouped.size > 0) {
        const now = new Date().toISOString()
        await this.#db.transaction('rw', [this.#db.sync_state], async () => {
          for (const entityType of grouped.keys()) {
            await this.#db.sync_state.put({
              moduleKey: LEDGER_MODULE_KEY,
              entityType,
              lastPullAt: now,
              serverCursor: nextCursor,
              schemaVersion: null,
            })
          }
        })
      }

      return { pulled: records.filter((record) => record?.moduleKey === LEDGER_MODULE_KEY).length, nextCursor }
    } finally {
      this.#pulling = false
    }
  }
}
