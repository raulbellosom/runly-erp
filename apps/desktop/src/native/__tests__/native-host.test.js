import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { detectRuntime, isNativeMobile } from '@runly/core/native-runtime'
import { compareVersions, supportsCapability, parseDeepLink, createEventPump } from '../policy.js'
import { resolveEnvironment, makeConfig } from '../../../scripts/native-host.mjs'
import { nativeHostHeaders, NATIVE_CSP } from '../../../native-host/web-policy.js'

test('runtime distinguishes browser, PWA, Desktop, Android, iOS and missing bridge', () => {
  assert.equal(detectRuntime({}), 'web')
  assert.equal(detectRuntime({ navigator: { standalone: true } }), 'pwa')
  assert.equal(detectRuntime({ matchMedia: () => ({ matches: true }) }), 'pwa')
  assert.equal(detectRuntime({ __RUNLY_NATIVE_HOST__: { platform: 'android' } }), 'web')
  const bridge = { __TAURI_INTERNALS__: { invoke() {} } }
  assert.equal(detectRuntime(bridge), 'tauri-desktop')
  for (const platform of ['android', 'ios']) {
    const scope = { ...bridge, __RUNLY_NATIVE_HOST__: { platform } }
    assert.equal(detectRuntime(scope), `tauri-${platform}`)
    assert.equal(isNativeMobile(scope), true)
  }
})

test('release environment cannot be replaced by a user URL or development origin', () => {
  assert.equal(resolveEnvironment('production', 'https://evil.test', 'build'), 'https://app.example.com')
  assert.throws(() => resolveEnvironment('https://evil.test', null, 'build'))
  assert.throws(() => resolveEnvironment('development', 'http://10.0.2.2:5173', 'build'))
  for (const bad of ['https://evil.example', 'http://8.8.8.8', 'javascript:alert(1)', 'http://user:pass@localhost:5173', 'http://localhost:5173/app', 'http://localhost:5173/?url=evil']) {
    assert.throws(() => resolveEnvironment('development', bad, 'dev'))
  }
  assert.equal(resolveEnvironment('development', 'http://192.168.1.5:5173', 'dev'), 'http://192.168.1.5:5173')
})

test('production/staging origins can be overridden by the deployer\'s own environment variables', () => {
  process.env.RUNLY_NATIVE_PRODUCTION_URL = 'https://real-customer-instance.example'
  try {
    assert.equal(resolveEnvironment('production', null, 'build'), 'https://real-customer-instance.example')
  } finally {
    delete process.env.RUNLY_NATIVE_PRODUCTION_URL
  }
  // No env var set -> falls back to the checked-in placeholder, never a real instance.
  assert.equal(resolveEnvironment('production', null, 'build'), 'https://app.example.com')
})

test('remote capability is restricted to main, selected origin/app path, and minimal commands', () => {
  const config = makeConfig('https://app.example.com')
  const [shell, remote] = config.app.security.capabilities
  assert.equal(config.build.frontendDist, '../native-host/shell')
  assert.equal(config.build.devUrl, null)
  assert.equal(remote.local, false)
  assert.deepEqual(remote.windows, ['main'])
  assert.deepEqual(remote.remote.urls, ['https://app.example.com/app/*'])
  assert.ok(!remote.permissions.some((p) => /sql|store|shell|window|allow-host-connect|allow-host-confirm-origin|allow-host-forget-origin/.test(p)))
  assert.deepEqual(shell.permissions, ['allow-host-info', 'allow-host-connect', 'allow-host-confirm-origin', 'allow-host-forget-origin'])
  const desktop = JSON.parse(readFileSync(new URL('../../../src-tauri/tauri.conf.json', import.meta.url)))
  assert.equal(desktop.build.frontendDist, '../dist')
})

