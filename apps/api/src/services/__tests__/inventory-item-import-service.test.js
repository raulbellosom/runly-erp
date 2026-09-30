import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {
  createInventoryItemImportService, parseImportDate, parseImportPrice, parseItemFile, suggestItemMapping,
} from '../inventory-item-import-service.js';
import { isPrivateAddress, splitImageUrls } from '../inventory-import-remote-image.js';
import { itemOrderBy } from '../inventory-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function fakePrisma({ items = [], types = [], brands = [], models = [], customFields = [] } = {}) {
  const created = [];
  const make = (table) => ({ findMany: async () => ({ invCategory: types, invBrand: brands, invModel: models })[table] ?? [], create: async ({ data }) => { const row = { id: `${table}-${created.length}`, ...data }; created.push([table, row]); return row; } });
  return {
    created,
    invCategory: make('invCategory'),
    invBrand: make('invBrand'),
    invLocation: make('invLocation'),
    invCondition: make('invCondition'),
    invModel: make('invModel'),
    invItem: { findMany: async () => items },
    invCustomField: { findMany: async () => customFields },
  };
}

test('parseImportDate accepts ISO and day-first dates, rejects impossible ones', () => {
  assert.equal(parseImportDate('2024-03-15'), '2024-03-15');
  assert.equal(parseImportDate('15/03/2024'), '2024-03-15');
  assert.equal(parseImportDate('5-3-24'), '2024-03-05');
  assert.equal(parseImportDate('31/02/2024'), null);
});

test('parseImportPrice strips currency formatting', () => {
  assert.equal(parseImportPrice('$1,299.50'), 1299.5);
  assert.equal(parseImportPrice(''), null);
  assert.ok(Number.isNaN(parseImportPrice('mil')));
});

test('suggestItemMapping matches base and custom field headers once each', () => {
  const mapping = suggestItemMapping(['Nombre', 'No. Serie', 'Marca', 'Categoría', 'RAM', 'Otra'], [{ id: 'f1', label: 'RAM', fieldKey: 'ram' }]);
  assert.deepEqual(mapping, { name: 'Nombre', serialNumber: 'No. Serie', brand: 'Marca', type: 'Categoría', 'custom:f1': 'RAM' });
});

test('parseItemFile keeps original CSV headers and sheet rows', async () => {
  const { headers, rows, rowNumbers } = await parseItemFile(Buffer.from('Nombre,No. Serie\nLaptop,ABC\n'), 'a.csv');
  assert.deepEqual(headers, ['Nombre', 'No. Serie']);
  assert.deepEqual(rows, [{ Nombre: 'Laptop', 'No. Serie': 'ABC' }]);
  assert.deepEqual(rowNumbers, [2]);
});

test('parseItemFile maps pictures placed over an XLSX row to that row', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('a');
  sheet.addRow(['Nombre', 'Foto']);
  sheet.addRow(['Laptop', '']);
  sheet.addImage(wb.addImage({ buffer: PNG, extension: 'png' }), { tl: { col: 1, row: 1 }, ext: { width: 20, height: 20 } });
  const parsed = await parseItemFile(Buffer.from(await wb.xlsx.writeBuffer()), 'a.xlsx', { withImages: true });
  assert.equal(parsed.images.get(2).length, 1);
  assert.equal(parsed.images.get(2)[0].type, 'image/png');
});

test('preview flags existing serials, file duplicates, missing catalogs and unknown status', async () => {
  const service = createInventoryItemImportService({
    prisma: fakePrisma({ items: [{ assetTag: 'INV-1', serialNumber: 'OLD' }], brands: [{ id: 'b1', name: 'Dell' }] }),
    inventoryService: {},
  });
  const mapping = { name: 'n', serialNumber: 's', brand: 'b', status: 'e' };
  const rows = [
    { n: 'Laptop', s: 'NEW1', b: 'Dell', e: 'Disponible' },
    { n: 'Laptop', s: 'OLD', b: 'Dell' },
    { n: 'Laptop', s: 'NEW1', b: 'Dell' },
    { n: 'Monitor', s: 'X9', b: 'Acme' },
    { n: 'Mouse', e: 'Alta' },
  ];
  const result = await service.preview(rows, mapping, COMPANY, { createMissing: false });
  assert.deepEqual(result.rows.map((r) => r.status), ['new', 'exists', 'error', 'error', 'error']);
  assert.deepEqual(result.missing.brands, ['Acme']);
  assert.deepEqual(result.unknownStatuses, ['Alta']);
  const resolved = await service.preview(rows, mapping, COMPANY, { createMissing: true, statusMap: { alta: 'available' } });
  assert.equal(resolved.rows[3].status, 'new');
  assert.equal(resolved.rows[4].status, 'new');
});

