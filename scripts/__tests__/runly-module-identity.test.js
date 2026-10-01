import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CURRENT_ONLY_OFFICIAL_MODULE_KEYS, OFFICIAL_MODULE_KEY_PAIRS, getModuleKeyAliases, findModuleByKey, resolveModuleAliasPath } from '../../packages/core/src/module-identity.js';
import { ModuleRegistry as CoreRegistry } from '@runly/core';
import { ModuleRegistry as EngineRegistry } from '@runly/module-engine';
import { coreModules } from '../../apps/api/src/manifests/official/core-modules.js';

test('alias and current-only catalogs cover exactly the official manifest keys', () => {
  assert.deepEqual([...OFFICIAL_MODULE_KEY_PAIRS.map(pair => pair.current), ...CURRENT_ONLY_OFFICIAL_MODULE_KEYS].sort(), coreModules.map(module => module.key).sort());
  for (const pair of OFFICIAL_MODULE_KEY_PAIRS) assert.deepEqual(getModuleKeyAliases(pair.current), [pair.current, pair.legacy]);
  for (const key of CURRENT_ONLY_OFFICIAL_MODULE_KEYS) assert.deepEqual(getModuleKeyAliases(key), [key]);
  for (const key of ['custom.fleet', 'atlas.unknown', 'runly.unknown', 'runly.core.extra', 'runly.core:Table', ' runly.core']) assert.deepEqual(getModuleKeyAliases(key), [key]);
});

test('both registries resolve the same object and preserve exact-match collisions', () => {
  for (const Registry of [CoreRegistry, EngineRegistry]) {
    const registry = new Registry();
    const legacy = Object.freeze({ key: 'atlas.core' });
    const current = Object.freeze({ key: 'runly.core', enabled: false });
    registry.register(legacy);
    assert.equal(registry.get('runly.core'), legacy);
    assert.equal(registry.list().length, 1);
    registry.register(current);
    assert.equal(registry.get('runly.core'), current);
    assert.equal(registry.get('atlas.core'), legacy);
    assert.equal(registry.list().length, 2);
    assert.throws(() => registry.register(legacy));
  }
  const engine = new EngineRegistry();
  engine.register({ key: 'atlas.company' });
  assert.equal(engine.has('runly.company'), true);
  engine.unregister('runly.company');
  assert.equal(engine.has('atlas.company'), false);
});

test('core dependency checks and module URL lookup use aliases without editing manifests', () => {
  const registry = new CoreRegistry();
  registry.register({ key: 'atlas.core' });
  registry.register({ key: 'custom.example', dependencies: [{ key: 'runly.core' }] });
  assert.doesNotThrow(() => registry.assertDependencies());
  assert.equal(registry.getModuleByPath('/app/m/runly.core/settings').key, 'atlas.core');
});

test('module URL resolution keeps suffix/query/hash and never invents visible modules', () => {
  const visible = new Map([['atlas.contacts', { key: 'atlas.contacts' }]]);
  assert.equal(resolveModuleAliasPath(visible, '/app/m/runly.contacts/contacts/123?tab=files#last'), '/app/m/atlas.contacts/contacts/123?tab=files#last');
  assert.equal(resolveModuleAliasPath(visible, '/app/m/runly%2Econtacts/contacts/123'), '/app/m/atlas.contacts/contacts/123');
  assert.equal(resolveModuleAliasPath(visible, '/app/m/runly%ZZcontacts'), '/app/m/runly%ZZcontacts');
  assert.equal(resolveModuleAliasPath(visible, '/app/m/runly.identity/users'), '/app/m/runly.identity/users');
  assert.equal(findModuleByKey(visible, 'runly.identity'), undefined);
  assert.equal(resolveModuleAliasPath(visible, 'https://elsewhere.example/app/m/runly.contacts'), 'https://elsewhere.example/app/m/runly.contacts');
  visible.set('runly.contacts', { key: 'runly.contacts', enabled: false });
  assert.equal(findModuleByKey(visible, 'runly.contacts').enabled, false);
  assert.equal(resolveModuleAliasPath(visible, '/app/m/runly.contacts'), '/app/m/runly.contacts');
});
