// apps/api/src/routes/catalog/stock-routes.js
import { Hono } from 'hono'
import { createStockMovementSchema } from './validators.js'
import {
  publishActivityFromContext,
  getActivityContext,
} from '../../services/activity-publisher.js'

export function createStockRouter({ stockSvc, productSvc, prisma, requirePermission, requireAnyPermission }) {
  const app = new Hono()

  // Stock adjustment is its own granular grant; a role with full product-edit
  // rights keeps access for backward compatibility.
  const canAdjustStock =
    typeof requireAnyPermission === 'function'
      ? requireAnyPermission(['catalog.inventory.adjust', 'catalog.products.update'])
      : requirePermission('catalog.products.update')

  app.post('/catalog/products/:id/stock-movements', canAdjustStock, async (c) => {
    try {
      const companyId = c.get('companyId')
      const userId    = c.get('userId') ?? null
      const parsed = createStockMovementSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: parsed.error.errors[0]?.message }, 400)
      const data = await stockSvc.recordStockMovement({
        companyId,
        productId:     c.req.param('id'),
        variantId:     parsed.data.variant_id ?? null,
        quantityDelta: parsed.data.quantity_delta,
        reason:        parsed.data.reason,
        note:          parsed.data.note,
        userId,
      })
      const { actorName } = getActivityContext(c)
      const delta = parsed.data.quantity_delta
      const sign  = delta > 0 ? `+${delta}` : String(delta)
      await publishActivityFromContext(prisma, c, {
        type: 'catalog.stock.adjust',
        severity: delta > 0 ? 'success' : 'warning',
        entityType: 'CatalogProduct',
        entityId: c.req.param('id'),
        summary: `${actorName} ajustó stock ${sign} unidades${parsed.data.reason ? ` (${parsed.data.reason})` : ''}`,
        link: `/m/runly.catalog/${c.req.param('id')}`,
      })
      return c.json({ data }, 201)
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      console.error('[POST /catalog/products/:id/stock-movements]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.get('/catalog/products/:id/stock-movements', requirePermission('catalog.products.read'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const { variantId, limit, offset } = c.req.query()
      const result = await stockSvc.listStockMovements({
        companyId,
        productId:  c.req.param('id'),
        variantId:  variantId || undefined,
        limit:      limit  ? Number(limit)  : 50,
        offset:     offset ? Number(offset) : 0,
      })
      return c.json(result)
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      console.error('[GET /catalog/products/:id/stock-movements]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  // ── Export ────────────────────────────────────────────────────────────────

  app.get('/catalog/products/:id/stock-movements/export/xlsx', requirePermission('catalog.products.read'), async (c) => {
    try {
      const { buildStockMovementsExcelBuffer } = await import('./catalog-export-service.js')
      const { resolveCompanyBranding } = await import('../../services/pdf-branding-service.js')
      const companyId = c.get('companyId')
      const productId = c.req.param('id')
      const product = await productSvc.getProductById({ companyId, id: productId })
      if (!product) return c.json({ error: 'Not found' }, 404)
      const { data: rows } = await stockSvc.listStockMovements({ companyId, productId, limit: 5000, offset: 0 })
      const branding = await resolveCompanyBranding({ prisma, companyId }).catch(() => undefined)
      const buffer = await buildStockMovementsExcelBuffer({ product, rows, branding })
      c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      c.header('Content-Disposition', `attachment; filename="movimientos-${product.slug ?? productId}-${Date.now()}.xlsx"`)
      return new Response(buffer, { status: 200, headers: c.res.headers })
    } catch (err) {
      console.error('[GET /catalog/products/:id/stock-movements/export/xlsx]', err?.message)
      return c.json({ error: 'No se pudo exportar el archivo Excel.' }, 500)
    }
  })

  app.get('/catalog/products/:id/stock-movements/export/pdf', requirePermission('catalog.products.read'), async (c) => {
    try {
      const { buildStockMovementsPdfBuffer } = await import('./catalog-export-service.js')
      const { resolveCompanyBranding } = await import('../../services/pdf-branding-service.js')
      const companyId = c.get('companyId')
      const productId = c.req.param('id')
      const product = await productSvc.getProductById({ companyId, id: productId })
      if (!product) return c.json({ error: 'Not found' }, 404)
      const { data: rows } = await stockSvc.listStockMovements({ companyId, productId, limit: 5000, offset: 0 })
      const branding = await resolveCompanyBranding({ prisma, companyId }).catch(() => undefined)
      const buffer = await buildStockMovementsPdfBuffer({ product, rows, branding })
      c.header('Content-Type', 'application/pdf')
      c.header('Content-Disposition', `attachment; filename="movimientos-${product.slug ?? productId}-${Date.now()}.pdf"`)
      return new Response(buffer, { status: 200, headers: c.res.headers })
    } catch (err) {
      console.error('[GET /catalog/products/:id/stock-movements/export/pdf]', err?.message)
      return c.json({ error: 'No se pudo exportar el PDF.' }, 500)
    }
  })

  return app
}
