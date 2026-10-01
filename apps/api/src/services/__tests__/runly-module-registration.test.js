import { syncDiscoveredModuleDependencies } from '../../routes/modules.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_ONLY_OFFICIAL_MODULE_KEYS, OFFICIAL_MODULE_KEY_PAIRS } from '@runly/core';
import { listOfficialModuleManifests, listOfficialFallbackManifests, isOfficialCoreModuleKey } from '../module-manifests-service.js';
import { getModuleHandler, listRegisteredHandlers, registerModuleHandler } from '../module-cleanup-registry.js';
import { createModuleLifecycleService } from '../module-lifecycle-service.js';

test('core policy follows the manifest catalog and rejects custom impersonation', () => {
  const manifests = listOfficialModuleManifests();
  for (const { legacy, current } of OFFICIAL_MODULE_KEY_PAIRS) {
    const expected = manifests.find(manifest => manifest.key === current)?.core === true;
    assert.equal(isOfficialCoreModuleKey(legacy), expected);
    assert.equal(isOfficialCoreModuleKey(current), expected);
  }
  for (const key of ['runly.unknown', 'custom.core', 'atlas.core.extra', null]) assert.equal(isOfficialCoreModuleKey(key), false);
});

test('fallbacks do not recreate an old name when its Runly counterpart was discovered', () => {
  const officialCurrentKeys = [...OFFICIAL_MODULE_KEY_PAIRS.map(pair => pair.current), ...CURRENT_ONLY_OFFICIAL_MODULE_KEYS];
  assert.equal(listOfficialFallbackManifests(new Set(officialCurrentKeys)).length, 0);
  const fallback = listOfficialFallbackManifests(new Set(['runly.core', 'custom.fleet']));
  assert.equal(fallback.some(manifest => manifest.key === 'runly.core'), false);
  assert.equal(fallback.some(manifest => manifest.key === 'runly.fleet'), true);
  assert.equal(listOfficialModuleManifests().length, officialCurrentKeys.length);
});

test('cleanup aliases share implementations and preserve exact registrations', () => {
  const before = listRegisteredHandlers();
  assert.equal(getModuleHandler('runly.contacts'), getModuleHandler('atlas.contacts'));
  assert.equal(getModuleHandler('runly.hr'), getModuleHandler('atlas.hr'));
  assert.equal(getModuleHandler('runly.unknown'), null);
  assert.deepEqual(listRegisteredHandlers(), before);
  const count = async () => [];
  const purge = async () => 0;
  registerModuleHandler('runly.core', { count, purge });
  assert.equal(getModuleHandler('runly.core').count, count);
});

test('lifecycle sync preserves Runly core protection and UUIDs without trusting custom core flags', async () => {
  const rows = new Map();
  const prisma = {
    runlyModule: {
      findUnique: async ({ where }) => rows.get(where.key) ?? null,
      create: async ({ data }) => { const row = { id: `fixture-${data.key}`, ...data }; rows.set(data.key, row); return row; },
      update: async ({ where, data }) => { const row = { ...rows.get(where.key), ...data }; rows.set(where.key, row); return row; },
    },
    auditLog: { create: async () => ({}) },
    $transaction: async callback => callback(prisma),
  };
  const service = createModuleLifecycleService({ prisma });
  const manifests = [...OFFICIAL_MODULE_KEY_PAIRS.map(pair => pair.current), ...CURRENT_ONLY_OFFICIAL_MODULE_KEYS].map(current => ({ key: current, name: current, version: '1.0.0', permissions: [], blueprints: [] }));
  manifests.push({ key: 'custom.core', name: 'Custom', version: '1.0.0', core: true });
  const result = await service.syncModules({ manifests });
  assert.equal(result.added, manifests.length);
  for (const { current } of OFFICIAL_MODULE_KEY_PAIRS) {
    const row = rows.get(current);
    assert.equal(row.core, true);
    assert.equal(row.uninstallable, false);
    assert.equal(row.status, 'INSTALLED');
    assert.equal(row.enabled, true);
  }
  assert.equal(rows.get('custom.core').core, false);
  assert.equal(rows.get('custom.core').status, 'UNINSTALLED');
  const id = rows.get('runly.core').id;
  rows.get('runly.core').enabled = false;
  await service.syncModules({ manifests: [manifests[0]] });
  assert.equal(rows.get('runly.core').id, id);
  assert.equal(rows.get('runly.core').enabled, true);
  assert.equal(rows.has('atlas.core'), false);
});

function syncDependencyFixture() {
  const writes = [];
  const rows = [{ id: 'module-id', key: 'custom.demo' }, { id: 'core-id', key: 'runly.core' }];
  const prisma = {
    runlyModule: {
      findUnique: async ({ where }) => rows.find(row => row.key === where.key),
      findMany: async ({ where }) => rows.filter(row => where.key ? where.key.in.includes(row.key) : where.id.in.includes(row.id)),
    },
    moduleDependency: {
      findMany: async () => [],
      upsert: async args => { writes.push(args); },
      deleteMany: async args => { writes.push(args); },
    },
    $transaction: async callback => callback(prisma),
  };
  return { prisma, writes };
}

test('route dependency reconciliation writes one required UUID edge for both alias declarations', async () => {
  const { prisma, writes } = syncDependencyFixture();
  const result = await syncDiscoveredModuleDependencies({ prisma, moduleKey: 'custom.demo', dependencies: [
    { key: 'atlas.core', optional: false }, { key: 'runly.core', optional: true },
  ] });
  assert.equal(result.synced, 1);
  assert.equal(result.declared, 2);
  assert.equal(result.error, null);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].create, { moduleId: 'module-id', dependencyId: 'core-id', optional: false, versionRange: null });
});

test('route dependency conflicts reject before changing existing edges', async () => {
  const { prisma, writes } = syncDependencyFixture();
  await assert.rejects(syncDiscoveredModuleDependencies({ prisma, moduleKey: 'custom.demo', dependencies: [
    { key: 'atlas.core', versionRange: '^1.0.0' }, { key: 'runly.core', versionRange: '^2.0.0' },
  ] }), { code: 'DEPENDENCY_ALIAS_VERSION_CONFLICT', status: 409 });
  assert.deepEqual(writes, []);
});
