import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryCatalogService, DEFAULT_INVENTORY_TYPES } from '../inventory-catalog-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';
const TYPE = '01900000-0000-7000-8000-000000000010';

function prismaWith({ categoryCount = 0, rows = [], itemCount = 0, modelCount = 0 } = {}) {
  const calls = { createMany: [], update: [] };
  return {
    calls,
    invCategory: {
      count: async () => categoryCount,
      createMany: async (args) => { calls.createMany.push(args); return { count: args.data.length }; },
      findMany: async () => rows,
      findFirst: async () => ({ id: TYPE }),
      update: async (args) => { calls.update.push(args); return { id: args.where.id, ...args.data }; },
    },
    invItem: { count: async () => itemCount },
    invModel: { count: async () => modelCount },
  };
}

test('listCategories seeds default types only for a company with no types at all', async () => {
  const prisma = prismaWith({ categoryCount: 0 });
  await createInventoryCatalogService({ prisma }).listCategories(COMPANY);
  assert.equal(prisma.calls.createMany.length, 1);
  assert.deepEqual(prisma.calls.createMany[0].data.map(t => t.name), DEFAULT_INVENTORY_TYPES.map(t => t.name));
  assert.equal(prisma.calls.createMany[0].skipDuplicates, true);

  const seeded = prismaWith({ categoryCount: 3 });
  await createInventoryCatalogService({ prisma: seeded }).listCategories(COMPANY);
  assert.equal(seeded.calls.createMany.length, 0);
});

test('listCategories flattens counts', async () => {
  const prisma = prismaWith({ categoryCount: 1, rows: [{ id: TYPE, name: 'Laptop', _count: { items: 4, customFields: 2, models: 3 } }] });
  const [row] = await createInventoryCatalogService({ prisma }).listCategories(COMPANY);
  assert.deepEqual(row, { id: TYPE, name: 'Laptop', itemCount: 4, customFieldCount: 2, modelCount: 3 });
});

test('deleteCategory refuses a type that enabled models still use', async () => {
  const prisma = prismaWith({ modelCount: 2 });
  await assert.rejects(createInventoryCatalogService({ prisma }).deleteCategory(TYPE, COMPANY), (err) => err.status === 409 && /2 modelo/.test(err.message));
  assert.equal(prisma.calls.update.length, 0);
});
