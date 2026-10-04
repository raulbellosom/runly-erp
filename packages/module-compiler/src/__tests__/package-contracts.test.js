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
  const bundler = await readFile(new URL('../../../../apps/api/src/services/module-bundler-service.js', import.meta.url), 'utf8')
  const externals = bundler.match(/const BUNDLE_EXTERNALS = \[([\s\S]*?)\]/)?.[1]
  assert.ok(externals)
  assert.deepEqual([...externals.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort(), [...RME3_CAPABILITIES.runtime.sharedExternals].sort())
  const catalog = await readFile(new URL('../../../../apps/api/src/services/module-services/service-catalog.js', import.meta.url), 'utf8')
  assert.deepEqual([...catalog.matchAll(/^    '(runly\.[^']+:[^']+)':/gm)].map((m) => m[1]).sort(), [...SERVICE_KEYS].sort())
  const events = await import('../../../../apps/api/src/services/domain-events/events.js')
  assert.equal(events.DOMAIN_EVENTS, DOMAIN_EVENTS)
  assert.equal(RME3_CAPABILITIES.runtime.previewAvailable, false)
})