test('semantic versions and capability negotiation fail closed', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1)
  assert.equal(compareVersions('1.0.0+web.12', '1.0.0'), 0)
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1)
  assert.throws(() => compareVersions('latest', '1.0.0'))
  assert.throws(() => compareVersions('1.0.0-01', '1.0.0'))
  assert.throws(() => compareVersions('1.0.0-rc..1', '1.0.0'))
  const info = { nativeHostVersion: '1.2.0', bridgeVersion: 1, capabilities: ['haptics'] }
  assert.ok(supportsCapability(info, 'haptics', '1.1.0'))
  assert.equal(supportsCapability(info, 'push'), false)
  assert.equal(supportsCapability(info, 'haptics', '2.0.0'), false)
  assert.equal(supportsCapability({ ...info, bridgeVersion: 2 }, 'haptics'), false)
  assert.equal(supportsCapability(null, 'haptics'), false)
})

test('deep links accept only bounded chat/call IDs without tokens or redirects', () => {
  assert.deepEqual(parseDeepLink('runly://chat/abc-123'), { kind: 'chat', targetId: 'abc-123' })
  for (const value of ['https://app.example.com/app/', 'runly://call/a?token=secret', 'runly://evil/a', 'runly://call/a%2fb', 'runly://call/a/b', 'runly://user@chat/a', 'runly://chat/']) {
    assert.equal(parseDeepLink(value), null, value)
  }
})

test('events ACK only after successful delivery, including retries after mount', async () => {
  let queue = [{ id: 1, kind: 'call', targetId: 'abc' }]
  const pump = createEventPump({ read: async () => queue, acknowledge: async (ids) => { queue = queue.filter((e) => !ids.includes(e.id)) } })
  await pump(async () => false)
  assert.equal(queue.length, 1)
  await assert.rejects(pump(async () => { throw new Error('network') }))
  assert.equal(queue.length, 1)
  await pump(async (event) => { assert.equal(event.targetId, 'abc') })
  assert.equal(queue.length, 0)
})

test('event pump serializes concurrent ticks', async () => {
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  let delivered = 0
  const pump = createEventPump({ read: async () => [{ id: 1, kind: 'chat', targetId: 'abc' }], acknowledge: async () => {} })
  const first = pump(async () => { delivered++; await blocked })
  await pump(async () => { delivered++ })
  release()
  await first
  assert.equal(delivered, 1)
})

test('Vite applies frame restriction only to native host requests', () => {
  let middleware
  nativeHostHeaders().configureServer({ middlewares: { use: (value) => { middleware = value } } })
  for (const [agent, expected] of [['Browser', undefined], ['Mozilla RunlyNativeHost/1.0', NATIVE_CSP]]) {
    const headers = {}
    middleware({ headers: { 'user-agent': agent } }, { setHeader: (k, v) => { headers[k] = v } }, () => {})
    assert.equal(headers['Content-Security-Policy'], expected)
  }
})

test('fallback stops auto retries after failed navigation and retries on explicit action', async () => {
  const nodes = Object.fromEntries(['status', 'retry', 'diagnostics', 'connect-form', 'origin-input', 'confirm-panel', 'confirm-origin', 'confirm-button', 'cancel-button', 'forget-link'].map((id) => [id, { textContent: '', value: '', addEventListener(_type, cb) { this.click = cb } }]))
  let attempts = 0
  const context = {
    document: { getElementById: (id) => nodes[id] }, location: { hash: '#failed' }, navigator: { onLine: false },
    window: { __TAURI_INTERNALS__: { invoke: async (command) => {
      if (command === 'host_info') return { nativeHostVersion: '1.0.0', platform: 'android', osVersion: '14', frontendUrl: 'https://app.example.com/app/' }
      attempts++; throw 'NETWORK_TLS_OR_TIMEOUT'
    } } },
  }
  vm.runInNewContext(readFileSync(new URL('../../../native-host/shell/shell.js', import.meta.url), 'utf8'), context)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(attempts, 0)
  assert.match(nodes.status.textContent, /No se pudo conectar/)
  await nodes.retry.click()
  assert.equal(attempts, 1)
  assert.equal(nodes.retry.hidden, false)
  assert.match(nodes.diagnostics.textContent, /NETWORK_TLS_OR_TIMEOUT/)
})
