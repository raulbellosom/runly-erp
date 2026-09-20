import { MutationQueue } from './mutation-queue.js'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH'])

// Maps API path patterns to module metadata.
// Patterns with ID must come before patterns without ID (more specific first).
const ROUTE_MAP = [
  // runly.contacts
  { pattern: /^\/contacts\/([^/?#]+)$/, moduleKey: 'runly.contacts', entityType: 'contact', hasId: true },
  { pattern: /^\/contacts$/, moduleKey: 'runly.contacts', entityType: 'contact', hasId: false },
  // runly.hr — departments
  { pattern: /^\/hr\/departments\/([^/?#]+)$/, moduleKey: 'runly.hr', entityType: 'department', hasId: true },
  { pattern: /^\/hr\/departments$/, moduleKey: 'runly.hr', entityType: 'department', hasId: false },
  // runly.hr — job-titles
  { pattern: /^\/hr\/job-titles\/([^/?#]+)$/, moduleKey: 'runly.hr', entityType: 'job_title', hasId: true },
  { pattern: /^\/hr\/job-titles$/, moduleKey: 'runly.hr', entityType: 'job_title', hasId: false },
  // runly.hr — employees
  { pattern: /^\/hr\/employees\/([^/?#]+)$/, moduleKey: 'runly.hr', entityType: 'employee', hasId: true },
  { pattern: /^\/hr\/employees$/, moduleKey: 'runly.hr', entityType: 'employee', hasId: false },
  // custom.fleet — vehicles
  { pattern: /^\/fleet\/vehicles\/([^/?#]+)$/, moduleKey: 'custom.fleet', entityType: 'vehicle', hasId: true },
  { pattern: /^\/fleet\/vehicles$/, moduleKey: 'custom.fleet', entityType: 'vehicle', hasId: false },
  // custom.fleet — drivers
  { pattern: /^\/fleet\/drivers\/([^/?#]+)$/, moduleKey: 'custom.fleet', entityType: 'driver', hasId: true },
  { pattern: /^\/fleet\/drivers$/, moduleKey: 'custom.fleet', entityType: 'driver', hasId: false },
  // runly.catalog — products
  { pattern: /^\/catalog\/products\/([^/?#]+)$/, moduleKey: 'runly.catalog', entityType: 'product', hasId: true },
  { pattern: /^\/catalog\/products$/, moduleKey: 'runly.catalog', entityType: 'product', hasId: false },
  // runly.catalog — categories
  { pattern: /^\/catalog\/categories\/([^/?#]+)$/, moduleKey: 'runly.catalog', entityType: 'category', hasId: true },
  { pattern: /^\/catalog\/categories$/, moduleKey: 'runly.catalog', entityType: 'category', hasId: false },
]

export function parseMutationRoute(path, method) {
  const upperMethod = (method ?? 'GET').toUpperCase()
  // Strip query string and trailing slash before matching
  const cleanPath = path.split('?')[0].replace(/\/+$/, '')
  for (const route of ROUTE_MAP) {
    const match = cleanPath.match(route.pattern)
    if (!match) continue
    const recordId = route.hasId ? match[1] : null
    const operation = upperMethod === 'POST' ? 'CREATE' : 'UPDATE'
    return { moduleKey: route.moduleKey, entityType: route.entityType, operation, recordId }
  }
  return null
}

export function createOfflineTransport({ db, getSession }) {
  const mutationQueue = new MutationQueue({ db })

  async function queue(path, options) {
    const method = (options?.method ?? 'GET').toUpperCase()
    if (!MUTATION_METHODS.has(method)) return null

    const parsed = parseMutationRoute(path, method)
    if (!parsed) return null

    const { moduleKey, entityType, operation, recordId } = parsed
    const session = await getSession()
    if (!session?.companyId || !session?.userProfile?.id) throw new Error('Selecciona una empresa y una sesión válida antes de guardar sin conexión.')
    const requestedCompanyId = new Headers(options?.headers).get('X-Runly-Company-Id')
    if (requestedCompanyId && requestedCompanyId !== session.companyId) {
      throw new Error('La empresa de la solicitud no coincide con la sesión sin conexión.')
    }

    let payload = {}
    if (options?.body) {
      try {
        payload = typeof options.body === 'string' ? JSON.parse(options.body) : options.body
      } catch {
        payload = {}
      }
    }

    const id = crypto.randomUUID()
    const idempotencyKey = crypto.randomUUID()

    // For UPDATE mutations, read the existing record once: used for both
    // clientUpdatedAt capture (conflict detection) and the optimistic write below.
    let existingRecord = null
    let clientUpdatedAt = null
    if (operation === 'UPDATE' && recordId) {
      existingRecord = await db.offline_records.get([moduleKey, entityType, recordId])
      clientUpdatedAt = existingRecord?.data?.updatedAt ?? null
    }

    await mutationQueue.enqueue({
      id,
      idempotencyKey,
      moduleKey,
      entityType,
      recordId,
      operation,
      payload,
      companyId: session?.companyId ?? null,
      userId: session?.userProfile?.id ?? null,
      clientUpdatedAt,
    })

    // Optimistic update: apply the change to offline_records immediately
    if (operation === 'UPDATE' && existingRecord) {
      await db.offline_records.put({ ...existingRecord, data: { ...existingRecord.data, ...payload }, dirty: true })
    } else if (operation === 'CREATE') {
      const localId = recordId ?? id
      await db.offline_records.put({
        moduleKey,
        entityType,
        id: localId,
        data: { id: localId, companyId: session?.companyId ?? null, ...payload },
        version: new Date().toISOString(),
        pulledAt: new Date().toISOString(),
        companyId: session?.companyId ?? null,
        dirty: true,
      })
    }

    return { queued: true, id }
  }

  return { queue, mutationQueue }
}
