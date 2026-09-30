// inventory-item-import-service.js — CSV/XLSX import of inventory items with
// user-defined column mapping (file header -> item field). No AI involved.
// Rows whose asset tag or serial number already exists are skipped, never
// updated. Items are created through inventoryService.createItem so asset
// tags, audit and activity behave exactly like a manual create.
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { InventoryServiceError, assertCompany } from './inventory-guards.js';

export const MAX_ITEM_IMPORT_ROWS = 2000;

// `aliases` are normalized header spellings used to pre-fill the mapping.
export const ITEM_IMPORT_FIELDS = [
  { key: 'name', label: 'Nombre', required: true, aliases: ['nombre', 'name', 'equipo', 'activo', 'articulo', 'descripcion_corta'] },
  { key: 'assetTag', label: 'Etiqueta de activo', aliases: ['etiqueta', 'etiqueta_de_activo', 'tag', 'asset_tag', 'codigo', 'codigo_de_activo', 'folio', 'no_inventario', 'numero_de_inventario'] },
  { key: 'serialNumber', label: 'Número de serie', aliases: ['serie', 'numero_de_serie', 'no_serie', 'no_de_serie', 'serial', 'serial_number', 's/n', 'sn'] },
  { key: 'partNumber', label: 'Número de parte', aliases: ['numero_de_parte', 'no_parte', 'part_number', 'pn', 'sku'] },
  { key: 'type', label: 'Tipo', aliases: ['tipo', 'categoria', 'type', 'category', 'clase'] },
  { key: 'brand', label: 'Marca', aliases: ['marca', 'brand', 'fabricante', 'manufacturer'] },
  { key: 'model', label: 'Modelo', aliases: ['modelo', 'model'] },
  { key: 'location', label: 'Ubicación', aliases: ['ubicacion', 'location', 'sucursal', 'area', 'sitio'] },
  { key: 'status', label: 'Estado', aliases: ['estado', 'estatus', 'status'] },
  { key: 'purchaseDate', label: 'Fecha de compra', aliases: ['fecha_de_compra', 'compra', 'fecha_compra', 'purchase_date', 'fecha_adquisicion'] },
  { key: 'purchasePrice', label: 'Precio de compra', aliases: ['precio', 'precio_de_compra', 'costo', 'valor', 'price', 'importe'] },
  { key: 'vendorName', label: 'Proveedor', aliases: ['proveedor', 'vendor', 'supplier'] },
  { key: 'invoiceNumber', label: 'Número de factura', aliases: ['factura', 'numero_de_factura', 'no_factura', 'invoice'] },
  { key: 'warrantyExpiry', label: 'Vencimiento de garantía', aliases: ['garantia', 'vencimiento_de_garantia', 'fin_de_garantia', 'warranty', 'warranty_expiry'] },
  { key: 'description', label: 'Descripción', aliases: ['descripcion', 'description', 'detalle'] },
  { key: 'notes', label: 'Notas', aliases: ['notas', 'observaciones', 'comentarios', 'notes'] },
];
const FIELD_KEYS = new Set(ITEM_IMPORT_FIELDS.map((f) => f.key));

// Status column accepts the internal value or the Spanish label. "Asignado"
// is not importable: an assignment needs a collaborator and its history.
const STATUS_BY_KEY = new Map([
  ['available', 'available'], ['disponible', 'available'],
  ['maintenance', 'maintenance'], ['mantenimiento', 'maintenance'], ['en_mantenimiento', 'maintenance'],
  ['retired', 'retired'], ['retirado', 'retired'], ['baja', 'retired'],
  ['lost', 'lost'], ['perdido', 'lost'],
  ['stolen', 'stolen'], ['robado', 'stolen'],
  ['disposed', 'disposed'], ['desechado', 'disposed'],
]);

