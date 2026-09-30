// inventory-item-import-service.js — CSV/XLSX import of inventory items with
// user-defined column mapping (file header -> item field). No AI involved.
// - Rows whose asset tag or serial number already exists are skipped, never
//   updated.
// - Missing types, brands, locations and models can be created on the fly
//   (models need their type and brand).
// - Custom fields are mappable (`custom:<fieldId>`), one column each.
// - Unknown status spellings are resolved by a user-supplied `statusMap`.
// - Photos come from pictures placed over the row in the XLSX and/or from a
//   column of image links, downloaded server-side.
// Items are created through inventoryService.createItem so asset tags, audit
// and activity behave exactly like a manual create.
import { InventoryServiceError, assertCompany } from './inventory-guards.js';
import {
  MAX_IMAGES_PER_ROW, MAX_ITEM_IMPORT_ROWS, clean, key, normalizeHeader, parseImportDate, parseImportPrice,
} from './inventory-import-file.js';
import { fetchRemoteImage, splitImageUrls } from './inventory-import-remote-image.js';

export { MAX_ITEM_IMPORT_ROWS, parseImportDate, parseImportPrice, parseItemFile, normalizeHeader } from './inventory-import-file.js';

// `aliases` are normalized header spellings used to pre-fill the mapping.
export const ITEM_IMPORT_FIELDS = [
  { key: 'name', label: 'Nombre', group: 'Identificación', aliases: ['nombre', 'name', 'equipo', 'activo', 'articulo', 'descripcion_corta'] },
  { key: 'assetTag', label: 'Etiqueta de activo', group: 'Identificación', aliases: ['etiqueta', 'etiqueta_de_activo', 'tag', 'asset_tag', 'codigo', 'codigo_de_activo', 'folio', 'no_inventario', 'numero_de_inventario'] },
  { key: 'serialNumber', label: 'Número de serie', group: 'Identificación', aliases: ['serie', 'numero_de_serie', 'no_serie', 'no_de_serie', 'serial', 'serial_number', 's/n', 'sn'] },
  { key: 'partNumber', label: 'Número de parte', group: 'Identificación', aliases: ['numero_de_parte', 'no_parte', 'part_number', 'pn', 'sku'] },
  { key: 'type', label: 'Tipo', group: 'Modelo, tipo y marca', aliases: ['tipo', 'categoria', 'type', 'category', 'clase'] },
  { key: 'brand', label: 'Marca', group: 'Modelo, tipo y marca', aliases: ['marca', 'brand', 'fabricante', 'manufacturer'] },
  { key: 'model', label: 'Modelo', group: 'Modelo, tipo y marca', aliases: ['modelo', 'model'] },
  { key: 'location', label: 'Ubicación', group: 'Ubicación y estado', aliases: ['ubicacion', 'location', 'sucursal', 'area', 'sitio'] },
  { key: 'status', label: 'Estado', group: 'Ubicación y estado', aliases: ['estado', 'estatus', 'status'] },
  { key: 'purchaseDate', label: 'Fecha de compra', group: 'Compra y garantía', aliases: ['fecha_de_compra', 'compra', 'fecha_compra', 'purchase_date', 'fecha_adquisicion'] },
  { key: 'purchasePrice', label: 'Precio de compra', group: 'Compra y garantía', aliases: ['precio', 'precio_de_compra', 'costo', 'valor', 'price', 'importe'] },
  { key: 'vendorName', label: 'Proveedor', group: 'Compra y garantía', aliases: ['proveedor', 'vendor', 'supplier'] },
  { key: 'invoiceNumber', label: 'Número de factura', group: 'Compra y garantía', aliases: ['factura', 'numero_de_factura', 'no_factura', 'invoice'] },
  { key: 'warrantyExpiry', label: 'Vencimiento de garantía', group: 'Compra y garantía', aliases: ['garantia', 'vencimiento_de_garantia', 'fin_de_garantia', 'warranty', 'warranty_expiry'] },
  { key: 'description', label: 'Descripción', group: 'Notas y fotos', aliases: ['descripcion', 'description', 'detalle'] },
  { key: 'notes', label: 'Notas', group: 'Notas y fotos', aliases: ['notas', 'observaciones', 'comentarios', 'notes'] },
  { key: 'imageUrl', label: 'Fotos (enlaces)', group: 'Notas y fotos', aliases: ['foto', 'fotos', 'imagen', 'imagenes', 'image', 'images', 'url_foto', 'url_imagen', 'link_foto'] },
];
const BASE_KEYS = new Set(ITEM_IMPORT_FIELDS.map((f) => f.key));

