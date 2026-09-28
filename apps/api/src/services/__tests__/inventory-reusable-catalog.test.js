import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryReusableCatalog } from '../inventory-reusable-catalog.js';

const COMPANY = '00000000-0000-7000-8000-000000000001';

function fakePrisma({ brand = { id: 'b1', name: 'Dell' }, customTypes = [] } = {}) {
  const calls = [];
  return {
    calls,
    invBrand: { findFirst: async () => brand },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join('?');
      calls.push({ sql, values });
      if (sql.includes("kind = 'type' AND name =")) return customTypes.includes(values[1]) ? [{ id: 't1' }] : [];
      if (sql.startsWith('INSERT')) return [{ id: 'm1', name: values[2], details: JSON.parse(values[5]), reused: false }];
      return [];
    },
  };
}

test('model requires type and brand', async () => {
  const catalog = createInventoryReusableCatalog({ prisma: fakePrisma() });
  await assert.rejects(catalog.create({ companyId: COMPANY, kind: 'model', input: { name: 'XPS 15', brandName: 'Dell' } }), /tipo/);
  await assert.rejects(catalog.create({ companyId: COMPANY, kind: 'model', input: { name: 'XPS 15', itemType: 'hardware' } }), /marca/);
  await assert.rejects(catalog.create({ companyId: COMPANY, kind: 'model', input: { name: 'XPS 15', itemType: 'nope', brandName: 'Dell' } }), /tipo no existe/);
});

test('model stores brand id, type label and year in its scope', async () => {
  const prisma = fakePrisma();
  const row = await createInventoryReusableCatalog({ prisma }).create({ companyId: COMPANY, kind: 'model',
    input: { name: 'XPS 15', itemType: 'hardware', brandName: 'dell', year: 2023 } });
  assert.deepEqual(row.details, { name: 'XPS 15', itemType: 'hardware', brandName: 'Dell', year: 2023, brandId: 'b1', typeLabel: 'Hardware' });
  const insert = prisma.calls.find(call => call.sql.startsWith('INSERT'));
  assert.equal(insert.values[4], 'dell|2023');
});

test('list splits the search into escaped words', async () => {
  const prisma = fakePrisma();
  await createInventoryReusableCatalog({ prisma }).list({ companyId: COMPANY, kind: 'model', search: ' dell  2023 50% ' });
  assert.deepEqual(prisma.calls[0].values[2], ['dell', '2023', '50\\%']);
});
