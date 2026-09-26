// apps/api/src/routes/ledger/__tests__/categories-service.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCategoriesService } from '../categories-service.js'
import { LedgerServiceError } from '../ledger-service.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const ACTOR_ID   = '01900000-0000-7000-8000-000000000002'

describe('categories-service', () => {
  it('listCategories includes disabled categories when includeDisabled is true', async () => {
    const rows = [
      { id: 'c1', company_id: COMPANY_ID, owner_id: ACTOR_ID, name: 'Activa', enabled: true, is_system: false },
      { id: 'c2', company_id: COMPANY_ID, owner_id: ACTOR_ID, name: 'Inactiva', enabled: false, is_system: false },
    ]
    const prisma = { $queryRaw: async () => rows }
    const service = createCategoriesService({ prisma })
    const result = await service.listCategories({ companyId: COMPANY_ID, actorId: ACTOR_ID, includeDisabled: true })
    assert.equal(result.data.length, 2)
  })

  it('listCategories passes includeDisabled=false to the query by default', async () => {
    let capturedValues = null
    const prisma = {
      $queryRaw: async (strings, ...values) => { capturedValues = values; return [] },
    }
    const service = createCategoriesService({ prisma })
    await service.listCategories({ companyId: COMPANY_ID, actorId: ACTOR_ID })
    assert.ok(capturedValues.includes(false), 'expected the default includeDisabled=false to be bound')
  })

  it('setCategoryEnabled refuses to change a system category', async () => {
    const systemRow = { id: 'c3', company_id: COMPANY_ID, owner_id: null, name: 'Sistema', enabled: false, is_system: true }
    const prisma = { $queryRaw: async () => [systemRow] }
    const service = createCategoriesService({ prisma })
    await assert.rejects(
      () => service.setCategoryEnabled({ companyId: COMPANY_ID, categoryId: 'c3', actorId: ACTOR_ID, enabled: true }),
      (err) => {
        assert.ok(err instanceof LedgerServiceError)
        assert.equal(err.status, 403)
        return true
      },
    )
  })
})