export const IMPORT_STATUSES = [
  { value: 'available', label: 'Disponible' },
  { value: 'maintenance', label: 'Mantenimiento' },
  { value: 'retired', label: 'Retirado' },
  { value: 'lost', label: 'Perdido' },
  { value: 'stolen', label: 'Robado' },
  { value: 'disposed', label: 'Desechado' },
];
const IMPORTABLE_STATUS = new Set(IMPORT_STATUSES.map((s) => s.value));
// Status column accepts the internal value or the Spanish label. "Asignado"
// is not importable: an assignment needs a collaborator and its history.
const STATUS_BY_KEY = new Map([
  ...IMPORT_STATUSES.flatMap((s) => [[s.value, s.value], [normalizeHeader(s.label), s.value]]),
  ['en_mantenimiento', 'maintenance'], ['baja', 'retired'], ['dado_de_baja', 'retired'],
]);
const TRUE_WORDS = new Set(['si', 'sí', 'yes', 'true', '1', 'x', 'verdadero']);
const FALSE_WORDS = new Set(['no', 'false', '0', 'falso']);

function optionList(options) {
  const list = Array.isArray(options) ? options : Array.isArray(options?.options) ? options.options : [];
  return list.map((o) => (typeof o === 'object' && o !== null ? { value: String(o.value ?? o.label), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) }));
}

// Normalizes a custom-field cell to the string the item form would store;
// returns { value } or { error }.
function customValue(field, raw) {
  const str = clean(raw);
  if (field.fieldType === 'number') {
    const n = Number(str.replace(/,/g, ''));
    return Number.isFinite(n) ? { value: String(n) } : { error: `«${field.label}» debe ser un número.` };
  }
  if (field.fieldType === 'date') {
    const iso = parseImportDate(str);
    return iso ? { value: iso } : { error: `«${field.label}» no es una fecha válida.` };
  }
  if (field.fieldType === 'boolean') {
    const k = key(str);
    if (TRUE_WORDS.has(k)) return { value: 'true' };
    if (FALSE_WORDS.has(k)) return { value: 'false' };
    return { error: `«${field.label}» debe ser Sí o No.` };
  }
  if (field.fieldType === 'select') {
    const options = optionList(field.options);
    const hit = options.find((o) => key(o.value) === key(str) || key(o.label) === key(str));
    return hit ? { value: hit.value } : { error: `«${str}» no es una opción de «${field.label}».` };
  }
  return { value: str };
}

// Pre-fills { fieldKey: header } from header spellings; each header used once.
export function suggestItemMapping(headers, customFields = []) {
  const byNormalized = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const used = new Set();
  const mapping = {};
  const candidates = [
    ...ITEM_IMPORT_FIELDS.map((f) => ({ key: f.key, aliases: [f.key.toLowerCase(), ...f.aliases] })),
    ...customFields.map((f) => ({ key: `custom:${f.id}`, aliases: [normalizeHeader(f.label), normalizeHeader(f.fieldKey)] })),
  ];
  for (const field of candidates) {
    const hit = field.aliases.map((alias) => byNormalized.get(alias)).find((h) => h && !used.has(h));
    if (hit) { mapping[field.key] = hit; used.add(hit); }
  }
  return mapping;
}

