// runly.inventory models (InvModel) + GET /inventory/types (alias of the types
// catalog, kept for the AI assistant). Mounted by routes/inventory/index.js.
import { Hono } from 'hono';
import { createInventoryModelService } from '../../services/inventory-model-service.js';

export function createInventoryModelsRouter({ prisma, requirePermission, inventoryService, InventoryServiceError }) {
  const router = new Hono();
  const models = createInventoryModelService({ prisma });
  const fail = (c, err, fallback) => err instanceof InventoryServiceError
    ? c.json({ error: err.message }, err.status)
    : c.json({ error: fallback }, 500);

  router.get('/inventory/types', requirePermission('inventory.catalog.read'), async (c) => {
    try {
      const rows = await inventoryService.listCategories(c.get('companyId'));
      return c.json({ data: rows.map((row) => ({ ...row, value: row.id })) });
    } catch (err) { return fail(c, err, 'No se pudieron cargar los tipos.'); }
  });

  router.get('/inventory/models', requirePermission('inventory.catalog.read'), async (c) => {
    try {
      const { search, typeId, brandId } = c.req.query();
      return c.json({ data: await models.list({ companyId: c.get('companyId'), search, typeId, brandId }) });
    } catch (err) { return fail(c, err, 'No se pudieron cargar los modelos.'); }
  });

  router.post('/inventory/models', requirePermission('inventory.catalog.manage'), async (c) => {
    try {
      return c.json({ data: await models.create(await c.req.json(), c.get('companyId')) }, 201);
    } catch (err) { return fail(c, err, 'No se pudo crear el modelo.'); }
  });

  router.patch('/inventory/models/reorder', requirePermission('inventory.catalog.manage'), async (c) => {
    try {
      const { items } = await c.req.json();
      await inventoryService.reorderModels(c.get('companyId'), items);
      return c.json({ ok: true });
    } catch (err) { return fail(c, err, 'No se pudo guardar el orden.'); }
  });

  router.put('/inventory/models/:id', requirePermission('inventory.catalog.manage'), async (c) => {
    try {
      return c.json({ data: await models.update(c.req.param('id'), await c.req.json(), c.get('companyId')) });
    } catch (err) { return fail(c, err, 'No se pudo actualizar el modelo.'); }
  });

  router.delete('/inventory/models/:id', requirePermission('inventory.catalog.manage'), async (c) => {
    try {
      await models.remove(c.req.param('id'), c.get('companyId'));
      return c.json({ ok: true });
    } catch (err) { return fail(c, err, 'No se pudo eliminar el modelo.'); }
  });

  return router;
}
