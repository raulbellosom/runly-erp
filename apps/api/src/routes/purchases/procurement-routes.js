// runly.purchases: cases (expedientes), requests, quotes and the approvals inbox.
import { Hono } from 'hono'
import { actorId, assertPermission, body, canReadOf, companyOf, createHandler } from './route-helpers.js'
import { ACTION_PERMISSION } from './documents-routes.js'

const CASE_GATE = ['requests', 'quotes', 'approvals']

export function createPurchasesProcurementRouter({ requirePermission, services }) {
  const router = new Hono()
  const handle = createHandler('[purchases:procurement]')
  const { workflow, listing, procurement } = services
  const id = c => c.req.param('id')

  // ── Cases ──
  router.get('/purchases/cases', requirePermission('purchases.case.read'), c =>
    handle(c, async () => {
      await workflow.assertCapability(companyOf(c), CASE_GATE)
      return listing.list('cases', companyOf(c), c.req.query())
    }))
  router.post('/purchases/cases', requirePermission('purchases.case.manage'), c =>
    handle(c, async () => ({ data: await procurement.createCase(companyOf(c), actorId(c), await body(c)) }), 201))
  // Every document lives in a case, so the case detail stays readable in any
  // preset (e.g. legacy MIGRATED cases linked from Inventario).
  router.get('/purchases/cases/:id', requirePermission('purchases.case.read'), c =>
    handle(c, async () => ({ data: await procurement.getCase(companyOf(c), id(c), canReadOf(c)) })))
  router.post('/purchases/cases/:id/transition', requirePermission('purchases.case.manage'), c =>
    handle(c, async () => {
      const { action } = await body(c)
      return { data: await procurement.transitionCase(companyOf(c), actorId(c), id(c), String(action ?? '')) }
    }))

  // ── Requests ──
  router.get('/purchases/requests', requirePermission('purchases.request.read'), c =>
    handle(c, async () => {
      await workflow.assertCapability(companyOf(c), 'requests')
      return listing.list('requests', companyOf(c), c.req.query())
    }))
  router.post('/purchases/requests', requirePermission('purchases.request.create'), c =>
    handle(c, async () => ({ data: await procurement.createRequest(companyOf(c), actorId(c), await body(c)) }), 201))
  router.get('/purchases/requests/:id', requirePermission('purchases.request.read'), c =>
    handle(c, async () => {
      await workflow.assertCapability(companyOf(c), 'requests')
      return { data: await procurement.getRequest(companyOf(c), id(c), canReadOf(c)) }
    }))
  router.patch('/purchases/requests/:id', requirePermission('purchases.request.update'), c =>
    handle(c, async () => ({ data: await procurement.updateRequest(companyOf(c), actorId(c), id(c), await body(c)) })))
  router.post('/purchases/requests/:id/transition', requirePermission('purchases.request.update'), c =>
    handle(c, async () => {
      const { action, ...payload } = await body(c)
      if (ACTION_PERMISSION[action]) assertPermission(c, ACTION_PERMISSION[action])
      if (action === 'convert') assertPermission(c, 'purchases.order.create')
      return { data: await procurement.transitionRequest(companyOf(c), actorId(c), id(c), String(action ?? ''), payload) }
    }))

  // ── Quotes ──
  router.get('/purchases/quotes', requirePermission('purchases.quote.read'), c =>
    handle(c, async () => {
      await workflow.assertCapability(companyOf(c), 'quotes')
      return listing.list('quotes', companyOf(c), c.req.query())
    }))
  router.post('/purchases/quotes', requirePermission('purchases.quote.manage'), c =>
    handle(c, async () => ({ data: await procurement.createQuote(companyOf(c), actorId(c), await body(c)) }), 201))
  router.get('/purchases/quotes/:id', requirePermission('purchases.quote.read'), c =>
    handle(c, async () => {
      await workflow.assertCapability(companyOf(c), 'quotes')
      return { data: await procurement.getQuote(companyOf(c), id(c), canReadOf(c)) }
    }))
  router.post('/purchases/quotes/:id/transition', requirePermission('purchases.quote.manage'), c =>
    handle(c, async () => {
      const { action } = await body(c)
      return { data: await procurement.transitionQuote(companyOf(c), actorId(c), id(c), String(action ?? '')) }
    }))

  // ── Approvals inbox ──
  router.get('/purchases/approvals', requirePermission('purchases.approval.decide'), c =>
    handle(c, () => procurement.listApprovals(companyOf(c), c.req.query())))
  router.post('/purchases/approvals/:id/decide', requirePermission('purchases.approval.decide'), c =>
    handle(c, async () => ({ data: await procurement.decideApproval(companyOf(c), actorId(c), id(c), await body(c)) })))

  return router
}
