import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFICIAL_MODULE_KEY_PAIRS } from '@runly/core';
import { mergeRuntimeModules, getModuleByKey, getModuleLaunchPath, getAvailableModules, matchesFullscreenPath } from '../runtime-modules-core.js';
import { resolveScreen, hasBuiltInModule, isPathAllowedByNavigation } from '../../app/module-screen-resolver.js';

const row = (key, manifest = {}) => ({ id: `persisted-${key}`, key, name: key, status: 'INSTALLED', enabled: true, manifest });

test('all official pairs merge local manifests into the persisted identity in both directions', () => {
  for (const { legacy, current } of OFFICIAL_MODULE_KEY_PAIRS) {
    for (const [stored, local] of [[current, legacy], [legacy, current]]) {
      const manifest = { key: local, navigation: [{ path: `/app/m/${local}/list`, permission: 'unchanged.read' }], version: '1.0.0' };
      const before = structuredClone(manifest);
      const [module, duplicate] = mergeRuntimeModules([row(stored)], { manifests: [manifest] });
      assert.equal(duplicate, undefined);
      assert.equal(module.key, stored);
      assert.equal(module.id, `persisted-${stored}`);
      assert.equal(module.navigation[0].path, '/list');
      assert.equal(module.navigation[0].permission, 'unchanged.read');
      assert.equal(getModuleByKey([module], local), module);
      assert.deepEqual(manifest, before);
    }
  }
});

test('API navigation stays authoritative, including empty or omitted navigation and excluded modules', () => {
  const manifest = { key: 'atlas.core', core: true, navigation: [{ path: '/admin' }] };
  for (const apiManifest of [{ navigation: [] }, {}]) {
    const modules = mergeRuntimeModules([row('runly.core', apiManifest)], {
      manifests: [manifest, { key: 'custom.hidden', core: true }], includeManifestFallback: false, preferApiNavigation: true,
    });
    assert.equal(modules.length, 1);
    assert.deepEqual(modules[0].navigation, []);
    assert.equal(isPathAllowedByNavigation(modules[0], '/admin'), false);
  }
  const modules = mergeRuntimeModules([{ ...row('runly.core'), enabled: false, status: 'DISABLED' }], { manifests: [manifest] });
  assert.equal(getAvailableModules(modules).length, 0);
});

test('catalog collisions remain separate and never borrow the other persisted record local manifest', () => {
  const modules = mergeRuntimeModules([row('atlas.core'), row('runly.core')], {
    manifests: [{ key: 'atlas.core', navigation: [{ path: '/admin' }] }],
  });
  assert.equal(modules.length, 2);
  assert.equal(getModuleByKey(modules, 'atlas.core').key, 'atlas.core');
  assert.deepEqual(getModuleByKey(modules, 'runly.core').navigation, []);
  assert.deepEqual(getModuleByKey(modules, 'atlas.core').navigation.map(nav => nav.path), ['/admin']);
});

test('unknown namespaces and similarly named custom modules remain independent', () => {
  const modules = mergeRuntimeModules([row('runly.unknown'), row('custom.runly.core')], {
    manifests: [{ key: 'atlas.unknown' }, { key: 'custom.atlas.core' }],
  });
  assert.equal(modules.length, 4);
  assert.equal(getModuleByKey(modules, 'atlas.core'), null);
});

test('nested navigation normalizes only module identity and preserves suffix, query, hash and access metadata', () => {
  const navigation = [{ label: 'Group', children: [{ label: 'Nested', children: [
    { path: '/app/m/atlas.core/settings?module=atlas.files#tab', permission: 'core.settings.read' },
  ] }] }];
  const before = structuredClone(navigation);
  const [module] = mergeRuntimeModules([row('runly.core', { navigation, fullscreenPaths: ['/app/m/atlas.core/settings'] })]);
  const leaf = module.navigation[0].children[0].children[0];
  assert.equal(leaf.path, '/settings?module=atlas.files#tab');
  assert.equal(leaf.permission, 'core.settings.read');
  assert.equal(isPathAllowedByNavigation(module, '/settings/detail'), true);
  assert.equal(isPathAllowedByNavigation(module, '/settings-other'), false);
  assert.equal(isPathAllowedByNavigation(module, '/admin'), false);
  assert.equal(matchesFullscreenPath(module, '/settings'), true);
  assert.deepEqual(navigation, before);
});

