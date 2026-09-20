import { MutationQueue } from './mutation-queue.js'

export class SyncEngine {
  #db
  #apiBaseUrl
  #getToken
  #companyId
  #fetchImpl
  #pulling = false
  #pushing = false
  #mutationQueue

  constructor({ db, apiBaseUrl, getToken, companyId, fetchImpl }) {
    this.#db = db
    this.#getToken = getToken
    this.#companyId = companyId
    // fetchImpl is injected for testing; in production globalThis.fetch is used
    this.#fetchImpl = fetchImpl ?? ((...args) => globalThis.fetch(...args))
    this.#apiBaseUrl = (apiBaseUrl ?? '').replace(/\/$/, '')
    this.#mutationQueue = new MutationQueue({ db })
  }

  async pull({ modules }) {
    if (this.#pulling) return { pulled: 0, nextCursor: null }
    this.#pulling = true
    try {
    const token = await this.#getToken()
    if (!token || !this.#companyId) return { pulled: 0, nextCursor: null }

    // Find the oldest stored cursor across requested modules so we don't
    // miss records changed before a newer module's cursor.
    const allStates = await this.#db.sync_state.toArray()
    const relevantStates = allStates.filter((s) => modules.includes(s.moduleKey))
    const oldestCursor = relevantStates.reduce((min, s) => {
      if (!s.serverCursor) return min
      if (min === null || s.serverCursor < min) return s.serverCursor
      return min
    }, null)

    const url = new URL(`${this.#apiBaseUrl}/sync/pull`)
    url.searchParams.set('modules', modules.join(','))
    if (oldestCursor) url.searchParams.set('cursor', oldestCursor)

    const response = await this.#fetchImpl(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, 'X-Runly-Company-Id': this.#companyId },
    })
    if (!response.ok) {
      throw new Error(`Pull failed: ${response.status}`)
    }

    const { records, nextCursor } = await response.json()
    const now = new Date().toISOString()

    await this.#db.transaction(
      'rw',
      [this.#db.offline_records, this.#db.sync_state],
      async () => {
        for (const rec of records) {
          if (rec.deleted) {
            await this.#db.offline_records
              .where('[moduleKey+entityType+id]')
              .equals([rec.moduleKey, rec.entityType, rec.id])
              .delete()
          } else {
            await this.#db.offline_records.put({
              moduleKey: rec.moduleKey,
              entityType: rec.entityType,
              id: rec.id,
              data: rec.data,
              version: rec.version,
              pulledAt: now,
              companyId: rec.data?.companyId ?? null,
              dirty: false,
            })
          }
        }

        // Update sync_state for each (moduleKey, entityType) seen in the response
        const seen = new Map()
        for (const rec of records) {
          const key = `${rec.moduleKey}/${rec.entityType}`
          if (!seen.has(key)) seen.set(key, { moduleKey: rec.moduleKey, entityType: rec.entityType })
        }
        for (const { moduleKey, entityType } of seen.values()) {
          await this.#db.sync_state.put({
            moduleKey,
            entityType,
            lastPullAt: now,
            serverCursor: nextCursor,
            schemaVersion: null,
          })
        }
      },
    )

    return { pulled: records.length, nextCursor }
    } finally {
      this.#pulling = false
    }
  }

  async push() {
    if (this.#pushing) return { pushed: 0, failed: 0 }
    this.#pushing = true
    try {
      const token = await this.#getToken()
      if (!token || !this.#companyId) return { pushed: 0, failed: 0 }

      const pending = await this.#mutationQueue.getPending({ limit: 50 })
      if (pending.length === 0) return { pushed: 0, failed: 0 }

      for (const item of pending) {
        await this.#mutationQueue.markSyncing(item.id)
      }

      const mutations = pending.map((item) => ({
        idempotencyKey: item.idempotencyKey,
        moduleKey: item.moduleKey,
        entityType: item.entityType,
        operation: item.operation,
        recordId: item.recordId ?? null,
        payload: item.payload,
        queuedAt: item.queuedAt,
        clientUpdatedAt: item.clientUpdatedAt ?? null,
      }))

      const response = await this.#fetchImpl(`${this.#apiBaseUrl}/sync/push`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Runly-Company-Id': this.#companyId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ mutations }),
      })

      if (!response.ok) {
        for (const item of pending) {
          await this.#mutationQueue.markFailed(item.id, `Push failed: ${response.status}`)
        }
        throw new Error(`Push failed: ${response.status}`)
      }

      const { results } = await response.json()
      let pushed = 0
      let failed = 0

      await this.#db.transaction(
        'rw',
        [this.#db.mutation_queue, this.#db.offline_records, this.#db.conflicts],
        async () => {
          for (const result of results) {
            const item = pending.find((p) => p.idempotencyKey === result.idempotencyKey)
            if (!item) continue

            if (result.status === 'OK') {
              await this.#mutationQueue.markDone(item.id)
              if (result.record) {
                await this.#db.offline_records.put({
                  moduleKey: item.moduleKey,
                  entityType: item.entityType,
                  id: result.record.id,
                  data: result.record,
                  version: result.record.updatedAt ?? new Date().toISOString(),
                  pulledAt: new Date().toISOString(),
                  companyId: result.record.companyId ?? item.companyId ?? null,
                  dirty: false,
                })
              }
              pushed++
            } else if (result.status === 'CONFLICT') {
              const localRecord = await this.#db.offline_records.get(
                [item.moduleKey, item.entityType, item.recordId]
              )
              await this.#db.conflicts.put({
                id: crypto.randomUUID(),
                mutationId: item.id,
                moduleKey: item.moduleKey,
                entityType: item.entityType,
                recordId: item.recordId,
                localData: localRecord?.data ?? item.payload,
                serverData: result.record ?? null,
                detectedAt: new Date().toISOString(),
                status: 'PENDING',
              })
              await this.#mutationQueue.markConflict(item.id, 'Conflicto detectado en el servidor')
              failed++
            } else {
              await this.#mutationQueue.markFailed(item.id, result.status ?? 'Error')
              failed++
            }
          }
        },
      )

      return { pushed, failed }
    } finally {
      this.#pushing = false
    }
  }

  async getLocalCount({ moduleKey, entityType }) {
    return this.#db.offline_records.where({ moduleKey, entityType }).count()
  }
}
