import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import * as engine from '@runly/module-engine'
import * as legacy from '@atlas/module-engine'
import * as browser from '@runly/module-engine/browser'
import * as server from '@runly/module-engine/server'
import * as compiler from '@runly/module-compiler/server'
import { SERVICE_KEYS, DOMAIN_EVENTS, RME3_CONTRACT_VERSION } from '@runly/module-engine/contracts'
import { RME3_CAPABILITIES } from '../contracts.js'

test('browser entries bundle with no Node builtins, filesystem, Buffer shims or ERP core', async () => {
  const result = await build({
    stdin: { contents: `export * as engine from '@runly/module-engine/browser'; export * as compiler from '@runly/module-compiler/browser'`, resolveDir: import.meta.dirname },
    bundle: true, platform: 'browser', format: 'esm', write: false, metafile: true,
  })
  assert.doesNotMatch(result.outputFiles[0].text, /\bBuffer\b|node:crypto|node:fs|@runly\/core|developer-docs\.json/)
  assert.ok(Object.keys(result.metafile.inputs).every((path) => !/apps\/|packages\/core\//.test(path)))
})

test('old root/server and Atlas declarations retain identical functions', () => {
  assert.equal(engine.defineRunlyModule, browser.defineRunlyModule)
  assert.equal(legacy.defineAtlasModule, browser.defineRunlyModule)
  assert.equal(server.createChecksum, engine.createChecksum)
  assert.equal(server.ModuleRegistry, engine.ModuleRegistry)
  assert.equal(typeof compiler.compileModule, 'function')
  assert.equal(browser.createChecksum, undefined)
  assert.equal(RME3_CONTRACT_VERSION, 1)
})

test('runtime capability inventory matches actual ERP externals and integrations', async () => {
  const { BUNDLE_EXTERNALS } = await import('../../../../packages/preview-runtime/src/externals.js')
  assert.deepEqual([...BUNDLE_EXTERNALS].sort(), [...RME3_CAPABILITIES.runtime.sharedExternals].sort())
  const catalog = (await Promise.all(['service-catalog.js', 'action-backed-services.js'].map((file) => readFile(new URL(`../../../../apps/api/src/services/module-services/${file}`, import.meta.url), 'utf8')))).join('\n')
  assert.deepEqual([...catalog.matchAll(/^    '(runly\.[^']+:[^']+)':/gm)].map((m) => m[1]).sort(), [...SERVICE_KEYS].sort())
  const events = await import('../../../../apps/api/src/services/domain-events/events.js')
  assert.equal(events.DOMAIN_EVENTS, DOMAIN_EVENTS)
  assert.equal(RME3_CAPABILITIES.runtime.previewAvailable, false)
})