export function createInventoryItemImportService({ prisma, inventoryService, fetchImage = fetchRemoteImage }) {
  async function loadCustomFields(companyId) {
    const rows = await prisma.invCustomField.findMany({
      where: { companyId, enabled: true },
      select: { id: true, label: true, fieldKey: true, fieldType: true, options: true, categoryId: true, category: { select: { name: true } } },
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
    return rows.map((f) => ({ ...f, typeName: f.category?.name ?? null }));
  }

  // Mappable fields for the UI: base fields plus the company's custom fields.
  async function fields(companyId) {
    assertCompany(companyId);
    const custom = await loadCustomFields(companyId);
    return {
      fields: [
        ...ITEM_IMPORT_FIELDS.map(({ key: k, label, group }) => ({ key: k, label, group })),
        ...custom.map((f) => ({ key: `custom:${f.id}`, label: f.label, group: 'Campos personalizados', hint: f.typeName ? `Solo tipo ${f.typeName}` : null })),
      ],
      customFields: custom,
      statuses: IMPORT_STATUSES,
    };
  }

  async function loadContext(companyId) {
    const [types, brands, locations, models, existing, customFields] = await Promise.all([
      prisma.invCategory.findMany({ where: { companyId }, select: { id: true, name: true } }),
      prisma.invBrand.findMany({ where: { companyId }, select: { id: true, name: true } }),
      prisma.invLocation.findMany({ where: { companyId }, select: { id: true, name: true } }),
      prisma.invModel.findMany({ where: { companyId, enabled: true }, select: { id: true, brandId: true, typeId: true, nameKey: true } }),
      prisma.invItem.findMany({ where: { companyId, enabled: true }, select: { assetTag: true, serialNumber: true } }),
      loadCustomFields(companyId),
    ]);
    const byName = (rows) => new Map(rows.map((row) => [key(row.name), row.id]));
    return {
      types: byName(types), brands: byName(brands), locations: byName(locations), models,
      customFields: new Map(customFields.map((f) => [f.id, f])),
      tags: new Set(existing.map((i) => key(i.assetTag)).filter(Boolean)),
      serials: new Set(existing.map((i) => key(i.serialNumber)).filter(Boolean)),
    };
  }

  function assertInput(rows, mapping, ctx) {
    if (!Array.isArray(rows)) throw new InventoryServiceError('No se recibieron filas.', 400);
    if (rows.length > MAX_ITEM_IMPORT_ROWS) throw new InventoryServiceError('El archivo supera el límite de 2,000 filas.', 400);
    if (!mapping || typeof mapping !== 'object') throw new InventoryServiceError('Falta el mapeo de columnas.', 400);
    if (!mapping.name && !mapping.model) throw new InventoryServiceError('Relaciona la columna del nombre o la del modelo.', 400);
    for (const field of Object.keys(mapping)) {
      const custom = field.startsWith('custom:') ? field.slice(7) : null;
      if (custom ? !ctx.customFields.has(custom) : !BASE_KEYS.has(field)) throw new InventoryServiceError(`Campo desconocido: ${field}.`, 400);
    }
  }

  function mapRow(raw, mapping) {
    const out = {};
    for (const [field, header] of Object.entries(mapping)) if (header) out[field] = clean(raw?.[header]);
    return out;
  }

  function analyze(d, ctx, seen, { createMissing, statusMap }) {
    const errors = [];
    const notes = [];
    const missing = {};
    const unknownStatus = [];

    const name = d.name || [d.brand, d.model].filter(Boolean).join(' ') || d.type || '';
    if (!name) errors.push('Sin nombre: la fila no tiene Nombre ni Modelo.');
    else if (name.length > 255) errors.push('El nombre admite hasta 255 caracteres.');
    else if (!d.name) notes.push(`Nombre tomado de marca y modelo: «${name}».`);

    let status = 'available';
    if (d.status) {
      const normalized = normalizeHeader(d.status);
      const chosen = statusMap?.[normalized];
      if (chosen && IMPORTABLE_STATUS.has(chosen)) status = chosen;
      else if (STATUS_BY_KEY.has(normalized)) status = STATUS_BY_KEY.get(normalized);
      else {
        // "Asignado" needs a collaborator, so it is resolved like any unknown
        // spelling: the user picks the status it should import as.
        errors.push(`Estado «${d.status}» sin equivalencia.`);
        unknownStatus.push(d.status);
      }
    }
    const purchaseDate = d.purchaseDate ? parseImportDate(d.purchaseDate) : null;
    if (d.purchaseDate && !purchaseDate) errors.push(`Fecha de compra «${d.purchaseDate}» no válida (usa AAAA-MM-DD o DD/MM/AAAA).`);
    const warrantyExpiry = d.warrantyExpiry ? parseImportDate(d.warrantyExpiry) : null;
    if (d.warrantyExpiry && !warrantyExpiry) errors.push(`Vencimiento de garantía «${d.warrantyExpiry}» no válido.`);
    const purchasePrice = d.purchasePrice ? parseImportPrice(d.purchasePrice) : null;
    if (Number.isNaN(purchasePrice)) errors.push(`Precio «${d.purchasePrice}» no válido.`);

    for (const [field, map] of [['type', ctx.types], ['brand', ctx.brands], ['location', ctx.locations]]) {
      if (d[field] && !map.has(key(d[field]))) missing[field] = d[field];
    }
    // A model joins the catalog only with its type and brand; an existing
    // model also supplies the type when the file has none.
    if (d.model) {
      const brandId = ctx.brands.get(key(d.brand));
      const existing = brandId ? ctx.models.find((m) => m.brandId === brandId && m.nameKey === key(d.model)) : null;
      if (!existing && d.brand && d.type) missing.model = `${d.model} (${d.brand})`;
      else if (!existing) notes.push('El modelo se guarda como texto; agrega Tipo y Marca para crearlo en el catálogo.');
    }

    const customValues = [];
    for (const [field, raw] of Object.entries(d)) {
      if (!field.startsWith('custom:') || !raw) continue;
      const def = ctx.customFields.get(field.slice(7));
      if (def.categoryId && def.typeName && d.type && key(def.typeName) !== key(d.type)) {
        notes.push(`«${def.label}» solo aplica al tipo ${def.typeName}; se omite.`);
        continue;
      }
      const result = customValue(def, raw);
      if (result.error) errors.push(result.error);
      else customValues.push({ fieldId: def.id, value: result.value });
    }

    const photoUrls = splitImageUrls(d.imageUrl).slice(0, MAX_IMAGES_PER_ROW);
    if (d.imageUrl && !photoUrls.length) notes.push('La columna de fotos no tiene enlaces http(s); se omite.');

    const tag = key(d.assetTag);
    const serial = key(d.serialNumber);
    if (tag && seen.tags.has(tag)) errors.push(`Etiqueta repetida en el archivo (fila ${seen.tags.get(tag)}).`);
    if (serial && seen.serials.has(serial)) errors.push(`Serie repetida en el archivo (fila ${seen.serials.get(serial)}).`);

    const data = { ...d, name, status, purchaseDate, warrantyExpiry, purchasePrice, customValues, photoUrls };
    const base = { data, missing, unknownStatus };
    if (errors.length) return { ...base, status: 'error', errors, notes };
    if ((tag && ctx.tags.has(tag)) || (serial && ctx.serials.has(serial))) {
      return { ...base, status: 'exists', errors: [], notes: [tag && ctx.tags.has(tag) ? `La etiqueta ${d.assetTag} ya existe.` : `La serie ${d.serialNumber} ya existe.`] };
    }
    if (Object.keys(missing).length && !createMissing) {
      return { ...base, status: 'error', errors: ['Falta en catálogos: activa «Crear lo que falta».'], notes };
    }
    return { ...base, status: 'new', errors: [], notes };
  }

  function run(rows, mapping, ctx, options, lineOf = (i) => i + 2) {
    const seen = { tags: new Map(), serials: new Map() };
    return rows.map((raw, index) => {
      const line = lineOf(index);
      const result = analyze(mapRow(raw, mapping), ctx, seen, options);
      if (result.status !== 'error') {
        if (result.data.assetTag) seen.tags.set(key(result.data.assetTag), line);
        if (result.data.serialNumber) seen.serials.set(key(result.data.serialNumber), line);
      }
      return { line, ...result };
    });
  }

  async function preview(rows, mapping, companyId, { createMissing = false, statusMap = {}, rowNumbers } = {}) {
    assertCompany(companyId);
    const ctx = await loadContext(companyId);
    assertInput(rows, mapping, ctx);
    const analyzed = run(rows, mapping, ctx, { createMissing, statusMap }, (i) => rowNumbers?.[i] ?? i + 2);
    const counts = { new: 0, exists: 0, error: 0 };
    for (const row of analyzed) counts[row.status] += 1;
    const unique = (values) => [...new Map(values.filter(Boolean).map((v) => [key(v), v])).values()];
    const pick = (field) => unique(analyzed.map((r) => r.missing?.[field]));
    return {
      rows: analyzed,
      counts,
      missing: { types: pick('type'), brands: pick('brand'), locations: pick('location'), models: pick('model') },
      unknownStatuses: unique(analyzed.flatMap((r) => r.unknownStatus)),
    };
  }

  // `file` = parseItemFile(..., { withImages: true }) output. `attachImage`
  // uploads one picture to the created item: (itemId, { buffer, type, name }).
  async function commit(file, mapping, companyId, authUserId, { createMissing = false, statusMap = {}, attachImage } = {}) {
    assertCompany(companyId);
    const ctx = await loadContext(companyId);
    assertInput(file.rows, mapping, ctx);
    const analyzed = run(file.rows, mapping, ctx, { createMissing, statusMap }, (i) => file.rowNumbers?.[i] ?? i + 2);
    const ensure = async (map, table, name) => {
      if (!name) return undefined;
      const existing = map.get(key(name));
      if (existing) return existing;
      const row = await prisma[table].create({ data: { companyId, name } });
      map.set(key(name), row.id);
      return row.id;
    };
    const ensureModel = async (name, typeId, brandId) => {
      if (!name || !brandId) return null;
      const existing = ctx.models.find((m) => m.brandId === brandId && m.nameKey === key(name));
      if (existing || !typeId) return existing ?? null;
      const row = await prisma.invModel.create({ data: { companyId, name, nameKey: key(name), typeId, brandId } });
      ctx.models.push(row);
      return row;
    };
    let created = 0;
    let photos = 0;
    const failures = [];
    const photoFailures = [];
    for (const row of analyzed) {
      if (row.status !== 'new') continue;
      const d = row.data;
      let item;
      try {
        const brandId = await ensure(ctx.brands, 'invBrand', d.brand);
        let categoryId = await ensure(ctx.types, 'invCategory', d.type);
        const model = await ensureModel(d.model, categoryId, brandId);
        categoryId = categoryId ?? model?.typeId ?? undefined;
        const locationId = await ensure(ctx.locations, 'invLocation', d.location);
        item = await inventoryService.createItem({
          name: d.name,
          assetTag: d.assetTag || undefined,
          serialNumber: d.serialNumber || undefined,
          partNumber: d.partNumber || undefined,
          model: d.model || undefined,
          modelId: model?.id,
          categoryId,
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
          customValues: d.customValues.length ? d.customValues : undefined,
        }, companyId, authUserId);
        created += 1;
      } catch (err) {
        failures.push({ line: row.line, message: err?.message ?? 'No se pudo crear.' });
        continue;
      }
      if (!attachImage) continue;
      const embedded = (file.images?.get(row.line) ?? []).filter(Boolean);
      const sources = [...embedded, ...d.photoUrls].slice(0, MAX_IMAGES_PER_ROW);
      for (const source of sources) {
        try {
          const image = typeof source === 'string' ? await fetchImage(source) : source;
          await attachImage(item.id, image);
          photos += 1;
        } catch (err) {
          photoFailures.push({ line: row.line, message: `${typeof source === 'string' ? source : 'Foto incrustada'}: ${err?.message ?? 'no se pudo adjuntar'}` });
        }
      }
    }
    return {
      created,
      photos,
      skipped: analyzed.filter((r) => r.status === 'exists').length,
      failed: analyzed.filter((r) => r.status === 'error').length + failures.length,
      failures,
      photoFailures: photoFailures.slice(0, 50),
    };
  }

  async function template() {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Activos');
    sheet.addRow(ITEM_IMPORT_FIELDS.map((f) => f.label)).font = { bold: true };
    ITEM_IMPORT_FIELDS.forEach((_, i) => { sheet.getColumn(i + 1).width = 22; });
    return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'plantilla-activos.xlsx' };
  }

  return { fields, preview, commit, template };
}
