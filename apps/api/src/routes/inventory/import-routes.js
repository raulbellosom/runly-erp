// runly.inventory imports: catalogs (fixed columns) and items (user-mapped
// columns) — template download, parse/preview and commit.
import { Hono } from 'hono';
import { createInventoryCatalogImportService, parseCatalogFile } from '../../services/inventory-catalog-import-service.js';
import {
  createInventoryItemImportService, parseItemFile, suggestItemMapping,
} from '../../services/inventory-item-import-service.js';
import { tenantActiveContext } from '../../lib/active-context.js';

const MAX_BYTES = 5 * 1024 * 1024;
// Item files may carry embedded photos.
const MAX_ITEM_BYTES = 25 * 1024 * 1024;

export function createInventoryImportRouter({ prisma, requirePermission, InventoryServiceError, inventoryService, filesService }) {
  const router = new Hono();
  const imports = createInventoryCatalogImportService({ prisma });
  const itemImports = createInventoryItemImportService({ prisma, inventoryService });
  const fail = (c, err, fallback) => err instanceof InventoryServiceError
    ? c.json({ error: err.message }, err.status)
    : c.json({ error: fallback }, 500);
  const guard = requirePermission('inventory.catalog.manage');
  const itemGuard = requirePermission('inventory.item.create');

  // ── Items (column mapping) ───────────────────────────────────────────────
  // Parse returns the rows so the client can map and preview without
  // re-uploading; commit takes the file again because pictures placed in the
  // XLSX only travel with the file.
  async function readItemFile(c, form, options) {
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') throw new InventoryServiceError('Adjunta un archivo CSV o Excel.', 400);
    if (file.size > MAX_ITEM_BYTES) throw new InventoryServiceError('El archivo supera 25 MB.', 400);
    return parseItemFile(Buffer.from(await file.arrayBuffer()), file.name, options);
  }

  router.get('/inventory/item-import/template', itemGuard, async (c) => {
    try {
      const file = await itemImports.template();
      return c.body(file.buffer, 200, { 'Content-Type': file.contentType, 'Content-Disposition': `attachment; filename="${file.filename}"` });
    } catch (err) { return fail(c, err, 'No se pudo generar la plantilla.'); }
  });

  router.post('/inventory/item-import/parse', itemGuard, async (c) => {
    try {
      const form = await c.req.formData();
      const { headers, rows, rowNumbers, images } = await readItemFile(c, form);
      const { fields, customFields, statuses } = await itemImports.fields(c.get('companyId'));
      const imageCounts = rowNumbers.map((n) => images.get(n)?.length ?? 0);
      return c.json({ data: { headers, rows, rowNumbers, imageCounts, fields, statuses, mapping: suggestItemMapping(headers, customFields) } });
    } catch (err) { return fail(c, err, 'No se pudo leer el archivo.'); }
  });

  router.post('/inventory/item-import/preview', itemGuard, async (c) => {
    try {
      const { rows, rowNumbers, mapping, createMissing, statusMap } = await c.req.json();
      return c.json({ data: await itemImports.preview(rows, mapping, c.get('companyId'), { createMissing: createMissing === true, statusMap, rowNumbers }) });
    } catch (err) { return fail(c, err, 'No se pudo analizar el archivo.'); }
  });

  router.post('/inventory/item-import/commit', itemGuard, async (c) => {
    try {
      const form = await c.req.formData();
      const parsed = await readItemFile(c, form, { withImages: true });
      let options;
      try { options = JSON.parse(String(form.get('options') ?? '{}')); } catch { return c.json({ error: 'Opciones de importación no válidas.' }, 400); }
      const companyId = c.get('companyId');
      const authUserId = c.get('authUserId');
      const activeContext = tenantActiveContext(c);
      const attachImage = filesService ? async (itemId, image) => {
        const asset = await filesService.upload({
          authUserId,
          activeContext,
          file: new File([image.buffer], image.name, { type: image.type }),
          fields: { moduleKey: 'runly.inventory', entityType: 'InvItem', entityId: itemId },
        });
        await inventoryService.addItemFile(itemId, asset.id, companyId, null);
      } : null;
      const result = await itemImports.commit(parsed, options.mapping, companyId, authUserId, {
        createMissing: options.createMissing === true, statusMap: options.statusMap, attachImage,
      });
      return c.json({ data: result });
    } catch (err) { return fail(c, err, 'No se pudo importar.'); }
  });

  // ── Catalogs (fixed columns) ─────────────────────────────────────────────

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
