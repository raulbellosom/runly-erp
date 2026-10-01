import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryMiraiQueries } from '../inventory-mirai-queries.js';
import { createInventoryMiraiActions } from '../mirai-actions.js';
import { createInventoryMiraiCapabilities } from '../mirai-capabilities.js';
import { createPublicLookup } from '../../../services/ai/public-lookup.js';

const COMPANY = 'co1';
const actx = { companyId: COMPANY, actorProfileId: 'me', actorAuthUserId: 'auth1', turn: {} };
const ITEM = '01900000-0000-7000-8000-000000000003';
const OTHER_ITEM = '01900000-0000-7000-8000-000000000009';
const ROW = { id: ITEM, name: 'Laptop', model: 'Model X', assetTag: 'INV-1', serialNumber: 'SN-1', status: 'available',
  locationId: null, purchaseDate: null, warrantyExpiry: null, notes: null,
  brand: { name: 'Maker' }, category: { name: 'Laptop' }, location: null };

function accessOkPrisma(overrides = {}) {
  return {
    membership: { findMany: async () => [{ companyId: COMPANY, enabled: true, user: { enabled: true }, role: { enabled: true, permissions: [{ permission: { key: 'inventory.item.read' } }] }, company: { enabled: true } }] },
    userPermissionGrant: { findMany: async () => [] },
    invItem: {
      count: async ({ where }) => (where.id ? where.id.in.length : 125),
      findMany: async () => [ROW],
      findFirst: async () => ROW,
      groupBy: async () => [{ brandId: 'b1', model: 'Model X', categoryId: 'c1', _count: { id: 125 } }],
    },
    invBrand: { findMany: async () => [{ id: 'b1', name: 'Maker' }] },
    invCategory: { findMany: async () => [{ id: 'c1', name: 'Laptop' }] },
    invLocation: { findMany: async () => [] },
    invItemFile: { findMany: async () => [] },
    auditLog: { create: async () => {} },
    ...overrides,
  };
}

function queriesFor(prisma, publicLookup = createPublicLookup({ search: null })) {
  return Object.fromEntries(createInventoryMiraiQueries({ prisma, publicLookup }).map((t) => [t.name, t]));
}

// ── tools: scope ────────────────────────────────────────────────────────────

test('inventory_search defaults to scope "selection" and scopes "selected" ids to the company', async () => {
  const seen = [];
  const prisma = accessOkPrisma({
    invItem: {
      count: async ({ where }) => { seen.push(where); return 1; },
      findMany: async ({ where }) => { seen.push(where); return [ROW]; },
    },
  });
  const tools = queriesFor(prisma);
  const turnCtx = { ...actx, turn: { pageContext: { moduleKey: 'runly.inventory', selection: { mode: 'selected', ids: [ITEM, OTHER_ITEM] } } } };
  const out = await tools.inventory_search.run({}, turnCtx);
  assert.equal(out.total, 1);
  assert.equal(out.items[0].itemId, ITEM);
  const where = seen[0];
  assert.deepEqual(where.AND[0].id, { in: [ITEM, OTHER_ITEM] });
  assert.equal(where.AND[0].companyId, COMPANY);
});

test('inventory_search: no selection on the page -> defaults to scope "company" (whole company, not an error)', async () => {
  const seen = [];
  const prisma = accessOkPrisma({ invItem: { count: async ({ where }) => { seen.push(where); return 1; }, findMany: async () => [ROW] } });
  const tools = queriesFor(prisma);
  const out = await tools.inventory_search.run({}, { ...actx, turn: { pageContext: { moduleKey: 'runly.inventory' } } });
  assert.equal(out.error, undefined);
  assert.equal(seen[0].AND[0].id, undefined);
  assert.equal(seen[0].AND[0].companyId, COMPANY);
});

test('inventory_search: scope "selection" with no selection on the page -> explicit error', async () => {
  const tools = queriesFor(accessOkPrisma());
  const out = await tools.inventory_search.run({ scope: 'selection' }, { ...actx, turn: { pageContext: { moduleKey: 'runly.inventory' } } });
  assert.match(out.error, /seleccion o filtros/i);
});

