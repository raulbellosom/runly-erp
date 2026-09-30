import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInventoryItemImportService, parseImportDate, parseImportPrice, parseItemFile, suggestItemMapping,
} from '../inventory-item-import-service.js';
import { itemOrderBy } from '../inventory-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';

function fakePrisma({ items = [], types = [], brands = [] } = {}) {
  return {
    invCategory: { findMany: async () => types },
    invBrand: { findMany: async () => brands },
    invLocation: { findMany: async () => [] },
    invModel: { findMany: async () => [] },
    invItem: { findMany: async () => items },
  };
}

test('parseImportDate accepts ISO and day-first dates, rejects impossible ones', () => {
  assert.equal(parseImportDate('2024-03-15'), '2024-03-15');
  assert.equal(parseImportDate('15/03/2024'), '2024-03-15');
  assert.equal(parseImportDate('5-3-24'), '2024-03-05');
  assert.equal(parseImportDate('31/02/2024'), null);
  assert.equal(parseImportDate('ayer'), null);
});

test('parseImportPrice strips currency formatting', () => {
  assert.equal(parseImportPrice('$1,299.50'), 1299.5);
  assert.equal(parseImportPrice(''), null);
  assert.ok(Number.isNaN(parseImportPrice('mil')));
});

test('suggestItemMapping matches common header spellings once each', () => {
  const mapping = suggestItemMapping(['Nombre', 'No. Serie', 'Marca', 'Categoría', 'Ubicación', 'Otra']);
  assert.deepEqual(mapping, { name: 'Nombre', serialNumber: 'No. Serie', brand: 'Marca', type: 'Categoría', location: 'Ubicación' });
});

test('parseItemFile keeps original CSV headers', async () => {
  const { headers, rows } = await parseItemFile(Buffer.from('Nombre,No. Serie\nLaptop,ABC\n'), 'a.csv');
  assert.deepEqual(headers, ['Nombre', 'No. Serie']);
  assert.deepEqual(rows, [{ Nombre: 'Laptop', 'No. Serie': 'ABC' }]);
});

test('preview flags existing serials, file duplicates, missing catalogs and bad status', async () => {
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
    { n: 'Mouse', e: 'Asignado' },
  ];
  const result = await service.preview(rows, mapping, COMPANY, { createMissing: false });
  assert.deepEqual(result.rows.map((r) => r.status), ['new', 'exists', 'error', 'error', 'error']);
  assert.deepEqual(result.missing.brands, ['Acme']);
  const withCreate = await service.preview(rows, mapping, COMPANY, { createMissing: true });
  assert.equal(withCreate.rows[3].status, 'new');
});

test('itemOrderBy sorts relation columns by name and falls back to newest', () => {
  assert.deepEqual(itemOrderBy('brandName', 'asc'), [{ brand: { name: 'asc' } }, { createdAt: 'desc' }]);
  assert.deepEqual(itemOrderBy('nope', 'asc'), { createdAt: 'desc' });
});
