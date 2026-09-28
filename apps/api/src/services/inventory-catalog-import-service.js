// inventory-catalog-import-service.js — fixed-column CSV/XLSX import for the
// inventory catalogs (types, brands, models, locations). Existing rows are
// skipped, never updated. Large imports with column mapping are out of scope.
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { InventoryServiceError, assertCompany } from './inventory-guards.js';

export const MAX_IMPORT_ROWS = 2000;
export const IMPORT_COLUMNS = {
  types: ['nombre', 'descripcion', 'tipo_padre', 'icono', 'color'],
  brands: ['nombre', 'descripcion', 'sitio_web'],
  models: ['nombre', 'tipo', 'marca', 'anio', 'descripcion'],
  locations: ['nombre', 'descripcion', 'direccion'],
};
const TABLE = { types: 'invCategory', brands: 'invBrand', models: 'invModel', locations: 'invLocation' };

const key = (value) => String(value ?? '').trim().toLocaleLowerCase('es');
const clean = (value) => String(value ?? '').trim();
// "Descripción" -> "descripcion", "Año" -> "ano" (accepted as anio).
function normalizeHeader(header) {
  const h = clean(header).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '_');
  return h === 'ano' ? 'anio' : h;
}
function normalizeRecord(record) {
  return Object.fromEntries(Object.entries(record).map(([header, value]) => [normalizeHeader(header), clean(value)]).filter(([header]) => header));
}

export async function parseCatalogFile(buffer, filename) {
  const lower = String(filename ?? '').toLowerCase();
  if (lower.endsWith('.csv')) {
    return parseCsv(buffer, { columns: true, skip_empty_lines: true, trim: true, bom: true }).map(normalizeRecord);
  }
  if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const headers = [];
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) { row.eachCell((cell, col) => { headers[col - 1] = cell.text; }); return; }
      const record = {};
      row.eachCell((cell, col) => { if (headers[col - 1]) record[headers[col - 1]] = cell.text; });
      rows.push(normalizeRecord(record));
    });
    return rows;
  }
  throw new InventoryServiceError('Formato no soportado. Usa un archivo CSV o Excel (.xlsx).', 400);
}