test('inventory_search: scope "company" ignores the page selection entirely', async () => {
  const seen = [];
  const prisma = accessOkPrisma({ invItem: { count: async ({ where }) => { seen.push(where); return 1; }, findMany: async () => [ROW] } });
  const tools = queriesFor(prisma);
  const turnCtx = { ...actx, turn: { pageContext: { moduleKey: 'runly.inventory', selection: { mode: 'selected', ids: [ITEM] } } } };
  await tools.inventory_search.run({ scope: 'company' }, turnCtx);
  assert.equal(seen[0].AND[0].id, undefined);
});

test('inventory_summary computes exact totals and groups, never a sample', async () => {
  const tools = queriesFor(accessOkPrisma());
  const turnCtx = { ...actx, turn: { pageContext: { moduleKey: 'runly.inventory', selection: { mode: 'filtered', filters: { brandId: 'b1' } } } } };
  const out = await tools.inventory_summary.run({}, turnCtx);
  assert.equal(out.total, 125);
  assert.equal(out.groups[0].brand, 'Maker');
  assert.equal(out.groups[0].count, 125);
});

test('inventory_catalogs delegates to the existing catalogs lookup', async () => {
  const tools = queriesFor(accessOkPrisma({ invCustomField: { findMany: async () => [] }, invModel: { findMany: async () => [] } }));
  const out = await tools.inventory_catalogs.run({ search: 'Mak' }, actx);
  assert.equal(out.brands[0].name, 'Maker');
});

test('inventory_public_model: sends only type/brand/model, audits and bounds 2 lookups per turn', async () => {
  const searches = [];
  const publicLookup = createPublicLookup({ search: async (q) => { searches.push(q); return { results: [{ title: 't', url: 'https://x.com', content: 'specs' }] }; } });
  const audited = [];
  const prisma = accessOkPrisma({ auditLog: { create: async ({ data }) => { audited.push(data); } } });
  const tools = queriesFor(prisma, publicLookup);
  const turnCtx = { ...actx, turn: {} };
  const first = await tools.inventory_public_model.run({ itemId: ITEM }, turnCtx);
  assert.equal(first.origin, 'external');
  await tools.inventory_public_model.run({ itemId: ITEM }, turnCtx);
  const third = await tools.inventory_public_model.run({ itemId: ITEM }, turnCtx);
  assert.ok(third.error);
  assert.equal(searches.length, 2);
  assert.ok(searches.every((q) => q.includes('Maker') && q.includes('Model X') && !q.includes('SN-1')));
  assert.equal(audited[0].action, 'inventory.ai.public_lookup');
});

// ── actions: inventory.plan.create ──────────────────────────────────────────

function actionsFor({ inventoryService } = {}) {
  const prisma = {
    $transaction: async (fn) => fn(prisma),
    invBrand: { findMany: async () => [] },
    invCategory: { findMany: async () => [] },
    invLocation: { findMany: async () => [] },
    invCustomField: { findMany: async () => [] },
    invItem: { findFirst: async () => null },
    auditLog: { create: async () => {} },
    membership: { findMany: async () => [{ companyId: COMPANY, enabled: true, user: { enabled: true }, role: { enabled: true, permissions: [{ permission: { key: 'inventory.catalog.manage' } }, { permission: { key: 'inventory.item.create' } }, { permission: { key: 'inventory.item.read' } }] }, company: { enabled: true } }] },
    userPermissionGrant: { findMany: async () => [] },
  };
  return { prisma, actions: Object.fromEntries(createInventoryMiraiActions({ prisma, inventoryService }).map((a) => [a.key, a])) };
}

test('inventory.plan.create: prepare validates and previews without writing', async () => {
  const { actions } = actionsFor();
  const out = await actions['inventory.plan.create'].prepare({ actions: [{ kind: 'brand', data: { name: 'Nueva marca' } }] }, actx);
  assert.equal(out.preview.fields[0].label, 'Marca');
  assert.equal(out.preview.fields[0].value, 'Nueva marca');
  assert.ok(out.input.id);
});

test('inventory.plan.create: execute runs the existing executor inside a transaction', async () => {
  const { prisma, actions } = actionsFor();
  let transacted = false;
  prisma.$transaction = async (fn) => { transacted = true; return fn(prisma); };
  prisma.$queryRaw = async () => [{ locked: true }];
  prisma.invBrand.create = async ({ data }) => ({ id: 'b-new', ...data });
  const prepared = await actions['inventory.plan.create'].prepare({ actions: [{ kind: 'brand', data: { name: 'Nueva marca' } }] }, { ...actx, prisma });
  const res = await actions['inventory.plan.create'].execute(prepared.input, { ...actx, prisma });
  assert.equal(transacted, true);
  assert.equal(res.results[0].kind, 'brand');
  assert.match(res.summary, /Creados 1/);
});

