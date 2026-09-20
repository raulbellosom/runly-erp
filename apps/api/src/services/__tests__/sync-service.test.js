import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSyncService, SyncServiceError } from '../sync-service.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const USER_ID = '01900000-0000-7000-8000-000000000002'
const now = new Date()
const past = new Date(now.getTime() - 60_000)

function makePrisma(overrides = {}) {
  return {
    userProfile: {
      findUnique: async () => ({ id: USER_ID }),
      ...(overrides.userProfile ?? {}),
    },
    membership: {
      findFirst: async () => ({ companyId: COMPANY_ID }),
      ...(overrides.membership ?? {}),
    },
    contact: {
      findMany: async () => [],
      ...(overrides.contact ?? {}),
    },
    hrEmployee: {
      findMany: async () => [],
      ...(overrides.hrEmployee ?? {}),
    },
    hrDepartment: {
      findMany: async () => [],
      ...(overrides.hrDepartment ?? {}),
    },
    hrJobTitle: {
      findMany: async () => [],
      ...(overrides.hrJobTitle ?? {}),
    },
    fleetVehicle: {
      findMany: async () => [],
      ...(overrides.fleetVehicle ?? {}),
    },
    fleetDriver: {
      findMany: async () => [],
      ...(overrides.fleetDriver ?? {}),
    },
    calendarCalendar: {
      findMany: async () => [],
      ...(overrides.calendarCalendar ?? {}),
    },
    calendarEvent: {
      findMany: async () => [],
      ...(overrides.calendarEvent ?? {}),
    },
    catalogProduct: {
      findMany: async () => [],
      ...(overrides.catalogProduct ?? {}),
    },
    catalogCategory: {
      findMany: async () => [],
      ...(overrides.catalogCategory ?? {}),
    },
    ledgerAccount: {
      findMany: async () => [],
      ...(overrides.ledgerAccount ?? {}),
    },
    ledgerTransaction: {
      findMany: async () => [],
      ...(overrides.ledgerTransaction ?? {}),
    },
    ledgerCategory: {
      findMany: async () => [],
      ...(overrides.ledgerCategory ?? {}),
    },
    ledgerTransactionType: {
      findMany: async () => [],
      ...(overrides.ledgerTransactionType ?? {}),
    },
    syncCursor: {
      findMany: async () => [],
      ...(overrides.syncCursor ?? {}),
    },
    $queryRaw: overrides.$queryRaw ?? (async () => []),
  }
}

