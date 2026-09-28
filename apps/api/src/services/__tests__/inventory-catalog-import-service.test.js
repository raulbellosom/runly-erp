import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseCatalogFile, createInventoryCatalogImportService } from '../inventory-catalog-import-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';

function prismaWith({ categories = [], brands = [], locations = [], models = [] } = {}) {
  const created = [];
  const table = (rows, name) => ({
    findMany: async () => rows,
    create: async ({ data }) => { const row = { id: `${name}-${created.length + 1}`, ...data }; created.push({ table: name, data }); rows.push(row); return row; },
  });
  const prisma = {
    created,
    invCategory: table(categories, 'invCategory'),
    invBrand: table(brands, 'invBrand'),
    invLocation: table(locations, 'invLocation'),
    invModel: table(models, 'invModel'),
  };
  prisma.$transaction = async (fn) => fn(prisma);
  return prisma;
}

test('parseCatalogFile reads CSV with accented headers and XLSX', async () => {
  const csv = Buffer.from('Nombre,Descripción,Año\nXPS 15,Laptop,2023\n');
  assert.deepEqual(await parseCatalogFile(csv, 'modelos.csv'), [{ nombre: 'XPS 15', descripcion: 'Laptop', anio: '2023' }]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Marcas');
  sheet.addRow(['nombre', 'sitio_web']);
  sheet.addRow(['Dell', 'https://dell.example.com']);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  assert.deepEqual(await parseCatalogFile(xlsx, 'marcas.xlsx'), [{ nombre: 'Dell', sitio_web: 'https://dell.example.com' }]);

  await assert.rejects(parseCatalogFile(Buffer.from('x'), 'data.pdf'), /CSV o Excel/);
});

test('preview marks new, existing, repeated and invalid rows', async () => {
  const service = createInventoryCatalogImportService({ prisma: prismaWith({ brands: [{ id: 'b1', name: 'Dell' }] }) });
  const result = await service.preview('brands', [{ nombre: 'dell' }, { nombre: 'HP' }, { nombre: 'hp' }, { nombre: '' }], COMPANY);
  assert.deepEqual(result.rows.map((r) => r.status), ['exists', 'new', 'error', 'error']);
  assert.match(result.rows[2].message, /Repetido/);
  assert.deepEqual(result.counts, { new: 1, exists: 1, error: 2 });
});

test('models report missing types and brands and only create them when asked', async () => {
  const records = [{ nombre: 'XPS 15', tipo: 'Laptop', marca: 'Dell', anio: '2023' }, { nombre: 'Pixel', tipo: 'Celular', marca: 'Google', anio: '20x' }];
  const prisma = prismaWith({ categories: [{ id: 't1', name: 'Laptop' }] });
  const service = createInventoryCatalogImportService({ prisma });

  const preview = await service.preview('models', records, COMPANY);
  assert.deepEqual(preview.missing, { types: ['Celular'], brands: ['Dell', 'Google'] });
  assert.equal(preview.rows[0].status, 'error');
  assert.equal(preview.rows[0].missingOnly, true);
  assert.equal(preview.rows[1].missingOnly, false); // bad year too

  const withMissing = await service.preview('models', records, COMPANY, { createMissing: true });
  assert.deepEqual(withMissing.rows.map((r) => r.status), ['new', 'error']);

  const result = await service.commit('models', records, COMPANY, { createMissing: true });
  assert.deepEqual(result, { created: 1, skipped: 0, failed: 1 });
  assert.deepEqual(prisma.created.map((c) => c.table), ['invBrand', 'invModel']);
  assert.equal(prisma.created[1].data.year, 2023);
  assert.equal(prisma.created[1].data.nameKey, 'xps 15');
});

test('types resolve parents declared earlier in the same file', async () => {
  const prisma = prismaWith();
  const service = createInventoryCatalogImportService({ prisma });
  const result = await service.commit('types', [{ nombre: 'Cómputo' }, { nombre: 'Laptop gamer', tipo_padre: 'cómputo', icono: 'Laptop', color: '#112233' }], COMPANY);
  assert.deepEqual(result, { created: 2, skipped: 0, failed: 0 });
  assert.equal(prisma.created[1].data.parentId, 'invCategory-1');
});

test('rejects files above the row limit', async () => {
  const service = createInventoryCatalogImportService({ prisma: prismaWith() });
  await assert.rejects(service.preview('brands', Array.from({ length: 2001 }, (_, i) => ({ nombre: `M${i}` })), COMPANY), /2,000/);
});

test('template lists the catalog columns', async () => {
  const service = createInventoryCatalogImportService({ prisma: prismaWith() });
  const csv = await service.template('models', 'csv');
  assert.equal(csv.buffer.toString('utf8').split('\n')[0], 'nombre,tipo,marca,anio,descripcion');
  assert.equal(csv.contentType, 'text/csv; charset=utf-8');
});