// ── actions: inventory.item.update / delete ─────────────────────────────────

test('inventory.item.update: preview includes before/after for a changed field and no permission', async () => {
  const inventoryService = { getItem: async () => ROW };
  const { actions } = actionsFor({ inventoryService });
  const out = await actions['inventory.item.update'].prepare({ itemId: ITEM, name: 'Laptop renombrada' }, actx);
  assert.equal(out.targetId, ITEM);
  assert.ok(out.preview.fields.some((f) => f.label === 'Nombre' && f.before === 'Laptop' && f.value === 'Laptop renombrada'));
});

test('inventory.item.update: no changes -> error, not an empty proposal', async () => {
  const inventoryService = { getItem: async () => ROW };
  const { actions } = actionsFor({ inventoryService });
  const out = await actions['inventory.item.update'].prepare({ itemId: ITEM, name: 'Laptop' }, actx);
  assert.match(out.error, /ningun cambio/i);
});

test('inventory.item.update: execute calls inventoryService.updateItem', async () => {
  const calls = [];
  const inventoryService = { getItem: async () => ROW, updateItem: async (id, data, companyId) => { calls.push([id, data, companyId]); return { ...ROW, name: 'Laptop renombrada' }; } };
  const { actions } = actionsFor({ inventoryService });
  const prepared = await actions['inventory.item.update'].prepare({ itemId: ITEM, name: 'Laptop renombrada' }, actx);
  const res = await actions['inventory.item.update'].execute(prepared.input, actx);
  assert.equal(calls[0][0], ITEM); assert.equal(calls[0][2], COMPANY);
  assert.match(res.summary, /Laptop renombrada/);
});

test('inventory.item.delete: destructive, loads the item and calls deleteItem on execute', async () => {
  const calls = [];
  const inventoryService = { getItem: async () => ROW, deleteItem: async (id, companyId) => { calls.push([id, companyId]); } };
  const { actions } = actionsFor({ inventoryService });
  const prepared = await actions['inventory.item.delete'].prepare({ itemId: ITEM }, actx);
  assert.equal(prepared.targetId, ITEM);
  await actions['inventory.item.delete'].execute(prepared.input, actx);
  assert.deepEqual(calls[0], [ITEM, COMPANY]);
});

// ── capability wiring ────────────────────────────────────────────────────────

test('createInventoryMiraiCapabilities exposes 4 tools, 3 actions and the item publicLookup under runly.inventory', () => {
  const cap = createInventoryMiraiCapabilities({ prisma: accessOkPrisma(), publicLookup: createPublicLookup({ search: null }) });
  assert.equal(cap.moduleKey, 'runly.inventory');
  assert.equal(cap.tools.length, 4);
  assert.equal(cap.actions.length, 3);
  assert.deepEqual(cap.publicLookup, [{ model: 'item', publicFields: ['type', 'brand', 'model'] }]);
});

test('describeContext: item line includes itemId, asset tag, serial and status', async () => {
  const cap = createInventoryMiraiCapabilities({ prisma: accessOkPrisma(), publicLookup: createPublicLookup({ search: null }) });
  const line = await cap.describeContext({ recordType: 'item', recordId: ITEM }, actx);
  assert.match(line, new RegExp(ITEM));
  assert.match(line, /INV-1/);
  assert.match(line, /SN-1/);
  assert.match(line, /available/);
});

test('describeContext: a "selected" selection with no open item reports the count', async () => {
  const cap = createInventoryMiraiCapabilities({ prisma: accessOkPrisma(), publicLookup: createPublicLookup({ search: null }) });
  const line = await cap.describeContext({ selection: { mode: 'selected', ids: [ITEM, OTHER_ITEM] } }, actx);
  assert.match(line, /2 equipo/);
});

test('describeContext: outside any record or selection returns the generic module line', async () => {
  const cap = createInventoryMiraiCapabilities({ prisma: accessOkPrisma(), publicLookup: createPublicLookup({ search: null }) });
  const line = await cap.describeContext({}, actx);
  assert.equal(line, 'El usuario esta en el modulo Inventario.');
});
