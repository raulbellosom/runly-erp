export class SyncServiceError extends Error {
  constructor(message, status = 500, code = 'sync_error') {
    super(message)
    this.name = 'SyncServiceError'
    this.status = status
    this.code = code
  }
}

const RECORDS_LIMIT = 500

function makeHandler(entityType, prismaKey) {
  return {
    entityType,
    async fetch({ prisma, companyId, cursor, limit }) {
      const where = { companyId }
      if (cursor) where.updatedAt = { gt: new Date(cursor) }
      return prisma[prismaKey].findMany({
        where,
        take: limit,
        orderBy: { updatedAt: 'asc' },
      })
    },
    toRecord(row) {
      return {
        id: row.id,
        data: row,
        version: row.updatedAt.toISOString(),
        deleted: false,
      }
    },
  }
}

const SYNC_MODULE_REGISTRY = {
  'runly.contacts': {
    handlers: [makeHandler('contact', 'contact')],
  },
  'runly.hr': {
    handlers: [
      makeHandler('employee', 'hrEmployee'),
      makeHandler('department', 'hrDepartment'),
      makeHandler('job_title', 'hrJobTitle'),
    ],
  },
  'custom.fleet': {
    handlers: [
      makeHandler('vehicle', 'fleetVehicle'),
      makeHandler('driver', 'fleetDriver'),
    ],
  },
  'runly.calendar': {
    handlers: [
      {
        entityType: 'calendar',
        async fetch({ prisma, companyId, userId, cursor, limit }) {
          const where = { companyId, ownerId: userId, enabled: true }
          if (cursor) where.updatedAt = { gt: new Date(cursor) }
          return prisma.calendarCalendar.findMany({
            where,
            take: limit,
            orderBy: { updatedAt: 'asc' },
          })
        },
        toRecord(row) {
          return { id: row.id, data: row, version: row.updatedAt.toISOString(), deleted: false }
        },
      },
      {
        entityType: 'event',
        async fetch({ prisma, companyId, userId, cursor, limit }) {
          const owned = await prisma.calendarCalendar.findMany({
            where: { companyId, ownerId: userId, enabled: true },
            select: { id: true },
          })
          const calendarIds = owned.map((c) => c.id)
          if (!calendarIds.length) return []
          const where = { calendarId: { in: calendarIds }, enabled: true }
          if (cursor) where.updatedAt = { gt: new Date(cursor) }
          return prisma.calendarEvent.findMany({
            where,
            take: limit,
            orderBy: { updatedAt: 'asc' },
          })
        },
        toRecord(row) {
          return { id: row.id, data: row, version: row.updatedAt.toISOString(), deleted: false }
        },
      },
    ],
  },
  'runly.catalog': {
    handlers: [
      makeHandler('product', 'catalogProduct'),
      makeHandler('category', 'catalogCategory'),
    ],
  },
  'runly.ledger': {
    // runly.ledger accounts are NOT company-wide: each account is private to its
    // owner unless explicitly shared via ledger_account_member/ledger_group_member
    // (see apps/api/src/routes/ledger/ledger-service.js canReadAccount). The generic
    // makeHandler() only filters by companyId, which would silently sync every
    // company member's private accounts and transactions to every other member's
    // offline cache — so these two entity types need a scoped fetch instead.
    handlers: [
      {
        entityType: 'account',
        async fetch({ prisma, companyId, userId, cursor, limit }) {
          const accessible = await prisma.$queryRaw`
            SELECT a.id FROM ledger_account a
            WHERE a.company_id = ${companyId}::uuid
              AND (
                a.owner_id = ${userId}::uuid
                OR EXISTS (
                  SELECT 1 FROM ledger_account_member m
                  WHERE m.account_id = a.id AND m.user_id = ${userId}::uuid AND m.status = 'active'
                )
                OR EXISTS (
                  SELECT 1 FROM ledger_group_member gm
                  WHERE gm.group_id = a.group_id AND gm.user_id = ${userId}::uuid AND gm.status = 'active'
                )
              )
          `
          const ids = accessible.map((r) => r.id)
          if (ids.length === 0) return []
          const where = { companyId, id: { in: ids } }
          if (cursor) where.updatedAt = { gt: new Date(cursor) }
          return prisma.ledgerAccount.findMany({ where, take: limit, orderBy: { updatedAt: 'asc' } })
        },
        toRecord(row) {
          return { id: row.id, data: row, version: row.updatedAt.toISOString(), deleted: false }
        },
      },
      {
        entityType: 'transaction',
        async fetch({ prisma, companyId, userId, cursor, limit }) {
          const accessible = await prisma.$queryRaw`
            SELECT a.id FROM ledger_account a
            WHERE a.company_id = ${companyId}::uuid
              AND (
                a.owner_id = ${userId}::uuid
                OR EXISTS (
                  SELECT 1 FROM ledger_account_member m
                  WHERE m.account_id = a.id AND m.user_id = ${userId}::uuid AND m.status = 'active'
                )
                OR EXISTS (
                  SELECT 1 FROM ledger_group_member gm
                  WHERE gm.group_id = a.group_id AND gm.user_id = ${userId}::uuid AND gm.status = 'active'
                )
              )
          `
          const ids = accessible.map((r) => r.id)
          if (ids.length === 0) return []
          const where = { companyId, accountId: { in: ids } }
          if (cursor) where.updatedAt = { gt: new Date(cursor) }
          return prisma.ledgerTransaction.findMany({ where, take: limit, orderBy: { updatedAt: 'asc' } })
        },
        toRecord(row) {
          return { id: row.id, data: row, version: row.updatedAt.toISOString(), deleted: false }
        },
      },
      {
        entityType: 'category',
        async fetch({ prisma, companyId, userId, cursor, limit }) {
          // Matches categories-service.js: system categories (ownerId null) + own personal ones.
          const where = { companyId, OR: [{ ownerId: null }, { ownerId: userId }] }
          if (cursor) where.updatedAt = { gt: new Date(cursor) }
          return prisma.ledgerCategory.findMany({ where, take: limit, orderBy: { updatedAt: 'asc' } })
        },
        toRecord(row) {
          return { id: row.id, data: row, version: row.updatedAt.toISOString(), deleted: false }
        },
      },
      makeHandler('transaction_type', 'ledgerTransactionType'),
    ],
  },
}

