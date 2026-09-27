// apps/api/src/routes/catalog/products-routes.js
import { Hono } from 'hono'
import { createProductSchema, updateProductSchema } from './validators.js'
import {
  publishActivityFromContext,
  getActivityContext,
} from '../../services/activity-publisher.js'

export function createProductsRouter({ productSvc, prisma, requirePermission }) {
  const app = new Hono()

  app.get('/catalog/products', requirePermission('catalog.products.read'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const { categoryId, type, published, stockStatus, search, page, pageSize, limit, offset } = c.req.query()
      // RunlyTable (packages/ui) always sends page/pageSize; limit/offset are
      // kept as a fallback for direct API callers.
      const safePageSize = Math.min(Math.max(Number.parseInt(pageSize ?? limit, 10) || 50, 1), 500)
      const safeOffset = page !== undefined
        ? (Math.max(Number.parseInt(page, 10) || 1, 1) - 1) * safePageSize
        : (offset ? Number(offset) : 0)
      const result = await productSvc.listProducts({
        companyId,
        categoryId:  categoryId  || undefined,
        type:        type        || undefined,
        published:   published   !== undefined ? published === 'true' : undefined,
        stockStatus: stockStatus || undefined,
        search:      search      || undefined,
        limit:       safePageSize,
        offset:      safeOffset,
      })
      return c.json({
        data: result.data,
        pagination: {
          page: Math.floor(safeOffset / safePageSize) + 1,
          pageSize: safePageSize,
          total: result.total,
        },
      })
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      console.error('[GET /catalog/products]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.get('/catalog/products/stats', requirePermission('catalog.products.read'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const stats = await productSvc.getProductStats({ companyId })
      return c.json({ data: stats })
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      console.error('[GET /catalog/products/stats]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.get('/catalog/products/:id', requirePermission('catalog.products.read'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const row = await productSvc.getFullProductById({ companyId, id: c.req.param('id') })
      if (!row) return c.json({ error: 'Not found' }, 404)
      return c.json({ data: row })
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      console.error('[GET /catalog/products/:id]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.post('/catalog/products', requirePermission('catalog.products.create'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const parsed = createProductSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: parsed.error.errors[0]?.message }, 400)
      const row = await productSvc.createProduct({ companyId, data: parsed.data })
      const { actorName } = getActivityContext(c)
      await publishActivityFromContext(prisma, c, {
        type: 'catalog.product.create',
        severity: 'success',
        entityType: 'CatalogProduct',
        entityId: row.id,
        summary: `${actorName} creó el producto "${row.name}"`,
        link: `/m/runly.catalog/${row.id}`,
      })
      return c.json({ data: row }, 201)
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      if (err?.code === '23505') return c.json({ error: 'El slug ya existe' }, 409)
      console.error('[POST /catalog/products]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.patch('/catalog/products/:id', requirePermission('catalog.products.update'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const parsed = updateProductSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: parsed.error.errors[0]?.message }, 400)
      const row = await productSvc.updateProduct({ companyId, id: c.req.param('id'), data: parsed.data })
      if (!row) return c.json({ error: 'Not found' }, 404)
      const { actorName } = getActivityContext(c)
      await publishActivityFromContext(prisma, c, {
        type: 'catalog.product.update',
        severity: 'info',
        entityType: 'CatalogProduct',
        entityId: row.id,
        summary: `${actorName} actualizó el producto "${row.name}"`,
        link: `/m/runly.catalog/${row.id}`,
      })
      return c.json({ data: row })
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      if (err?.code === '23505') return c.json({ error: 'El slug ya existe' }, 409)
      console.error('[PATCH /catalog/products/:id]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.post('/catalog/products/:id/publish', requirePermission('catalog.products.update'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const row = await productSvc.publishProduct({ companyId, id: c.req.param('id'), published: true })
      if (!row) return c.json({ error: 'Not found' }, 404)
      const { actorName } = getActivityContext(c)
      await publishActivityFromContext(prisma, c, {
        type: 'catalog.product.publish',
        severity: 'success',
        entityType: 'CatalogProduct',
        entityId: row.id,
        summary: `${actorName} publicó el producto "${row.name}"`,
        link: `/m/runly.catalog/${row.id}`,
      })
      return c.json({ data: row })
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      console.error('[POST /catalog/products/:id/publish]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.post('/catalog/products/:id/unpublish', requirePermission('catalog.products.update'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const row = await productSvc.publishProduct({ companyId, id: c.req.param('id'), published: false })
      if (!row) return c.json({ error: 'Not found' }, 404)
      const { actorName } = getActivityContext(c)
      await publishActivityFromContext(prisma, c, {
        type: 'catalog.product.unpublish',
        severity: 'warning',
        entityType: 'CatalogProduct',
        entityId: row.id,
        summary: `${actorName} despublicó el producto "${row.name}"`,
        link: `/m/runly.catalog/${row.id}`,
      })
      return c.json({ data: row })
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      console.error('[POST /catalog/products/:id/unpublish]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  app.delete('/catalog/products/:id', requirePermission('catalog.products.delete'), async (c) => {
    try {
      const companyId = c.get('companyId')
      const existing = await productSvc.getProductById({ companyId, id: c.req.param('id') })
      await productSvc.deleteProduct({ companyId, id: c.req.param('id') })
      const { actorName } = getActivityContext(c)
      await publishActivityFromContext(prisma, c, {
        type: 'catalog.product.delete',
        severity: 'warning',
        entityType: 'CatalogProduct',
        entityId: c.req.param('id'),
        summary: `${actorName} eliminó el producto "${existing?.name ?? c.req.param('id')}"`,
      })
      return c.json({ ok: true })
    } catch (err) {
      if (err?.status && err.status < 500) return c.json({ error: err.message }, err.status)
      console.error('[DELETE /catalog/products/:id]', err?.message)
      return c.json({ error: 'Internal error' }, 500)
    }
  })

  return app
}