test('preview derives the name from brand + model and plans the new model', async () => {
  const service = createInventoryItemImportService({ prisma: fakePrisma(), inventoryService: {} });
  const result = await service.preview([{ t: 'Access Point', b: 'Meraki', m: 'MR36' }], { type: 't', brand: 'b', model: 'm' }, COMPANY, { createMissing: true });
  assert.equal(result.rows[0].data.name, 'Meraki MR36');
  assert.deepEqual(result.missing.models, ['MR36 (Meraki)']);
});

test('commit creates missing type, brand and model, custom values and photos', async () => {
  const prisma = fakePrisma({ customFields: [{ id: 'f1', label: 'RAM', fieldKey: 'ram', fieldType: 'number', categoryId: null, category: null }] });
  const createdItems = [];
  const attached = [];
  const service = createInventoryItemImportService({
    prisma,
    inventoryService: { createItem: async (data) => { createdItems.push(data); return { id: 'item-1' }; } },
    fetchImage: async (url) => ({ buffer: PNG, type: 'image/png', name: url.split('/').pop() }),
  });
  const file = { rows: [{ t: 'Laptop', b: 'Asus', m: 'TUF 15', r: '16', f: 'https://example.com/a.png' }], rowNumbers: [2], images: new Map([[2, [{ buffer: PNG, type: 'image/png', name: 'x.png' }]]]) };
  const result = await service.commit(file, { type: 't', brand: 'b', model: 'm', 'custom:f1': 'r', imageUrl: 'f' }, COMPANY, 'user', {
    createMissing: true, attachImage: async (itemId, image) => attached.push([itemId, image.name]),
  });
  assert.equal(result.created, 1);
  assert.equal(result.photos, 2);
  assert.deepEqual(prisma.created.map(([table]) => table), ['invBrand', 'invCategory', 'invModel']);
  assert.equal(createdItems[0].modelId, 'invModel-2');
  assert.deepEqual(createdItems[0].customValues, [{ fieldId: 'f1', value: '16' }]);
  assert.deepEqual(attached.map(([, name]) => name), ['x.png', 'a.png']);
});

test('remote image guard rejects internal addresses and non-http links', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.0.1', '169.254.169.254', '::1', '::ffff:10.0.0.1']) assert.ok(isPrivateAddress(ip), ip);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.deepEqual(splitImageUrls('https://a.com/1.jpg, ftp://x, http://b.com/2.png'), ['https://a.com/1.jpg', 'http://b.com/2.png']);
});

test('itemOrderBy sorts relation columns by name and falls back to newest', () => {
  assert.deepEqual(itemOrderBy('brandName', 'asc'), [{ brand: { name: 'asc' } }, { createdAt: 'desc' }]);
  assert.deepEqual(itemOrderBy('nope', 'asc'), { createdAt: 'desc' });
});

test('buildAutoItemName prefers brand + model, then type, then the asset tag', async () => {
  const { buildAutoItemName } = await import('../inventory-service.js');
  assert.equal(buildAutoItemName({ brandName: 'Dell', model: 'XPS 15' }), 'Dell XPS 15');
  assert.equal(buildAutoItemName({ brandName: 'Dell', model: 'Dell XPS 15' }), 'Dell XPS 15');
  assert.equal(buildAutoItemName({ typeName: 'Laptop', model: 'XPS 15' }), 'Laptop XPS 15');
  assert.equal(buildAutoItemName({ typeName: 'Monitor' }), 'Monitor');
  assert.equal(buildAutoItemName({ assetTag: 'INV-2026-0007' }), 'Activo INV-2026-0007');
});
