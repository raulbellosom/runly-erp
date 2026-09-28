import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryModelService } from '../inventory-model-service.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';
const TYPE = '01900000-0000-7000-8000-000000000010';
const BRAND = '01900000-0000-7000-8000-000000000020';
const MODEL = '01900000-0000-7000-8000-000000000030';

function prismaWith({ duplicate = null, brands = [{ id: BRAND }], types = [{ id: TYPE }], model = null, itemCount = 0 } = {}) {
  const calls = { findMany: [], create: [], update: [] };
  const row = (data) => ({ id: MODEL, sortOrder: 0, ...data, type: { name: 'Laptop', icon: 'Laptop', color: null }, brand: { name: 'Dell' }, _count: { items: 0 } });
  return {
    calls,
    invCategory: { findFirst: async () => ({ id: TYPE }), findMany: async () => types },
    invBrand: { findFirst: async () => ({ id: BRAND }), findMany: async () => brands },
    invItem: { count: async () => itemCount },
    invModel: {
      findFirst: async (args) => (args.select?.name ? model : args.where.nameKey !== undefined ? duplicate : model),
      findMany: async (args) => { calls.findMany.push(args); return [row({ name: 'XPS 15', typeId: TYPE, brandId: BRAND, year: 2023 })]; },
      create: async (args) => { calls.create.push(args); return row(args.data); },
      update: async (args) => { calls.update.push(args); return row({ ...model, ...args.data }); },
    },
  };
}

test('create resolves type and brand by name and flattens the row', async () => {
  const prisma = prismaWith();
  const row = await createInventoryModelService({ prisma }).create({ name: ' XPS 15 ', typeName: 'Laptop', brandName: 'dell', year: 2023 }, COMPANY);
  assert.deepEqual(prisma.calls.create[0].data, { companyId: COMPANY, name: 'XPS 15', nameKey: 'xps 15', typeId: TYPE, brandId: BRAND, year: 2023, description: null });
  assert.equal(row.typeName, 'Laptop');
  assert.equal(row.brandName, 'Dell');
  assert.equal(row.itemCount, 0);
});

test('create requires type and brand', async () => {
  const service = createInventoryModelService({ prisma: prismaWith() });
  await assert.rejects(service.create({ name: 'XPS', brandId: BRAND }, COMPANY), /tipo/);
  await assert.rejects(service.create({ name: 'XPS', typeId: TYPE }, COMPANY), /marca/);
  await assert.rejects(createInventoryModelService({ prisma: prismaWith({ brands: [] }) }).create({ name: 'XPS', typeId: TYPE, brandName: 'Nope' }, COMPANY), /«Nope» no existe/);
});

test('create rejects a duplicate (brand + name + year) unless reuse is requested', async () => {
  const existing = { id: MODEL, name: 'XPS 15', typeId: TYPE, brandId: BRAND, year: null };
  const service = createInventoryModelService({ prisma: prismaWith({ duplicate: existing, model: existing }) });
  await assert.rejects(service.create({ name: 'xps 15', typeId: TYPE, brandId: BRAND }, COMPANY), (err) => err.status === 409);
  const reused = await service.create({ name: 'xps 15', typeId: TYPE, brandId: BRAND }, COMPANY, { reuse: true });
  assert.equal(reused.reused, true);
});

test('list turns every search word into an OR over name, description, brand, type and year', async () => {
  const prisma = prismaWith();
  await createInventoryModelService({ prisma }).list({ companyId: COMPANY, search: 'dell 2023' });
  const { AND } = prisma.calls.findMany[0].where;
  assert.equal(AND.length, 2);
  assert.ok(AND[0].OR.some((c) => c.brand?.name?.contains === 'dell'));
  assert.ok(AND[1].OR.some((c) => c.year === 2023));
});

test('applyModelDefaults fills name, type and brand but keeps explicit values', async () => {
  const model = { name: 'XPS 15', typeId: TYPE, brandId: BRAND };
  const service = createInventoryModelService({ prisma: prismaWith({ model }) });
  assert.deepEqual(await service.applyModelDefaults({ modelId: MODEL, name: 'Laptop 1' }, COMPANY),
    { modelId: MODEL, name: 'Laptop 1', model: 'XPS 15', categoryId: TYPE, brandId: BRAND });
  assert.equal((await service.applyModelDefaults({ modelId: MODEL, categoryId: 'other' }, COMPANY)).categoryId, 'other');
  assert.deepEqual(await service.applyModelDefaults({ name: 'x' }, COMPANY), { name: 'x' });
  await assert.rejects(createInventoryModelService({ prisma: prismaWith({ model: null }) }).applyModelDefaults({ modelId: MODEL }, COMPANY), /modelo no existe/);
});

test('remove refuses a model used by enabled items', async () => {
  const service = createInventoryModelService({ prisma: prismaWith({ model: { id: MODEL }, itemCount: 3 }) });
  await assert.rejects(service.remove(MODEL, COMPANY), (err) => err.status === 409 && /3 activo/.test(err.message));
});