export function createInventoryCatalogImportService({ prisma }) {
  async function loadContext(db, companyId) {
    const [types, brands, locations, models] = await Promise.all([
      db.invCategory.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invBrand.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invLocation.findMany({ where: { companyId }, select: { id: true, name: true } }),
      db.invModel.findMany({ where: { companyId, enabled: true }, select: { id: true, brandId: true, nameKey: true, year: true } }),
    ]);
    const byName = (rows) => new Map(rows.map((row) => [key(row.name), row.id]));
    return { types: byName(types), brands: byName(brands), locations: byName(locations), models };
  }

  // Returns { status, data, message, missing } for one record. `ctx` is mutated
  // with the names this file will create so later rows can reference them.
  function analyze(catalog, record, ctx, seen, { createMissing }) {
    const name = clean(record.nombre);
    const errors = [];
    const missing = {};
    const maxName = catalog === 'models' ? 255 : 100;
    if (!name) errors.push('El nombre es obligatorio.');
    else if (name.length > maxName) errors.push(`El nombre admite hasta ${maxName} caracteres.`);
    const data = { ...record, nombre: name };

    let dedupeKey = key(name);
    if (catalog === 'types') {
      if (record.color && !/^#[0-9a-f]{6}$/i.test(record.color)) errors.push('El color debe ser #RRGGBB.');
      if (record.icono && record.icono.length > 50) errors.push('El ícono admite hasta 50 caracteres.');
      if (record.tipo_padre && !ctx.types.has(key(record.tipo_padre))) errors.push(`El tipo padre «${record.tipo_padre}» no existe.`);
    }
    if (catalog === 'models') {
      if (!clean(record.tipo)) errors.push('El tipo es obligatorio.');
      else if (!ctx.types.has(key(record.tipo))) missing.type = clean(record.tipo);
      if (!clean(record.marca)) errors.push('La marca es obligatoria.');
      else if (!ctx.brands.has(key(record.marca))) missing.brand = clean(record.marca);
      if (record.anio && !(/^\d{4}$/.test(record.anio) && Number(record.anio) >= 1900 && Number(record.anio) <= 2100)) errors.push('El año debe estar entre 1900 y 2100.');
      dedupeKey = `${key(record.marca)}|${key(name)}|${record.anio || ''}`;
    }

    if (errors.length === 0 && seen.has(dedupeKey)) errors.push(`Repetido en el archivo (fila ${seen.get(dedupeKey)}).`);
    const missingList = [missing.type && `el tipo «${missing.type}»`, missing.brand && `la marca «${missing.brand}»`].filter(Boolean);
    if (errors.length) return { status: 'error', data, message: [...errors, ...missingList.map((m) => `Falta ${m}.`)].join(' '), missing, missingOnly: false };

    let exists = false;
    if (catalog === 'models') {
      const brandId = ctx.brands.get(key(record.marca));
      const year = record.anio ? Number(record.anio) : null;
      exists = Boolean(brandId) && ctx.models.some((m) => m.brandId === brandId && m.nameKey === key(name) && (m.year ?? null) === year);
    } else {
      exists = ctx[catalog].has(key(name));
    }
    if (exists) return { status: 'exists', data, message: 'Ya existe; se omite.', missing, missingOnly: false };
    if (missingList.length && !createMissing) {
      return { status: 'error', data, message: `Falta ${missingList.join(' y ')}. Activa «Crear lo que falta» para crearlo.`, missing, missingOnly: true };
    }
    return { status: 'new', data, message: missingList.length ? `Se creará ${missingList.join(' y ')}.` : '', missing, missingOnly: false };
  }

  function assertInput(catalog, records) {
    if (!IMPORT_COLUMNS[catalog]) throw new InventoryServiceError('Catálogo no válido para importar.', 400);
    if (!Array.isArray(records)) throw new InventoryServiceError('No se recibieron filas.', 400);
    if (records.length > MAX_IMPORT_ROWS) throw new InventoryServiceError('El archivo supera el límite de 2,000 filas.', 400);
  }

  function run(catalog, records, ctx, options) {
    const seen = new Map();
    // A "new" type created by this file can be a later row's parent.
    const plannedTypes = new Set();
    return records.map((raw, index) => {
      const record = Object.fromEntries(Object.entries(raw ?? {}).map(([k, v]) => [k, clean(v)]));
      if (catalog === 'types' && record.tipo_padre && plannedTypes.has(key(record.tipo_padre))) ctx.types.set(key(record.tipo_padre), ctx.types.get(key(record.tipo_padre)) ?? '__planned__');
      const result = analyze(catalog, record, ctx, seen, options);
      const line = index + 2; // header is row 1
      if (result.status !== 'error') seen.set(catalog === 'models' ? `${key(record.marca)}|${key(record.nombre)}|${record.anio || ''}` : key(record.nombre), line);
      if (catalog === 'types' && result.status === 'new') plannedTypes.add(key(record.nombre));
      return { line, ...result };
    });
  }

  async function preview(catalog, records, companyId, { createMissing = false } = {}) {
    assertCompany(companyId);
    assertInput(catalog, records);
    const ctx = await loadContext(prisma, companyId);
    const rows = run(catalog, records, ctx, { createMissing });
    const counts = { new: 0, exists: 0, error: 0 };
    for (const row of rows) counts[row.status] += 1;
    const unique = (values) => [...new Map(values.filter(Boolean).map((v) => [key(v), v])).values()];
    return {
      rows,
      counts,
      missing: { types: unique(rows.map((r) => r.missing?.type)), brands: unique(rows.map((r) => r.missing?.brand)) },
    };
  }

  async function commit(catalog, records, companyId, { createMissing = false } = {}) {
    assertCompany(companyId);
    assertInput(catalog, records);
    return prisma.$transaction(async (tx) => {
      const ctx = await loadContext(tx, companyId);
      const rows = run(catalog, records, ctx, { createMissing });
      let created = 0;
      const ensure = async (map, table, name) => {
        const existing = map.get(key(name));
        if (existing && existing !== '__planned__') return existing;
        const row = await tx[table].create({ data: { companyId, name } });
        map.set(key(name), row.id);
        return row.id;
      };
      for (const row of rows) {
        if (row.status !== 'new') continue;
        const d = row.data;
        if (catalog === 'types') {
          const created_ = await tx.invCategory.create({ data: {
            companyId, name: d.nombre, description: d.descripcion || null, icon: d.icono || null, color: d.color || null,
            parentId: d.tipo_padre ? ctx.types.get(key(d.tipo_padre)) : null,
          } });
          ctx.types.set(key(d.nombre), created_.id);
        } else if (catalog === 'brands') {
          await tx.invBrand.create({ data: { companyId, name: d.nombre, description: d.descripcion || null, website: d.sitio_web || null } });
        } else if (catalog === 'locations') {
          await tx.invLocation.create({ data: { companyId, name: d.nombre, description: d.descripcion || null, address: d.direccion || null } });
        } else {
          const typeId = await ensure(ctx.types, 'invCategory', d.tipo);
          const brandId = await ensure(ctx.brands, 'invBrand', d.marca);
          await tx.invModel.create({ data: {
            companyId, name: d.nombre, nameKey: key(d.nombre), typeId, brandId,
            year: d.anio ? Number(d.anio) : null, description: d.descripcion || null,
          } });
        }
        created += 1;
      }
      return {
        created,
        skipped: rows.filter((r) => r.status === 'exists').length,
        failed: rows.filter((r) => r.status === 'error').length,
      };
    });
  }

  async function template(catalog, format) {
    const columns = IMPORT_COLUMNS[catalog];
    if (!columns) throw new InventoryServiceError('Catálogo no válido para importar.', 400);
    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Plantilla');
      sheet.addRow(columns).font = { bold: true };
      columns.forEach((_, i) => { sheet.getColumn(i + 1).width = 24; });
      return { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: `plantilla-${catalog}.xlsx` };
    }
    return { buffer: Buffer.from(`${columns.join(',')}\n`, 'utf8'), contentType: 'text/csv; charset=utf-8', filename: `plantilla-${catalog}.csv` };
  }

  return { preview, commit, template, TABLE };
}
