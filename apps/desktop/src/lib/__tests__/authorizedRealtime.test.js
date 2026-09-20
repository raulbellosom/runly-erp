import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorizeRealtimeClient } from '../authorizedRealtime.js'

test('protected sockets rotate grants, relay every write and stop all timers on logout', async () => {
  const original = { fetch: globalThis.fetch, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval }
  const timers = new Set(), sockets = [], requests = []
  let revision = '1', allowed = true
  globalThis.setInterval = (fn) => { timers.add(fn); return fn }
  globalThis.clearInterval = (fn) => timers.delete(fn)
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options })
    return { ok: !options.body || allowed, json: async () => ({ revision, data: {} }) }
  }
  const client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-only' } } }) },
    channel: (topic) => {
      const socket = { topic: `realtime:${topic}`, on() { return socket }, subscribe() { return socket }, send() { assert.fail('native sends bypass authorization') } }
      sockets.push(socket)
      return socket
    },
    getChannels: () => sockets,
    removeChannel: async (socket) => { sockets.splice(sockets.indexOf(socket), 1); return 'ok' },
  }
  try {
    authorizeRealtimeClient(client)
    const channel = client.channel('chat:presence:room').subscribe()
    await new Promise(setImmediate)
    assert.equal(sockets[0].topic, 'realtime:chat:presence:room@1')
    revision = '2'
    await Promise.all([...timers].map((fn) => fn()))
    assert.equal(sockets.length, 1)
    assert.equal(sockets[0].topic, 'realtime:chat:presence:room@2')
    assert.equal(await channel.send({ event: 'typing', payload: { isTyping: true } }), 'ok')
    assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer fixture-only')
    allowed = false
    assert.equal(await channel.send({ event: 'typing', payload: {} }), 'error')
    await client.removeAllChannels()
    assert.equal(timers.size, 0)
    assert.equal(sockets.length, 0)
    assert.equal(client.getChannels().length, 0)
  } finally {
    await client.removeAllChannels()
    Object.assign(globalThis, original)
  }
})
