// apps/api/src/routes/ledger/__tests__/ledger-service.test.js
//
// Regression coverage for the 2026-08-24 security fix: ledger_account rows
// with owner_id IS NULL used to be readable AND writable by every company
// member ("visible-to-everyone" legacy fallback from migration
// 20260605000000_add_ledger_collaboration_tables). The fallback is removed
// and owner_id is now NOT NULL at the DB level — these tests guard against
// silently reintroducing the bypass in ledger-service.js.
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLedgerService, LedgerServiceError } from '../ledger-service.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const OWNER_ID    = '01900000-0000-7000-8000-000000000002'
const OTHER_ID     = '01900000-0000-7000-8000-000000000003'
const ACCOUNT_ID   = '01900000-0000-7000-8000-000000000004'

function sqlContains(strings, keyword) {
  const sql = Array.isArray(strings) ? strings.join('') : String(strings)
  return sql.toLowerCase().includes(keyword.toLowerCase())
}

function buildPrismaMock(queryRawHandler) {
  return { $queryRaw: queryRawHandler }
}

describe('ledger-service — account access is never implicitly shared', () => {
  const account = {
    id: ACCOUNT_ID,
    company_id: COMPANY_ID,
    owner_id: OWNER_ID,
    name: 'Cuenta privada',
    bank: 'BBVA',
    opening_balance: 0,
  }

  for (const [fnName, buildCall] of [
    ['listAccounts', () => (prisma) => createLedgerService({ prisma }).listAccounts({ companyId: COMPANY_ID, actorId: OTHER_ID })],
    ['getAccount', () => (prisma) => createLedgerService({ prisma }).getAccount({ companyId: COMPANY_ID, accountId: ACCOUNT_ID, actorId: OTHER_ID })],
    ['canReadAccount', () => (prisma) => createLedgerService({ prisma }).canReadAccount({ companyId: COMPANY_ID, accountId: ACCOUNT_ID, actorId: OTHER_ID })],
    ['canWriteAccount', () => (prisma) => createLedgerService({ prisma }).canWriteAccount({ companyId: COMPANY_ID, accountId: ACCOUNT_ID, actorId: OTHER_ID })],
  ]) {
    it(`${fnName} never emits an "owner_id IS NULL" / OR-bypass clause`, async () => {
      let sawSql = false
      const prisma = buildPrismaMock(async (strings) => {
        sawSql = true
        assert.ok(
          !sqlContains(strings, 'owner_id is null') && !sqlContains(strings, 'owner_id IS NULL'),
          `${fnName} must never treat owner_id IS NULL as a public/shared fallback`,
        )
        return []
      })
      await buildCall()(prisma).catch(() => {}) // some paths throw on empty result; we only care about the SQL shape
      assert.ok(sawSql, `${fnName} should have issued a query`)
    })
  }

  it('getAccount rejects a call with no actorId instead of silently bypassing the check', async () => {
    const prisma = buildPrismaMock(async () => {
      throw new Error('should not query the database when actorId is missing')
    })
    const service = createLedgerService({ prisma })
    await assert.rejects(
      () => service.getAccount({ companyId: COMPANY_ID, accountId: ACCOUNT_ID, actorId: null }),
      (err) => err instanceof LedgerServiceError && err.status === 401,
    )
  })

  it('a non-owner/non-member actor gets zero rows back from listAccounts', async () => {
    const prisma = buildPrismaMock(async () => []) // simulates the real WHERE clause filtering the row out
    const service = createLedgerService({ prisma })
    const result = await service.listAccounts({ companyId: COMPANY_ID, actorId: OTHER_ID })
    assert.deepEqual(result.data, [])
  })

  it('createAccount refuses to create an ownerless account', async () => {
    const prisma = buildPrismaMock(async () => {
      throw new Error('should not reach the database without an owner')
    })
    const service = createLedgerService({ prisma })
    await assert.rejects(
      () => service.createAccount({ companyId: COMPANY_ID, ownerId: null, data: { name: 'x', bank: 'y', currency: 'MXN' } }),
      (err) => err instanceof LedgerServiceError && err.status === 400,
    )
  })

  it('getAccountUnchecked (internal-only) still resolves by id+company without an actor filter', async () => {
    const prisma = buildPrismaMock(async () => [account])
    const service = createLedgerService({ prisma })
    const row = await service.getAccountUnchecked({ companyId: COMPANY_ID, accountId: ACCOUNT_ID })
    assert.equal(row.id, ACCOUNT_ID)
  })
})

describe('ledger-service — listDisabledTransactions', () => {
  it('returns only disabled rows for the account, with pagination', async () => {
    const disabledRow = {
      id: 'tx-1', account_id: ACCOUNT_ID, company_id: COMPANY_ID, enabled: false,
      fecha: '2026-01-05', nombre: 'Movimiento eliminado', _total_count: 1,
    }
    const prisma = buildPrismaMock(async (strings) => {
      if (sqlContains(strings, 'enabled = false')) return [disabledRow]
      return []
    })
    const service = createLedgerService({ prisma })
    const result = await service.listDisabledTransactions({
      companyId: COMPANY_ID, accountId: ACCOUNT_ID, page: 1, pageSize: 20,
    })
    assert.equal(result.data.length, 1)
    assert.equal(result.data[0].nombre, 'Movimiento eliminado')
    assert.equal(result.data[0]._total_count, undefined)
    assert.equal(result.pagination.total, 1)
  })

  it('returns an empty page when there are no disabled transactions', async () => {
    const prisma = buildPrismaMock(async () => [])
    const service = createLedgerService({ prisma })
    const result = await service.listDisabledTransactions({
      companyId: COMPANY_ID, accountId: ACCOUNT_ID, page: 1, pageSize: 20,
    })
    assert.deepEqual(result.data, [])
    assert.equal(result.pagination.total, 0)
  })
})
