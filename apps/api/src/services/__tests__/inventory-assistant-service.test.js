import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryAssistantService } from '../inventory-assistant-service.js';
import { createAiContextSession } from '../ai-context-session.js';
import { createInventoryAccess } from '../inventory-access.js';
import { buildInventoryWhere, inventoryDayStart } from '../inventory-query.js';

const COMPANY = '01900000-0000-7000-8000-000000000001';
const ACTOR = '01900000-0000-7000-8000-000000000002';
const ITEM = '01900000-0000-7000-8000-000000000003';
const BRAND = '01900000-0000-7000-8000-000000000004';
const context = { mode: 'all' };
const row = { id: ITEM, name: 'Laptop', model: 'Model X', assetTag: 'INV-1', serialNumber: 'PRIVATE-SERIAL', brand: { name: 'Maker' } };
function fixture({ run, authorize = async () => {}, exists = true } = {}) {
  const queries = [], searches = [], transcripts = [];
  const db = {
    invItem: {
      count: async q => { queries.push(q); if (q.where.id) return exists ? q.where.id.in.length : 0; return q.where.AND?.[1]?.OR ? 12 : 125; },
      findMany: async q => { queries.push(q); return [row]; },
      findFirst: async q => { queries.push(q); return exists ? row : null; },
      groupBy: async q => { queries.push(q); return [{ brandId: BRAND, model: 'Model X', itemType: 'hardware', categoryId: null, _count: { id: 125 } }]; },
    },
    invBrand: { findMany: async q => { queries.push(q); return [{ id: BRAND, name: 'Maker' }]; } },
    invCategory: { findMany: async q => { queries.push(q); return []; } },
    auditLog: { create: async () => {} },
  };
  const service = createInventoryAssistantService({ prisma: db, env: { INVENTORY_AI_SIGNING_SECRET: 'test-secret' }, authorize,
    mirai: {
      answerWithTools: async args => { transcripts.push(args.messages); await run?.(args); return { text: 'Respuesta con datos registrados', model: 'test', calls: 1 }; },
      searchPublicModel: async query => { searches.push(query); return { results: [{ title: 'Manufacturer', url: 'https://example.com/specs', content: 'Public specifications' }] }; },
    },
  });
  return { service, db, queries, searches, transcripts, ask: (input = {}) => service.turn({ companyId: COMPANY, actorId: ACTOR, input: { content: 'Cuantos equipos hay', context, ...input } }) };
}

test('assistant counts the complete backend dataset, not a loaded page', async () => {
  const f = fixture(); await f.ask();
  const initial = f.transcripts[0][1].content;
  assert.match(initial, /"total":125/); assert.match(initial, /"missingSerial":12/);
  for (const q of f.queries) assert.ok(JSON.stringify(q.where).includes(COMPANY));
});