describe('sync-service', () => {
  it('returns empty records when no modules requested', async () => {
    const svc = createSyncService({ prisma: makePrisma() })
    const result = await svc.pull({ authUserId: USER_ID, modules: [], cursor: null })
    assert.deepEqual(result, { records: [], nextCursor: null, hasMore: false })
  })

  it('throws profile_not_found when user has no profile', async () => {
    const prisma = makePrisma({ userProfile: { findUnique: async () => null } })
    const svc = createSyncService({ prisma })
    await assert.rejects(
      () => svc.pull({ authUserId: USER_ID, modules: ['atlas.contacts'], cursor: null }),
      (err) => err instanceof SyncServiceError && err.code === 'profile_not_found',
    )
  })

  it('throws no_active_company when user has no membership', async () => {
    const prisma = makePrisma({ membership: { findFirst: async () => null } })
    const svc = createSyncService({ prisma })
    await assert.rejects(
      () => svc.pull({ authUserId: USER_ID, modules: ['atlas.contacts'], cursor: null }),
      (err) => err instanceof SyncServiceError && err.code === 'no_active_company',
    )
  })

  it('returns contacts for atlas.contacts module', async () => {
    const contact = { id: 'c1', companyId: COMPANY_ID, type: 'person', name: 'Ana', updatedAt: now, createdAt: past }
    const svc = createSyncService({ prisma: makePrisma({ contact: { findMany: async () => [contact] } }) })
    const result = await svc.pull({ authUserId: USER_ID, modules: ['atlas.contacts'], cursor: null })
    assert.equal(result.records.length, 1)
    assert.equal(result.records[0].moduleKey, 'atlas.contacts')
    assert.equal(result.records[0].entityType, 'contact')
    assert.equal(result.records[0].id, 'c1')
    assert.equal(result.records[0].deleted, false)
    assert.ok(result.nextCursor)
  })

  it('passes cursor as Date gt filter when provided', async () => {
    let capturedWhere = null
    const svc = createSyncService({
      prisma: makePrisma({
        contact: { findMany: async ({ where }) => { capturedWhere = where; return [] } },
      }),
    })
    const cursorStr = past.toISOString()
    await svc.pull({ authUserId: USER_ID, modules: ['atlas.contacts'], cursor: cursorStr })
    assert.ok(capturedWhere?.updatedAt?.gt instanceof Date)
    assert.equal(capturedWhere.updatedAt.gt.toISOString(), cursorStr)
  })

  it('returns employee, department, job_title for atlas.hr module', async () => {
    const employee = { id: 'e1', companyId: COMPANY_ID, firstName: 'Juan', lastName: 'Paz', status: 'active', updatedAt: now, createdAt: past }
    const department = { id: 'd1', companyId: COMPANY_ID, name: 'TI', enabled: true, updatedAt: now, createdAt: past }
    const jobTitle = { id: 'jt1', companyId: COMPANY_ID, name: 'Dev', enabled: true, updatedAt: now, createdAt: past }
    const svc = createSyncService({
      prisma: makePrisma({
        hrEmployee: { findMany: async () => [employee] },
        hrDepartment: { findMany: async () => [department] },
        hrJobTitle: { findMany: async () => [jobTitle] },
      }),
    })
    const result = await svc.pull({ authUserId: USER_ID, modules: ['atlas.hr'], cursor: null })
    const types = result.records.map((r) => r.entityType)
    assert.ok(types.includes('employee'))
    assert.ok(types.includes('department'))
    assert.ok(types.includes('job_title'))
  })

  it('returns vehicle and driver for custom.fleet module', async () => {
    const vehicle = { id: 'v1', companyId: COMPANY_ID, plate: 'ABC-123', status: 'active', updatedAt: now, createdAt: past }
    const driver = { id: 'dr1', companyId: COMPANY_ID, firstName: 'Luis', lastName: 'Vega', phone: '555', licenseNumber: 'L1', status: 'active', updatedAt: now, createdAt: past }
    const svc = createSyncService({
      prisma: makePrisma({
        fleetVehicle: { findMany: async () => [vehicle] },
        fleetDriver: { findMany: async () => [driver] },
      }),
    })
    const result = await svc.pull({ authUserId: USER_ID, modules: ['custom.fleet'], cursor: null })
    const types = result.records.map((r) => r.entityType)
    assert.ok(types.includes('vehicle'))
    assert.ok(types.includes('driver'))
  })

  it('sets nextCursor to max version across all returned records', async () => {
    const older = new Date('2026-06-01T00:00:00Z')
    const newer = new Date('2026-06-02T00:00:00Z')
    const c1 = { id: 'c1', companyId: COMPANY_ID, type: 'person', name: 'A', updatedAt: older, createdAt: older }
    const c2 = { id: 'c2', companyId: COMPANY_ID, type: 'person', name: 'B', updatedAt: newer, createdAt: older }
    const svc = createSyncService({ prisma: makePrisma({ contact: { findMany: async () => [c1, c2] } }) })
    const result = await svc.pull({ authUserId: USER_ID, modules: ['atlas.contacts'], cursor: null })
    assert.equal(result.nextCursor, newer.toISOString())
  })

  it('silently skips unknown module keys', async () => {
    const svc = createSyncService({ prisma: makePrisma() })
    const result = await svc.pull({ authUserId: USER_ID, modules: ['atlas.unknown_module_xyz'], cursor: null })
    assert.equal(result.records.length, 0)
    assert.equal(result.hasMore, false)
  })

  it('returns sync cursor status via getStatus()', async () => {
    const cursors = [{ moduleKey: 'atlas.contacts', entityType: 'contact', cursor: now, updatedAt: now }]
    const svc = createSyncService({ prisma: makePrisma({ syncCursor: { findMany: async () => cursors } }) })
    const result = await svc.getStatus({ authUserId: USER_ID })
    assert.equal(result.length, 1)
    assert.equal(result[0].moduleKey, 'atlas.contacts')
    assert.equal(result[0].entityType, 'contact')
    assert.ok(result[0].cursor)
  })

  describe('atlas.calendar module', () => {
    it('returns calendar records scoped by userId (not companyId)', async () => {
      const cal = { id: 'cal1', ownerId: USER_ID, name: 'Mi agenda', color: '#6B46C1', isDefault: true, enabled: true, createdAt: past, updatedAt: now }
      const svc = createSyncService({
        prisma: makePrisma({
          calendarCalendar: { findMany: async () => [cal] },
          calendarEvent: { findMany: async () => [] },
        }),
      })
      const result = await svc.pull({ authUserId: 'auth-u1', modules: ['atlas.calendar'], cursor: null })
      const calRec = result.records.find((r) => r.entityType === 'calendar')
      assert.ok(calRec, 'calendar record must be present')
      assert.equal(calRec.id, 'cal1')
      assert.equal(calRec.moduleKey, 'atlas.calendar')
      assert.equal(calRec.deleted, false)
    })

    it('calendar handler requires both the owner and active company', async () => {
      let capturedWhere = null
      const svc = createSyncService({
        prisma: makePrisma({
          calendarCalendar: {
            findMany: async ({ where }) => { capturedWhere = where; return [] },
          },
          calendarEvent: { findMany: async () => [] },
        }),
      })
      await svc.pull({ authUserId: 'auth-u1', modules: ['atlas.calendar'], cursor: null })
      assert.equal(capturedWhere?.ownerId, USER_ID)
      assert.equal(capturedWhere?.enabled, true)
      assert.equal(capturedWhere?.companyId, COMPANY_ID, 'calendar must stay in the active company')
    })

    it('event handler fetches events for owned calendar IDs', async () => {
      const cal = { id: 'cal1', ownerId: USER_ID, name: 'Mi agenda', color: '#6B46C1', isDefault: true, enabled: true, createdAt: past, updatedAt: now }
      const event = { id: 'ev1', calendarId: 'cal1', title: 'Reunión', startAt: now, endAt: null, allDay: false, enabled: true, createdAt: past, updatedAt: now }
      let capturedEventWhere = null
      const svc = createSyncService({
        prisma: makePrisma({
          calendarCalendar: {
            findMany: async ({ select }) => select ? [{ id: 'cal1' }] : [cal],
          },
          calendarEvent: {
            findMany: async ({ where }) => { capturedEventWhere = where; return [event] },
          },
        }),
      })
      const result = await svc.pull({ authUserId: 'auth-u1', modules: ['atlas.calendar'], cursor: null })
      const evRec = result.records.find((r) => r.entityType === 'event')
      assert.ok(evRec, 'event record must be present')
      assert.equal(evRec.id, 'ev1')
      assert.deepEqual(capturedEventWhere?.calendarId, { in: ['cal1'] })
    })

    it('event handler returns empty when user owns no calendars', async () => {
      let eventFetchCalled = false
      const svc = createSyncService({
        prisma: makePrisma({
          calendarCalendar: { findMany: async () => [] },
          calendarEvent: { findMany: async () => { eventFetchCalled = true; return [] } },
        }),
      })
      const result = await svc.pull({ authUserId: 'auth-u1', modules: ['atlas.calendar'], cursor: null })
      assert.equal(result.records.filter((r) => r.entityType === 'event').length, 0)
      assert.equal(eventFetchCalled, false, 'event query must be skipped when no owned calendars')
    })
  })

  describe('atlas.catalog module', () => {
    it('returns product and category records for atlas.catalog', async () => {
      const product = { id: 'p1', companyId: COMPANY_ID, name: 'Widget', sku: 'W-001', enabled: true, updatedAt: now, createdAt: past }
      const category = { id: 'cat1', companyId: COMPANY_ID, name: 'Herramientas', enabled: true, updatedAt: now, createdAt: past }
      const svc = createSyncService({
        prisma: makePrisma({
          catalogProduct: { findMany: async () => [product] },
          catalogCategory: { findMany: async () => [category] },
        }),
      })
      const result = await svc.pull({ authUserId: USER_ID, modules: ['atlas.catalog'], cursor: null })
      const types = result.records.map((r) => r.entityType)
      assert.ok(types.includes('product'), 'must include product entityType')
      assert.ok(types.includes('category'), 'must include category entityType')
      assert.equal(result.records.find((r) => r.entityType === 'product').id, 'p1')
      assert.equal(result.records.find((r) => r.entityType === 'category').id, 'cat1')
    })

    it('product handler filters by companyId (not userId)', async () => {
      let capturedWhere = null
      const svc = createSyncService({
        prisma: makePrisma({
          catalogProduct: { findMany: async ({ where }) => { capturedWhere = where; return [] } },
        }),
      })
      await svc.pull({ authUserId: USER_ID, modules: ['atlas.catalog'], cursor: null })
      assert.equal(capturedWhere?.companyId, COMPANY_ID)
      assert.equal(capturedWhere?.ownerId, undefined, 'product must NOT filter by ownerId')
    })

    it('category handler filters by companyId', async () => {
      let capturedWhere = null
      const svc = createSyncService({
        prisma: makePrisma({
          catalogCategory: { findMany: async ({ where }) => { capturedWhere = where; return [] } },
        }),
      })
      await svc.pull({ authUserId: USER_ID, modules: ['atlas.catalog'], cursor: null })
      assert.equal(capturedWhere?.companyId, COMPANY_ID)
    })
  })

  describe('atlas.ledger module', () => {
    it('returns account, transaction, category, transaction_type records', async () => {
      const account = {
        id: 'acc-1', companyId: COMPANY_ID, name: 'BBVA Principal', bank: 'BBVA',
        accountNumber: '1234', currency: 'MXN', openingBalance: 0,
        enabled: true, createdAt: past, updatedAt: now,
      }
      const transaction = {
        id: 'tx-1', companyId: COMPANY_ID, accountId: 'acc-1',
        categoryId: null, tipoId: null, fecha: now, numero: '001',
        nombre: 'Deposito inicial', referencia: null, concepto: null,
        deposito: 1000, retiro: null, enabled: true, createdAt: past, updatedAt: now,
      }
      const category = {
        id: 'cat-1', companyId: COMPANY_ID, name: 'Ingresos',
        color: '#22c55e', kind: 'income', enabled: true, createdAt: past, updatedAt: now,
      }
      const txType = {
        id: 'typ-1', companyId: COMPANY_ID, code: 'DEP', name: 'Deposito',
        enabled: true, createdAt: past, updatedAt: now,
      }
      const svc = createSyncService({
        prisma: makePrisma({
          $queryRaw: async () => [{ id: 'acc-1' }],
          ledgerAccount:          { findMany: async () => [account] },
          ledgerTransaction:      { findMany: async () => [transaction] },
          ledgerCategory:         { findMany: async () => [category] },
          ledgerTransactionType:  { findMany: async () => [txType] },
        }),
      })
      const result = await svc.pull({ authUserId: USER_ID, modules: ['atlas.ledger'], cursor: null })
      const types = result.records.map((r) => r.entityType)
      assert.ok(types.includes('account'),          'must include account')
      assert.ok(types.includes('transaction'),      'must include transaction')
      assert.ok(types.includes('category'),         'must include category')
      assert.ok(types.includes('transaction_type'), 'must include transaction_type')
      assert.equal(result.records.find((r) => r.entityType === 'account').id, 'acc-1')
      assert.equal(result.records.find((r) => r.entityType === 'transaction').id, 'tx-1')
    })

    // 2026-08-24 security fix: ledger accounts are private to their owner unless
    // explicitly shared (ledger_account_member / ledger_group_member), so the sync
    // handler must NEVER hand back accounts the requesting user cannot access.
    it('account handler only syncs accounts the user can access (owner/member), never the whole company', async () => {
      let capturedWhere = null
      const svc = createSyncService({
        prisma: makePrisma({
          $queryRaw: async () => [{ id: 'acc-1' }], // simulates the accessible-ids pre-query
          ledgerAccount: {
            findMany: async ({ where }) => { capturedWhere = where; return [] },
          },
        }),
      })
      await svc.pull({ authUserId: USER_ID, modules: ['atlas.ledger'], cursor: null })
      assert.equal(capturedWhere?.companyId, COMPANY_ID)
      assert.deepEqual(capturedWhere?.id, { in: ['acc-1'] }, 'must restrict to the accessible-account id set')
    })

    it('account handler returns no records when the user has no accessible accounts', async () => {
      let findManyCalled = false
      const svc = createSyncService({
        prisma: makePrisma({
          $queryRaw: async () => [], // no owned/shared accounts
          ledgerAccount: { findMany: async () => { findManyCalled = true; return [] } },
        }),
      })
      const result = await svc.pull({ authUserId: USER_ID, modules: ['atlas.ledger'], cursor: null })
      assert.equal(findManyCalled, false, 'must short-circuit instead of querying the full company')
      assert.equal(result.records.filter((r) => r.entityType === 'account').length, 0)
    })

    it('transaction handler restricts to transactions of accessible accounts only', async () => {
      let capturedWhere = null
      const svc = createSyncService({
        prisma: makePrisma({
          $queryRaw: async () => [{ id: 'acc-1' }],
          ledgerTransaction: {
            findMany: async ({ where }) => { capturedWhere = where; return [] },
          },
        }),
      })
      await svc.pull({ authUserId: USER_ID, modules: ['atlas.ledger'], cursor: null })
      assert.equal(capturedWhere?.companyId, COMPANY_ID)
      assert.deepEqual(capturedWhere?.accountId, { in: ['acc-1'] })
    })

    it('category handler filters by companyId and restricts to system + own categories', async () => {
      let capturedWhere = null
      const svc = createSyncService({
        prisma: makePrisma({
          ledgerCategory: {
            findMany: async ({ where }) => { capturedWhere = where; return [] },
          },
        }),
      })
      await svc.pull({ authUserId: USER_ID, modules: ['atlas.ledger'], cursor: null })
      assert.equal(capturedWhere?.companyId, COMPANY_ID)
      assert.deepEqual(capturedWhere?.OR, [{ ownerId: null }, { ownerId: USER_ID }])
    })

    it('transaction_type handler filters by companyId', async () => {
      let capturedWhere = null
      const svc = createSyncService({
        prisma: makePrisma({
          ledgerTransactionType: {
            findMany: async ({ where }) => { capturedWhere = where; return [] },
          },
        }),
      })
      await svc.pull({ authUserId: USER_ID, modules: ['atlas.ledger'], cursor: null })
      assert.equal(capturedWhere?.companyId, COMPANY_ID)
    })
  })
})
