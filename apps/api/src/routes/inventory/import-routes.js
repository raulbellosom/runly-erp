// runly.inventory catalog import: template download, preview and commit.
import { Hono } from 'hono';
import { createInventoryCatalogImportService, parseCatalogFile } from '../../services/inventory-catalog-import-service.js';

const MAX_BYTES = 5 * 1024 * 1024;

export function createInventoryImportRouter({ prisma, requirePermission, InventoryServiceError }) {
  const router = new Hono();
  const imports = createInventoryCatalogImportService({ prisma });
  const fail = (c, err, fallback) => err instanceof InventoryServiceError
    ? c.json({ error: err.message }, err.status)
    : c.json({ error: fallback }, 500);
  const guard = requirePermission('inventory.catalog.manage');

  router.get('/inventory/import/:catalog/template', guard, async (c) => {
    try {
      const file = await imports.template(c.req.param('catalog'), c.req.query('format') === 'xlsx' ? 'xlsx' : 'csv');
      return c.body(file.buffer, 200, { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"` });
    } catch (err) { return fail(c, err, 'No se pudo generar la plantilla.'); }
  });

  router.post('/inventory/import/:catalog/preview', guard, async (c) => {
    try {
      const form = await c.req.formData();
      const file = form.get('file');
      if (!file || typeof file.arrayBuffer !== 'function') return c.json({ error: 'Adjunta un archivo CSV o Excel.' }, 400);
      if (file.size > MAX_BYTES) return c.json({ error: 'El archivo supera 5 MB.' }, 400);
      const records = await parseCatalogFile(Buffer.from(await file.arrayBuffer()), file.name);
      const createMissing = form.get('createMissing') === 'true';
      return c.json({ data: await imports.preview(c.req.param('catalog'), records, c.get('companyId'), { createMissing }) });
    } catch (err) { return fail(c, err, 'No se pudo leer el archivo.'); }
  });

  router.post('/inventory/import/:catalog/commit', guard, async (c) => {
    try {
      const { rows, createMissing } = await c.req.json();
      return c.json({ data: await imports.commit(c.req.param('catalog'), rows, c.get('companyId'), { createMissing: createMissing === true }) });
    } catch (err) { return fail(c, err, 'No se pudo importar.'); }
  });

  return router;
}
