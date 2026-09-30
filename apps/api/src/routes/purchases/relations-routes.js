// runly.purchases: relations, invoice propagation, inventory bridge and the
// "Relacionar existente" document search.
import { Hono } from 'hono'
import { actorId, assertPermission, authUserId, body, canReadOf, companyOf, createHandler } from './route-helpers.js'
import { PurchasesServiceError } from '../../services/purchases-shared.js'

export function createPurchasesRelationsRouter({ requirePermission, services }) {
  const router = new Hono()
  const handle = createHandler('[purchases:relations]')
  const { workflow, relations, hydrator, inventory } = services

  router.get('/purchases/relations/propagation', requirePermission('purchases.relation.read'), c =>
    handle(c, async () => {
      await workflow.assertCapability(companyOf(c), 'inventoryRelations')
      const { invoiceId, orderIds } = c.req.query()
      return { data: await relations.propagationPreview(companyOf(c), { invoiceId, orderIds }) }
    }))

  router.get('/purchases/relations', requirePermission('purchases.relation.read'), c =>
    handle(c, async () => {
      const { moduleKey, entityType, entityId } = c.req.query()
      if (!moduleKey || !entityType || !entityId) throw new PurchasesServiceError('Faltan datos de la entidad.')
      return { data: await hydrator.relationsFor(companyOf(c), moduleKey, entityType, entityId, canReadOf(c)) }
    }))

  router.post('/purchases/relations/bulk', requirePermission('purchases.relation.manage'), c =>
    handle(c, async () => ({ data: await relations.bulkRelate(companyOf(c), actorId(c), await body(c)) }), 201))

  router.post('/purchases/relations', requirePermission('purchases.relation.manage'), c =>
    handle(c, async () => ({ data: await relations.createRelation(companyOf(c), actorId(c), await body(c)) }), 201))

  router.delete('/purchases/relations/:id', requirePermission('purchases.relation.manage'), c =>
    handle(c, async () => {
      await relations.deleteRelation(companyOf(c), actorId(c), c.req.param('id'))
      return { success: true }
    }))

  router.get('/purchases/inventory/candidates', requirePermission('purchases.relation.read'), c =>
    handle(c, async () => {
      await workflow.assertCapability(companyOf(c), 'inventoryRelations')
      return inventory.inventoryCandidates(companyOf(c), c.req.query())
    }))

  router.get('/purchases/inventory/:itemId/summary', requirePermission('purchases.relation.read'), c =>
    handle(c, async () => ({ data: await inventory.inventorySummary(companyOf(c), c.req.param('itemId'), canReadOf(c)) })))

  router.post('/purchases/lines/:lineId/inventory', requirePermission('purchases.relation.manage'), c =>
    handle(c, async () => {
      assertPermission(c, 'inventory.item.create')
      const data = await inventory.createInventoryFromLine(companyOf(c), { profileId: actorId(c), authUserId: authUserId(c) }, c.req.param('lineId'), await body(c))
      return { data }
    }, 201))

  router.get('/purchases/documents/search', requirePermission('purchases.relation.read'), c =>
    handle(c, () => relations.searchDocuments(companyOf(c), c.req.query())))

  return router
}
