import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeSession } from './session.js';
import { diagnoseBlueprints } from './contracts.js';
import { resolveBlueprintPresentation } from './presentation.js';
import { resolveRouteInfo, selectBlueprints } from './resolver.js';
import { createRunlyClient, createAtlasClient } from '../../sdk/src/index.js';
import { createErpAdapters } from './erp-adapters.js';
import { navigationTarget } from './navigation.js';

test('shared navigation preserves sheet create suppression and encoded deep links', () => {
  const routeInfo = { moduleRoutePath: '/app/m/custom.test/tasks' };
  assert.equal(navigationTarget({ routeInfo, mode: 'create', isSheetMode: true }), null);
  assert.equal(navigationTarget({ routeInfo, mode: 'create' }), routeInfo.moduleRoutePath + '/new');
  assert.equal(navigationTarget({ routeInfo, mode: 'edit', recordId: 'a/b' }), routeInfo.moduleRoutePath + '/a%2Fb/edit');
  assert.equal(navigationTarget({ routeInfo, mode: 'detail', recordId: 'a/b', isSheetMode: true }), routeInfo.moduleRoutePath + '/a%2Fb');
  assert.throws(() => createRuntimeSession({ id: 'bad', transport: { fetch() {} }, preferences: {}, resources: {} }), TypeError);
});

test('ERP transport preserves credentials and refuses other origins', async () => {
  let received;
  const adapter = createErpAdapters({ baseUrl: 'https://erp.example/api', getToken: () => 'fixture-token', getCompanyId: () => 'fixture-company', fetch: async (...args) => { received = args; return Response.json({ data: [] }); } });
  await adapter.transport.fetch('https://erp.example/api/tasks');
  assert.equal(received[1].headers.get('Authorization'), 'Bearer fixture-token');
  assert.equal(received[1].headers.get('X-Runly-Company-Id'), 'fixture-company');
  assert.throws(() => adapter.transport.fetch('https://other.example/api/tasks'), /TARGET_MISMATCH/);
});

test('session isolates registry, preferences and transport; disposal fences late calls', async () => {
  let requests = 0;
  const store = new Map();
  const options = { id: 'fixture:1', transport: { fetch: async () => { requests++; return Response.json({ data: [] }); } }, preferences: { get: (k) => store.get(k), set: (k,v) => store.set(k,v), remove: (k) => store.delete(k) }, resources: { resolve: () => { throw new Error('unsupported'); } } };
  const a = createRuntimeSession(options), b = createRuntimeSession({ ...options, id: 'fixture:2' });
  a.registry.register('test:Cell', () => null);
  assert.equal(b.registry.resolve('test:Cell'), null);
  await a.adapters.transport.fetch('/profile/me/table-preferences/test', { method: 'PUT', body: '{"pageSize":20}' });
  assert.equal((await (await a.adapters.transport.fetch('/profile/me/table-preferences/test')).json()).data.pageSize, 20);
  assert.equal(requests, 0);
  await a.adapters.transport.fetch('/fixture/tasks');
  assert.equal(requests, 1);
  a.dispose();
  await assert.rejects(a.adapters.transport.fetch('/fixture/tasks'), { code: 'PREVIEW_UNSUPPORTED' });
});

test('original longest PAGE route and entity selection support list, create, detail and edit', () => {
  const table = { key: 'task.table', kind: 'TABLE', schema: { entity: 'task', apiPath: '/tasks/tasks' } };
  const rows = [table, { key: 'task.form', kind: 'FORM', schema: { entity: 'task' } }, { key: 'task.detail', kind: 'DETAIL', schema: { entity: 'task' } }, { key: 'task.page', kind: 'PAGE', schema: { path: '/app/m/custom.test/tasks', view: table.key } }];
  for (const [suffix, mode] of [['', 'list'], ['/new', 'create'], ['/record', 'detail'], ['/record/edit', 'edit']]) {
    const routeInfo = resolveRouteInfo({ moduleKey: 'custom.test', pathname: `/app/m/custom.test/tasks${suffix}`, moduleRows: rows });
    assert.equal(routeInfo.initialMode, mode);
    assert.equal(selectBlueprints({ moduleRows: rows, routeInfo }).tableBlueprint, table);
  }
});

test('Atlas presentation aliases and unsupported capabilities are explicit', () => {
  assert.equal(resolveBlueprintPresentation({ tableBlueprint: { schema: { layout: 'atlas.crudLayout' } } }).layoutKey, 'runly.crudLayout');
  for (const type of ['attachments', 'audit', 'relation-card', 'file-asset', 'component']) assert.ok(diagnoseBlueprints([{ key: 'test', kind: 'DETAIL', schema: { sections: [{ type }] } }]).length);
  assert.equal(diagnoseBlueprints([{ key: 'test', kind: 'FORM', schema: { fields: [{ type: 'relation', relation: { apiPath: '/tasks' } }] } }]).length, 0);
  assert.ok(diagnoseBlueprints([{ key: 'test', kind: 'CUSTOM', schema: {} }]).length);
});

test('SDK injected fetch preserves company/auth and Atlas identity', async () => {
  assert.equal(createAtlasClient, createRunlyClient);
  let received;
  const client = createRunlyClient({ baseUrl: 'https://erp.example', getActiveCompanyId: () => 'fixture-company', fetch: async (...args) => { received = args; return Response.json({ data: [] }); } });
  await client.blueprints.list('fixture-token');
  assert.equal(received[1].headers.Authorization, 'Bearer fixture-token');
  assert.equal(received[1].headers['X-Runly-Company-Id'], 'fixture-company');
});
