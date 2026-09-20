import { getApiUrl } from './runtimeConfig.js'

const protectedTopic = /^(?:note:(?:ydoc|canvas):|chat:(?:presence|conv|company):|company:|user:)/
const installed = new WeakSet()

// Keep the Supabase channel API used by existing modules. Broadcasts still use
// Supabase; writes/presence pass through Hono to avoid cached socket grants.
export function authorizeRealtimeClient(client) {
  if (installed.has(client)) return client
  installed.add(client)
  const nativeChannel = client.channel.bind(client)
  const nativeRemove = client.removeChannel.bind(client)
  const nativeChannels = client.getChannels.bind(client)
  const channels = new Set()

  async function request(path, body) {
    const session = body ? await client.auth.getSession() : null
    const token = session?.data?.session?.access_token
    const response = await fetch(`${getApiUrl()}/realtime/${path}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Recurso no disponible')
    return response.json()
  }

  client.channel = (topic, options) => {
    if (!protectedTopic.test(topic)) return nativeChannel(topic, options)
    const bindings = []
    let socket, currentRevision, callback, timer, closed = false, busy = false
    let tracked = false, presence = {}
    const sender = crypto.randomUUID()
    const emitPresence = (event, payload) => bindings.filter(([type, filter]) => type === 'presence' && filter.event === event).forEach(([, , fn]) => fn(payload))
    const wrapper = {
      topic: `realtime:${topic}`,
      get state() { return socket?.state ?? 'closed' },
      on(type, filter, fn) { bindings.push([type, filter, fn]); return wrapper },
      presenceState() { return presence },
      async track() { tracked = true; await heartbeat(); return 'ok' },
      async untrack() {
        tracked = false
        await request('presence', { topic, leave: true }).catch(() => {})
        return 'ok'
      },
      async send({ event, payload }) {
        if (closed) return 'error'
        try {
          await request('broadcast', { topic, event, payload: { ...payload, __runlySender: sender } })
          return 'ok'
        } catch { return 'error' }
      },
      subscribe(fn) {
        callback = fn
        refresh()
        timer = setInterval(refresh, 10_000)
        return wrapper
      },
      async unsubscribe() {
        closed = true
        clearInterval(timer)
        channels.delete(wrapper)
        if (tracked) await wrapper.untrack()
        return socket ? nativeRemove(socket) : 'ok'
      },
    }

    async function heartbeat() {
      if (!tracked || closed) return
      try {
        const { data } = await request('presence', { topic })
        if (closed) return
        const left = Object.keys(presence).filter((id) => !data[id]).flatMap((id) => presence[id])
        presence = data
        emitPresence('sync', {})
        if (left.length) emitPresence('leave', { leftPresences: left })
      } catch {
        presence = {}
        emitPresence('sync', {})
      }
    }

    async function refresh() {
      if (closed || busy) return
      busy = true
      try {
        const { revision } = await request('revision')
        if (closed) return
        if (currentRevision !== revision) {
          if (socket) await nativeRemove(socket)
          if (closed) return
          currentRevision = revision
          socket = nativeChannel(`${topic}@${revision}`, { ...options, config: { ...options?.config, private: true } })
          for (const [type, filter, fn] of bindings) {
            if (type === 'presence') continue
            socket.on(type, filter, (message) => {
              if (closed) return
              if (options?.config?.broadcast?.self !== true && message.payload?.__runlySender === sender) return
              fn(message)
            })
          }
          socket.subscribe((status, error) => { if (!closed) callback?.(status, error) })
        }
        await heartbeat()
      } catch { if (!closed) callback?.('CHANNEL_ERROR') }
      finally { busy = false }
    }
    channels.add(wrapper)
    return wrapper
  }
  client.removeChannel = (channel) => channels.has(channel) ? channel.unsubscribe() : nativeRemove(channel)
  client.removeAllChannels = () => Promise.all([...client.getChannels()].map((channel) => client.removeChannel(channel)))
  client.getChannels = () => [...nativeChannels().filter((ch) => !protectedTopic.test(ch.topic.replace(/^realtime:/, ''))), ...channels]
  return client
}
