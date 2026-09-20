import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAiImportService } from '../ai-import-service.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const ACTOR_ID = '01900000-0000-7000-8000-000000000002'
const ACCOUNT_ID = '01900000-0000-7000-8000-000000000003'

// canWriteAccount is `SELECT 1 FROM ledger_account a WHERE ... (owner OR editor member OR editor/admin group member)`
// — it only cares whether any row comes back, so a single placeholder row is
// enough to represent "actor can write to this account" in these mocks.
// Tests that specifically exercise commit()'s authorization check override
// `canWriteAccountRows` directly.
function buildPrismaMock({ existingTransactions = [], accounts = [], canWriteAccountRows = [{}], auditLogFindFirst = async () => null } = {}) {
  return {
    $queryRaw: async (strings) => {
      const sql = strings.join('').toLowerCase()
      if (sql.includes('select 1 from ledger_account')) return canWriteAccountRows
      if (sql.includes('from ledger_account')) return accounts
      if (sql.includes('from ledger_transaction')) return existingTransactions
      if (sql.includes('insert into ledger_transaction')) return existingTransactions
      return []
    },
    auditLog: {
      findFirst: auditLogFindFirst,
      create: async () => ({ id: 'audit-1' }),
    },
    $transaction: async (fn) => fn({
      $queryRaw: async () => [],
      auditLog: { create: async () => ({ id: 'audit-1' }) },
    }),
  }
}

describe('ai-import-service commit idempotency', () => {
  it('returns the cached result instead of re-inserting when batchKey + fingerprint match a prior commit', async () => {
    const priorResult = { inserted: 3, skipped: 0 }
    const prisma = buildPrismaMock({
      auditLogFindFirst: async () => ({ metadata: { key: 'batch-1', fingerprint: 'expected-fp' }, after: priorResult }),
    })
    const service = createAiImportService({ prisma })
    const result = await service.commit({
      companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID,
      batchKey: 'batch-1', rows: [], __testFingerprint: 'expected-fp',
    })
    assert.deepEqual(result, priorResult)
  })

  it('rejects with 409 when batchKey repeats but the row content changed', async () => {
    const prisma = buildPrismaMock({
      auditLogFindFirst: async () => ({ metadata: { key: 'batch-1', fingerprint: 'old-fp' }, after: { inserted: 1, skipped: 0 } }),
    })
    const service = createAiImportService({ prisma })
    await assert.rejects(
      () => service.commit({ companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID, batchKey: 'batch-1', rows: [], __testFingerprint: 'new-fp' }),
      (err) => { assert.equal(err.status, 409); return true },
    )
  })

  it('filters the idempotency lookup by metadata.key so an unrelated prior import batch is never mistaken for this one', async () => {
    let capturedWhere
    const prisma = buildPrismaMock()
    prisma.auditLog.findFirst = async ({ where }) => { capturedWhere = where; return null }
    const service = createAiImportService({ prisma })
    await service.commit({ companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID, batchKey: 'batch-2', rows: [], __testFingerprint: 'fp' })
    assert.deepEqual(capturedWhere.metadata, { path: ['key'], equals: 'batch-2' })
  })
})

describe('ai-import-service commit authorization', () => {
  it('rejects with 403 when the actor has no write access to accountId, before touching the idempotency cache or inserting anything', async () => {
    let auditLogTouched = false
    let insertTouched = false
    const prisma = buildPrismaMock({ canWriteAccountRows: [] })
    prisma.auditLog.findFirst = async () => { auditLogTouched = true; return null }
    prisma.$transaction = async () => { insertTouched = true; return { inserted: 0, skipped: 0 } }
    const service = createAiImportService({ prisma })
    await assert.rejects(
      () => service.commit({ companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID, batchKey: 'batch-3', rows: [{ tempId: 'r1', fecha: '2026-01-01', nombre: 'X', deposito: 1, retiro: null }] }),
      (err) => { assert.equal(err.status, 403); return true },
    )
    assert.equal(auditLogTouched, false, 'must not check idempotency before authorization')
    assert.equal(insertTouched, false, 'must not attempt to insert without write access')
  })

  it('allows the commit when the actor has write access', async () => {
    const prisma = buildPrismaMock({ canWriteAccountRows: [{}] })
    const service = createAiImportService({ prisma })
    const result = await service.commit({
      companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID,
      batchKey: 'batch-4', rows: [{ tempId: 'r1', fecha: '2026-01-01', nombre: 'X', deposito: 1, retiro: null }],
    })
    assert.equal(result.inserted, 1)
  })
})
