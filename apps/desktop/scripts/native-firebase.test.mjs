import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareAndroidFirebase } from './native-firebase.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'atlas-firebase-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const app = join(root, 'app')
  mkdirSync(app)
  const config = { project_info: { project_id: 'test-project', project_number: '123' }, client: [{
    client_info: { mobilesdk_app_id: '1:123:android:test', android_client_info: { package_name: 'com.racoondevs.runlyerp' } },
    api_key: [{ current_key: 'public-test-key' }],
  }] }
  writeFileSync(join(root, 'android.json'), JSON.stringify(config))
  writeFileSync(join(root, '.env'), 'FIREBASE_PROJECT_ID=test-project\nATLAS_ANDROID_GOOGLE_SERVICES_JSON=android.json\nGOOGLE_APPLICATION_CREDENTIALS=server.json\n')
  return { root, app, config, destination: join(app, 'google-services.json') }
}

test('loads only Android configuration from root env without exporting server settings', (t) => {
  const f = fixture(t)
  const env = {}
  assert.equal(prepareAndroidFirebase(f.root, f.app, env), true)
  assert.deepEqual(JSON.parse(readFileSync(f.destination, 'utf8')), f.config)
  assert.deepEqual(env, {})
})

test('explicit empty environment overrides local config and removes stale build input', (t) => {
  const f = fixture(t)
  prepareAndroidFirebase(f.root, f.app, {})
  assert.equal(prepareAndroidFirebase(f.root, f.app, { ATLAS_ANDROID_GOOGLE_SERVICES_JSON: '' }), false)
  assert.equal(existsSync(f.destination), false)
})

test('Runly Android input wins conflicts and a legacy process override beats a Runly file value', t => {
  const f = fixture(t)
  writeFileSync(join(f.root, '.env'), 'FIREBASE_PROJECT_ID=test-project\nRUNLY_ANDROID_GOOGLE_SERVICES_JSON=android.json\n')
  assert.equal(prepareAndroidFirebase(f.root, f.app, { RUNLY_ANDROID_GOOGLE_SERVICES_JSON: 'android.json', ATLAS_ANDROID_GOOGLE_SERVICES_JSON: 'missing.json' }), true)
  assert.equal(prepareAndroidFirebase(f.root, f.app, { ATLAS_ANDROID_GOOGLE_SERVICES_JSON: '' }), false)
  assert.equal(existsSync(f.destination), false)
})

test('rejects server credentials even when a file also contains Android fields', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'android.json'), JSON.stringify({ ...f.config, private_key: 'test-private-material' }))
  assert.throws(() => prepareAndroidFirebase(f.root, f.app, {}), /Server credentials/)
  assert.equal(existsSync(f.destination), false)
})

test('rejects wrong project and wrong Android package', (t) => {
  const f = fixture(t)
  assert.throws(() => prepareAndroidFirebase(f.root, f.app, { FIREBASE_PROJECT_ID: 'another-project' }), /does not match/)
  f.config.client[0].client_info.android_client_info.package_name = 'wrong.package'
  writeFileSync(join(f.root, 'android.json'), JSON.stringify(f.config))
  assert.throws(() => prepareAndroidFirebase(f.root, f.app, {}), /com.racoondevs.runlyerp/)
  assert.equal(existsSync(f.destination), false)
})

test('malformed input is rejected without echoing its contents', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'android.json'), 'secret-invalid-json')
  assert.throws(() => prepareAndroidFirebase(f.root, f.app, {}), (error) =>
    error.message.includes('Cannot read') && !error.message.includes('secret-invalid-json'))
})