const clean = (value) => String(value ?? '').trim();
const key = (value) => clean(value).toLocaleLowerCase('es');
export function normalizeHeader(header) {
  return clean(header).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[.#°º]/g, '').replace(/\s+/g, '_');
}

function isoFromDate(date) {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${m}-${d}`;
}

// "2024-03-15", "15/03/2024", "15-03-24" -> "2024-03-15"; null when invalid.
export function parseImportDate(value) {
  const str = clean(value);
  if (!str) return null;
  let y; let m; let d;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(str);
  if (match) [, y, m, d] = match.map(Number);
  else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(str);
    if (!match) return null;
    [, d, m, y] = match.map(Number);
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return isoFromDate(date);
}

// "$1,299.50" -> 1299.5; null when empty/invalid.
export function parseImportPrice(value) {
  const str = clean(value).replace(/[$\s]|MXN|USD/gi, '').replace(/,/g, '');
  if (!str) return null;
  const n = Number(str);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

// Returns { headers, rows } keeping the file's own header text so the user
// can recognise the columns while mapping.
export async function parseItemFile(buffer, filename) {
  const lower = String(filename ?? '').toLowerCase();
  let headers = [];
  let rows = [];
  if (lower.endsWith('.csv')) {
    rows = parseCsv(buffer, { columns: (row) => { headers = row.map(clean); return headers; }, skip_empty_lines: true, trim: true, bom: true, relax_column_count: true });
  } else if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (sheet) {
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) { row.eachCell((cell, col) => { headers[col - 1] = clean(cell.text); }); return; }
        const record = {};
        row.eachCell((cell, col) => {
          const header = headers[col - 1];
          if (!header) return;
          record[header] = cell.value instanceof Date ? isoFromDate(cell.value) : clean(cell.text);
        });
        if (Object.values(record).some(Boolean)) rows.push(record);
      });
    }
  } else {
    throw new InventoryServiceError('Formato no soportado. Usa un archivo CSV o Excel (.xlsx).', 400);
  }
  headers = headers.filter(Boolean);
  if (!headers.length) throw new InventoryServiceError('El archivo no tiene encabezados en la primera fila.', 400);
  if (rows.length > MAX_ITEM_IMPORT_ROWS) throw new InventoryServiceError('El archivo supera el límite de 2,000 filas.', 400);
  return { headers, rows };
}

// Pre-fills { fieldKey: header } from header spellings; each header used once.
export function suggestItemMapping(headers) {
  const byNormalized = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const used = new Set();
  const mapping = {};
  for (const field of ITEM_IMPORT_FIELDS) {
    const hit = [field.key.toLowerCase(), ...field.aliases].map((alias) => byNormalized.get(alias)).find((h) => h && !used.has(h));
    if (hit) { mapping[field.key] = hit; used.add(hit); }
  }
  return mapping;
}

export function createInventoryItemImportService({ prisma, inventoryService }) {
  async function loadContext(db, companyId) {
    const [types, brands, locations, models, existing] = await Promise.all([
      db.invCategory.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invBrand.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invLocation.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invModel.findMany({ where: { companyId, enabled: true }, select: { id: true, brandId: true, typeId: true, nameKey: true } }),
      db.invItem.findMany({ where: { companyId, enabled: true }, select: { assetTag: true, serialNumber: true } }),
    ]);
    const byName = (rows) => new Map(rows.map((row) => [key(row.name), row.id]));
    return {
      types: byName(types), brands: byName(brands), locations: byName(locations), models,
      tags: new Set(existing.map((i) => key(i.assetTag)).filter(Boolean)),
      serials: new Set(existing.map((i) => key(i.serialNumber)).filter(Boolean)),
    };
  }

  function assertInput(rows, mapping) {
    if (!Array.isArray(rows)) throw new InventoryServiceError('No se recibieron filas.', 400);
    if (rows.length > MAX_ITEM_IMPORT_ROWS) throw new InventoryServiceError('El archivo supera el límite de 2,000 filas.', 400);
    if (!mapping || typeof mapping !== 'object') throw new InventoryServiceError('Falta el mapeo de columnas.', 400);
    if (!mapping.name) throw new InventoryServiceError('Relaciona la columna del nombre del activo.', 400);
    for (const field of Object.keys(mapping)) {
      if (!FIELD_KEYS.has(field)) throw new InventoryServiceError(`Campo desconocido: ${field}.`, 400);
    }
  }

  function mapRow(raw, mapping) {
    const out = {};
    for (const [field, header] of Object.entries(mapping)) if (header) out[field] = clean(raw?.[header]);
    return out;
  }

  function analyze(data, ctx, seen, { createMissing }) {
    const errors = [];
    const missing = {};
    if (!data.name) errors.push('El nombre es obligatorio.');
    else if (data.name.length > 255) errors.push('El nombre admite hasta 255 caracteres.');
    let status = 'available';
    if (data.status) {
      const normalized = normalizeHeader(data.status);
      if (normalized === 'assigned' || normalized === 'asignado') errors.push('El estado «Asignado» no se importa; asigna el equipo desde su ficha.');
      else if (STATUS_BY_KEY.has(normalized)) status = STATUS_BY_KEY.get(normalized);
      else errors.push(`Estado «${data.status}» no válido.`);
    }
    const purchaseDate = data.purchaseDate ? parseImportDate(data.purchaseDate) : null;
    if (data.purchaseDate && !purchaseDate) errors.push(`Fecha de compra «${data.purchaseDate}» no válida (usa AAAA-MM-DD o DD/MM/AAAA).`);
    const warrantyExpiry = data.warrantyExpiry ? parseImportDate(data.warrantyExpiry) : null;
    if (data.warrantyExpiry && !warrantyExpiry) errors.push(`Vencimiento de garantía «${data.warrantyExpiry}» no válido.`);
    const purchasePrice = data.purchasePrice ? parseImportPrice(data.purchasePrice) : null;
    if (Number.isNaN(purchasePrice)) errors.push(`Precio «${data.purchasePrice}» no válido.`);

    for (const [field, map, label] of [['type', ctx.types, 'el tipo'], ['brand', ctx.brands, 'la marca'], ['location', ctx.locations, 'la ubicación']]) {
      if (data[field] && !map.has(key(data[field]))) missing[field] = { value: data[field], label };
    }

    const tag = key(data.assetTag);
    const serial = key(data.serialNumber);
    if (tag && seen.tags.has(tag)) errors.push(`Etiqueta repetida en el archivo (fila ${seen.tags.get(tag)}).`);
    if (serial && seen.serials.has(serial)) errors.push(`Serie repetida en el archivo (fila ${seen.serials.get(serial)}).`);

    const normalized = { ...data, status, purchaseDate, warrantyExpiry, purchasePrice };
    const missingList = Object.values(missing).map((m) => `${m.label} «${m.value}»`);
    if (errors.length) return { status: 'error', data: normalized, message: errors.join(' '), missing };
    if ((tag && ctx.tags.has(tag)) || (serial && ctx.serials.has(serial))) {
      return { status: 'exists', data: normalized, message: tag && ctx.tags.has(tag) ? 'La etiqueta ya existe; se omite.' : 'La serie ya existe; se omite.', missing };
    }
    if (missingList.length && !createMissing) {
      return { status: 'error', data: normalized, message: `No existe ${missingList.join(', ')}. Activa «Crear lo que falta».`, missing };
    }
    return { status: 'new', data: normalized, message: missingList.length ? `Se creará ${missingList.join(', ')}.` : '', missing };
  }

  function run(rows, mapping, ctx, options) {
    const seen = { tags: new Map(), serials: new Map() };
    return rows.map((raw, index) => {
      const line = index + 2; // header is row 1
      const result = analyze(mapRow(raw, mapping), ctx, seen, options);
      if (result.status !== 'error') {
        if (result.data.assetTag) seen.tags.set(key(result.data.assetTag), line);
        if (result.data.serialNumber) seen.serials.set(key(result.data.serialNumber), line);
      }
      return { line, ...result };
    });
  }

  async function preview(rows, mapping, companyId, { createMissing = false } = {}) {
    assertCompany(companyId);
    assertInput(rows, mapping);
    const ctx = await loadContext(prisma, companyId);
    const analyzed = run(rows, mapping, ctx, { createMissing });
    const counts = { new: 0, exists: 0, error: 0 };
    for (const row of analyzed) counts[row.status] += 1;
    const unique = (field) => [...new Map(analyzed.map((r) => r.missing?.[field]?.value).filter(Boolean).map((v) => [key(v), v])).values()];
    return { rows: analyzed, counts, missing: { types: unique('type'), brands: unique('brand'), locations: unique('location') } };
  }

  async function commit(rows, mapping, companyId, authUserId, { createMissing = false } = {}) {
    assertCompany(companyId);
    assertInput(rows, mapping);
    const ctx = await loadContext(prisma, companyId);
    const analyzed = run(rows, mapping, ctx, { createMissing });
    const ensure = async (map, table, name) => {
      if (!name) return undefined;
      const existing = map.get(key(name));
      if (existing) return existing;
      const row = await prisma[table].create({ data: { companyId, name } });
      map.set(key(name), row.id);
      return row.id;
    };
    let created = 0;
    const failures = [];
    for (const row of analyzed) {
      if (row.status !== 'new') continue;
      const d = row.data;
      try {
        const categoryId = await ensure(ctx.types, 'invCategory', d.type);
        const brandId = await ensure(ctx.brands, 'invBrand', d.brand);
        const locationId = await ensure(ctx.locations, 'invLocation', d.location);
        const model = d.model ? ctx.models.find((m) => m.brandId === brandId && m.nameKey === key(d.model)) : null;
        await inventoryService.createItem({
          name: d.name,
          assetTag: d.assetTag || undefined,
          serialNumber: d.serialNumber || undefined,
          partNumber: d.partNumber || undefined,
          model: d.model || undefined,
          modelId: model?.id,
          categoryId: categoryId ?? model?.typeId ?? undefined,
          brandId,
          locationId,
          status: d.status,
          purchaseDate: d.purchaseDate || undefined,
          purchasePrice: d.purchasePrice ?? undefined,
          vendorName: d.vendorName || undefined,
          invoiceNumber: d.invoiceNumber || undefined,
          warrantyExpiry: d.warrantyExpiry || undefined,
          description: d.description || undefined,
          notes: d.notes || undefined,
        }, companyId, authUserId);
        created += 1;
      } catch (err) {
        failures.push({ line: row.line, message: err?.message ?? 'No se pudo crear.' });
      }
    }
    return {
      created,
      skipped: analyzed.filter((r) => r.status === 'exists').length,
      failed: analyzed.filter((r) => r.status === 'error').length + failures.length,
      failures,
    };
  }

  async function template() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Activos');
    sheet.addRow(ITEM_IMPORT_FIELDS.map((f) => f.label)).font = { bold: true };
    ITEM_IMPORT_FIELDS.forEach((_, i) => { sheet.getColumn(i + 1).width = 22; });
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'plantilla-activos.xlsx' };
  }

  return { preview, commit, template };
}
