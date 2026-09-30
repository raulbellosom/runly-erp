// runly.purchases: settings, capabilities, dashboard and suppliers.
import { Hono } from 'hono'
import { actorId, body, companyOf, createHandler } from './route-helpers.js'

export function createPurchasesSettingsRouter({ requirePermission, requireAnyPermission, services }) {
  const router = new Hono()
  const anyPurchasesReader = requireAnyPermission
    ? requireAnyPermission(['purchases.access', 'purchases.read', 'purchases.relation.read'])
    : requirePermission('purchases.access')
  const handle = createHandler('[purchases:settings]')
  const { workflow, suppliers } = services

  router.get('/purchases/settings', requirePermission('purchases.settings.read'), c =>
    handle(c, async () => ({ data: await workflow.getSettings(companyOf(c), actorId(c)) })))

  router.put('/purchases/settings', requirePermission('purchases.settings.manage'), c =>
    handle(c, async () => ({ data: await workflow.updateSettings(companyOf(c), actorId(c), await body(c)) })))

  // Any purchases reader (and the inventory "Compra" section) needs the flags.
  router.get('/purchases/capabilities', anyPurchasesReader, c =>
    handle(c, async () => ({ data: await workflow.getCapabilities(companyOf(c), actorId(c)) })))

  router.get('/purchases/dashboard', requirePermission('purchases.read'), c =>
    handle(c, async () => ({ data: await workflow.dashboard(companyOf(c), actorId(c)) })))

  router.get('/purchases/suppliers', requirePermission('purchases.supplier.read'), c =>
    handle(c, () => suppliers.list(companyOf(c), c.req.query())))

  router.get('/purchases/suppliers/:contactId', requirePermission('purchases.supplier.read'), c =>
    handle(c, async () => ({ data: await suppliers.get(companyOf(c), c.req.param('contactId')) })))

  router.put('/purchases/suppliers/:contactId/profile', requirePermission('purchases.supplier.manage'), c =>
    handle(c, async () => ({ data: await suppliers.updateProfile(companyOf(c), actorId(c), c.req.param('contactId'), await body(c)) })))

  return router
}
