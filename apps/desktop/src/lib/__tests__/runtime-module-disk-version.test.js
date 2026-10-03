import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeRuntimeModules } from '../runtime-modules-core.js';

const row = (extra) => ({ key: 'custom.prestamos', status: 'INSTALLED', enabled: true, version: '1.1.1', manifest: { version: '1.1.1' }, ...extra });
const staleBundle = { key: 'custom.prestamos', version: '1.0.0', migrations: [{ path: 'a.sql', checksum: 'x' }] };

test('custom modules compare the installed version with the disk version, not the stale bundled manifest', () => {
  const [synced] = mergeRuntimeModules([row({ diskVersion: '1.1.1' })], { manifests: [staleBundle] });
  assert.equal(synced.updateAvailable, false);
  const [pending] = mergeRuntimeModules([row({ diskVersion: '1.2.0' })], { manifests: [staleBundle] });
  assert.equal(pending.updateAvailable, true);
  assert.equal(pending.updateReason, 'version');
});

test('without a disk version the bundled manifest still decides', () => {
  const [module] = mergeRuntimeModules([row()], { manifests: [staleBundle] });
  assert.equal(module.updateAvailable, true);
});