test('persistent assistant prepares catalog-only plans, retains them for corrections and never executes writes', async () => {
  const f = fixture({ run: async ({ executeTool, tools }) => {
    assert.ok(tools.some(tool => tool.function.name === 'inventory_prepare_create'));
    const result = await executeTool('inventory_prepare_create', { actions: [{ kind: 'customField', data: { fieldKey: 'ram_gb', label: 'RAM GB', fieldType: 'number', categoryName: null } }] });
    assert.equal(result.status, 'pending_confirmation');
  } });
  const result = await f.service.turn({ companyId: COMPANY, actorId: ACTOR, input: { content: 'Crea el campo RAM GB', context }, trustedMemory: { messages: [], recordIds: [] } });
  assert.equal(result.proposal.actions[0].kind, 'customField');
  assert.match(result.memory.messages.at(-1).content, /ram_gb/);
  assert.equal(result.session, undefined);
});
test('selected and filtered queries stay intersected with server context; company expansion is explicit', async () => {
  let search;
  const f = fixture({ run: async ({ executeTool }) => {
    const denied = await executeTool('inventory_search', { scope: 'company' }); assert.ok(denied.error);
    const invalid = await executeTool('inventory_search', { filters: { companyId: ACTOR } }); assert.ok(invalid.error);
    search = await executeTool('inventory_search', { filters: { model: 'Model X' } });
  } });
  const result = await f.ask({ context: { mode: 'selected', ids: [ITEM] } });
  assert.equal(search.total, 125); assert.equal(search.returned, 1); assert.equal(search.truncated, true);
  assert.deepEqual(result.references, [{ id: ITEM, label: 'INV-1' }]);
  const listing = f.queries.find(q => q.take === 30);
  assert.deepEqual(listing.where.AND[0].id, { in: [ITEM] });
  const filters = fixture();
  await filters.ask({ context: { mode: 'filtered', filters: { brandId: BRAND, search: 'Laptop' } } });
  const aggregate = filters.queries.find(q => q.by);
  assert.equal(aggregate.where.AND[0].brandId, BRAND); assert.equal(aggregate.where.AND[0].OR[0].name.contains, 'Laptop');
});
test('explicit company search remains company-scoped and does not retain selected IDs', async () => {
  const f = fixture({ run: ({ executeTool }) => executeTool('inventory_search', { scope: 'company' }) });
  await f.ask({ context: { mode: 'selected', ids: [ITEM], allowCompanySearch: true } });
  const query = f.queries.filter(q => q.take === 30).at(-1);
  assert.equal(query.where.AND[0].companyId, COMPANY); assert.equal(query.where.AND[0].id, undefined);
});
test('foreign, deleted or disabled selected records are rejected before calling the model', async () => {
  const f = fixture({ exists: false });
  await assert.rejects(f.ask({ context: { mode: 'item', ids: [ITEM] } }), e => e.status === 409);
  assert.equal(f.transcripts.length, 0);
});
test('revocation while the model is running discards its response', async () => {
  let allowed = true;
  const f = fixture({ authorize: async () => { if (!allowed) throw Object.assign(new Error('revoked'), { status: 403 }); }, run: async () => { allowed = false; } });
  await assert.rejects(f.ask(), e => e.status === 403);
});
test('deletion during the model call invalidates a response containing that record', async () => {
  const f = fixture({ run: async () => { f.db.invItem.count = async () => 0; } });
  await assert.rejects(f.ask({ context: { mode: 'item', ids: [ITEM] } }), e => e.status === 409);
});
test('history is authenticated, context-bound, and reauthorizes previously consulted records', async () => {
  const f = fixture(); const first = await f.ask({ context: { mode: 'item', ids: [ITEM] } });
  await assert.rejects(f.ask({ session: first.session }), e => e.status === 409);
  await assert.rejects(f.ask({ context: { mode: 'item', ids: [ITEM] }, session: `${first.session}x` }), e => e.status === 409);
  await f.ask({ context: { mode: 'item', ids: [ITEM] }, session: first.session });
  assert.ok(f.transcripts[1].some(m => m.role === 'assistant' && m.content === 'Respuesta con datos registrados'));
  f.db.invItem.count = async () => 0;
  await assert.rejects(f.ask({ context: { mode: 'item', ids: [ITEM] }, session: first.session }), e => e.status === 409);
});
test('public search sends only brand/model, limits calls and marks the external origin', async () => {
  const f = fixture({ run: async ({ executeTool }) => {
    const result = await executeTool('inventory_public_model', { id: ITEM });
    assert.equal(result.origin, 'external'); assert.match(result.warning, /no verifican/);
    await executeTool('inventory_public_model', { id: ITEM });
    assert.ok((await executeTool('inventory_public_model', { id: ITEM })).error);
    assert.ok((await executeTool('delete_item', { id: ITEM })).error);
  } });
  await f.ask({ context: { mode: 'item', ids: [ITEM] } });
  assert.equal(f.searches.length, 2); assert.ok(f.searches.every(q => q === 'Maker Model X especificaciones fabricante'));
});
test('concurrent turns for the same user/company are bounded', async () => {
  let finish, started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture({ run: async () => { started(); await new Promise(resolve => { finish = resolve; }); } });
  const first = f.ask(); await entered;
  await assert.rejects(f.ask(), e => e.status === 429);
  finish(); await first;
});
test('encrypted history never retains text after its authorization IDs overflow', () => {
  const sessions = createAiContextSession({ secret: 'secret' });
  const token = sessions.seal({ context: 'scope', messages: [{ role: 'assistant', content: 'sensitive' }], recordIds: Array.from({ length: 201 }, (_, i) => String(i)) });
  assert.deepEqual(sessions.open(token, 'scope').messages, []);
  assert.throws(() => sessions.open(token, 'another-user'), e => e.status === 409);
});
test('fresh access checks never combine permission grants from multiple companies', async () => {
  const grants = [];
  let memberships = [{ companyId: COMPANY, company: { enabled: true }, role: { key: 'viewer', permissions: [{ permission: { key: 'inventory.item.read' } }] } }];
  const access = createInventoryAccess({ prisma: {
    membership: { findMany: async q => { assert.equal(q.where.userId, ACTOR); assert.equal(q.where.enabled, true); return memberships; } },
    userPermissionGrant: { findMany: async q => { grants.push(q); return []; } },
  } });
  await access.assertCurrent({ companyId: COMPANY, actorId: ACTOR });
  await assert.rejects(access.assertCurrent({ companyId: COMPANY, actorId: ACTOR }, ['inventory.item.create']), e => e.status === 403);
  await assert.rejects(access.assertCurrent({ companyId: BRAND, actorId: ACTOR }), e => e.status === 403);
  assert.ok(grants.every(q => q.where.companyId === COMPANY));
  memberships = [];
  await assert.rejects(access.assertCurrent({ companyId: COMPANY, actorId: ACTOR }), e => e.status === 403);
});
test('inventory query keeps search, optional filters and missing-series checks conjunctive', () => {
  const where = buildInventoryWhere(COMPANY, { search: 'Laptop', missingSerial: true, status: 'available' });
  assert.equal(where.companyId, COMPANY); assert.equal(where.enabled, true); assert.equal(where.status, 'available');
  assert.equal(where.OR.length, 3); assert.equal(where.AND[0].OR.length, 2);
  assert.throws(() => buildInventoryWhere(null));
});
test('calendar queries use local day boundaries, including daylight-saving transitions', () => {
  assert.equal(inventoryDayStart('2026-09-01', 0, 'America/Mexico_City').getTime(), Date.parse('2026-09-01T06:00:00Z'));
  const start = inventoryDayStart('2026-03-08', 0, 'America/New_York');
  const end = inventoryDayStart('2026-03-08', 1, 'America/New_York');
  assert.equal(end - start, 23 * 60 * 60 * 1000);
});