test('launch paths avoid double prefixes and catalog collisions cannot authorize the other module path', () => {
  const modules = mergeRuntimeModules([
    row('runly.core', { navigation: [{ path: '/app/m/atlas.files/files?view=recent#top' }] }),
    row('runly.files'),
  ]);
  assert.equal(getModuleLaunchPath(getModuleByKey(modules, 'runly.core')), '/app/m/runly.files/files?view=recent#top');
  const collision = mergeRuntimeModules([row('runly.core', { navigation: [{ path: '/app/m/atlas.core/admin' }] }), row('atlas.core')]);
  assert.equal(isPathAllowedByNavigation(getModuleByKey(collision, 'runly.core'), '/admin'), false);
  const [root] = mergeRuntimeModules([row('runly.core', { navigation: [{ path: '/app/m/atlas.core?tab=home#top' }] })]);
  assert.equal(getModuleLaunchPath(root), '/app/m/runly.core/?tab=home#top');
});

test('built-in implementations resolve both spellings, preserve exact priority and keep custom blueprint fallback', () => {
  const screenMap = Object.fromEntries(OFFICIAL_MODULE_KEY_PAIRS.map(({ current }) => [`${current}:/`, { module: current }]));
  const blueprint = {};
  for (const { legacy, current } of OFFICIAL_MODULE_KEY_PAIRS) {
    assert.equal(resolveScreen(screenMap, current, '/', blueprint), screenMap[`${current}:/`]);
    assert.equal(resolveScreen(screenMap, legacy, '/', blueprint), screenMap[`${current}:/`]);
    assert.equal(hasBuiltInModule(screenMap, current), true);
  }
  const exact = {};
  screenMap['runly.core:/'] = exact;
  assert.equal(resolveScreen(screenMap, 'runly.core', '/', blueprint), exact);
  assert.equal(resolveScreen(screenMap, 'custom.core', '/list', blueprint), blueprint);
  assert.equal(hasBuiltInModule(screenMap, 'runly.unknown'), false);
  assert.equal(isPathAllowedByNavigation({ key: 'runly.core', navigation: [{ path: '/app/m/runly.core-other/admin' }] }, '/admin'), false);
});

test('parameterized built-in screens retain route matching under Runly keys', () => {
  const cases = [
    ['identity', '/identity/users/123/edit', '/identity/users/:id/edit'],
    ['files', '/files/123/edit', '/files/:id/edit'],
    ['fleet', '/vehicles/123', '/vehicles/:id'],
    ['inventory', '/inventory/123/edit', '/inventory/new'],
    ['chat', '/chat/inbox/123', '/chat/inbox'],
    ['notes', '/notes/recent', '/notes/recent'],
    ['website', '/pages/123/editor', '/pages/:id/editor'],
  ];
  for (const [module, path, route] of cases) {
    const screen = {};
    const map = { [`runly.${module}:${route}`]: screen };
    assert.equal(resolveScreen(map, `runly.${module}`, path), screen);
    assert.equal(resolveScreen(map, `atlas.${module}`, path), screen);
  }
});

test('runly.canvas opens a board at /:boardId, allowed by the root navigation entry', () => {
  const screenMap = { 'runly.canvas:/': 'home', 'runly.canvas:/:boardId': 'editor' };
  const module = { key: 'runly.canvas', navigation: [{ path: '/' }] };
  const boardPath = '/0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
  assert.equal(resolveScreen(screenMap, 'runly.canvas', '/', null), 'home');
  assert.equal(resolveScreen(screenMap, 'runly.canvas', boardPath, null), 'editor');
  assert.equal(isPathAllowedByNavigation(module, boardPath), true);
});