// Atlas-spelled keys alias the same handler config: existing installs still
// report their module key as "atlas.*", fresh installs report "runly.*".
SYNC_MODULE_REGISTRY['atlas.contacts'] = SYNC_MODULE_REGISTRY['runly.contacts']
SYNC_MODULE_REGISTRY['atlas.hr'] = SYNC_MODULE_REGISTRY['runly.hr']
SYNC_MODULE_REGISTRY['atlas.calendar'] = SYNC_MODULE_REGISTRY['runly.calendar']
SYNC_MODULE_REGISTRY['atlas.catalog'] = SYNC_MODULE_REGISTRY['runly.catalog']
SYNC_MODULE_REGISTRY['atlas.ledger'] = SYNC_MODULE_REGISTRY['runly.ledger']

export function createSyncService({ prisma }) {
  // activeCompanyId: the caller's validated active company, resolved by the
  // API's tenant middleware and threaded down from routes/sync.js — never
  // re-derived here. See
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
  async function resolveCompanyContext(authUserId, activeCompanyId) {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId },
      select: { id: true },
    })
    if (!profile) {
      throw new SyncServiceError('Perfil de usuario no encontrado.', 404, 'profile_not_found')
    }
    if (activeCompanyId) {
      return { companyId: activeCompanyId, userId: profile.id }
    }
    const membership = await prisma.membership.findFirst({
      where: { userId: profile.id, enabled: true },
      orderBy: { createdAt: 'desc' },
      select: { companyId: true },
    })
    if (!membership?.companyId) {
      throw new SyncServiceError('No tienes una empresa activa.', 403, 'no_active_company')
    }
    return { companyId: membership.companyId, userId: profile.id }
  }

  async function pull({ authUserId, companyId: activeCompanyId, modules, cursor }) {
    if (!modules || modules.length === 0) {
      return { records: [], nextCursor: cursor ?? null, hasMore: false }
    }

    const { companyId, userId } = await resolveCompanyContext(authUserId, activeCompanyId)
    const records = []
    let hasMore = false

    for (const moduleKey of modules) {
      const mod = SYNC_MODULE_REGISTRY[moduleKey]
      if (!mod) continue
      for (const handler of mod.handlers) {
        const rows = await handler.fetch({ prisma, companyId, userId, cursor, limit: RECORDS_LIMIT + 1 })
        if (rows.length > RECORDS_LIMIT) {
          hasMore = true
          rows.splice(RECORDS_LIMIT)
        }
        for (const row of rows) {
          records.push({ moduleKey, entityType: handler.entityType, ...handler.toRecord(row) })
        }
      }
    }

    const nextCursor =
      records.length > 0
        ? records.reduce((max, r) => (r.version > max ? r.version : max), records[0].version)
        : cursor ?? null

    return { records, nextCursor, hasMore }
  }

  async function getStatus({ authUserId, companyId: activeCompanyId }) {
    const { companyId } = await resolveCompanyContext(authUserId, activeCompanyId)
    const cursors = await prisma.syncCursor.findMany({
      where: { companyId },
      orderBy: [{ moduleKey: 'asc' }, { entityType: 'asc' }],
    })
    return cursors.map((c) => ({
      moduleKey: c.moduleKey,
      entityType: c.entityType,
      cursor: c.cursor.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }))
  }

  return { pull, getStatus }
}
