import { authorizeRealtimeClient } from '../../../lib/authorizedRealtime.js'
import { reconcileElements } from '@excalidraw/excalidraw'
import { diffElements, throttle } from './canvasSync.js'

// Realtime transport for a canvas note. Excalidraw-native (no Yjs): broadcasts
// changed elements and reconciles incoming ones by version. Mirrors the
// lifecycle discipline of SupabaseYjsProvider — _destroyed guard, drop a stale
// channel before subscribing, never send before the socket has joined,
// removeChannel on destroy.
export class SupabaseCanvasSync {
  constructor({
    noteId,
    supabase,
    identity, // { id, name, color, avatarUrl } — omitted/anon for the public view
    readOnly = false,
    getLocalElements, // () => Element[]  (the CanvasEditor ref contents)
    getSnapshot, // () => ({ elements, layers, appState, files })
    onRemoteElements, // (reconciled: Element[]) => void
    onRemoteSnapshot, // ({ elements, layers, appState, files }) => void
    onRemoteFiles, // (manifestSubset) => void
    onRemoteLayers, // (layers: Layer[]) => void
    onRemotePointer, // ({ senderId, x, y, selectedElementIds, user }) => void
    onPresence, // (list) => void
    onStatus, // (status) => void
  }) {
    this.noteId = noteId
    this._supabase = authorizeRealtimeClient(supabase)
    this._identity = identity ?? { id: `anon-${Math.random().toString(36).slice(2)}` }
    this._readOnly = readOnly
    this._getLocalElements = getLocalElements
    this._getSnapshot = getSnapshot
    this._onRemoteElements = onRemoteElements
    this._onRemoteSnapshot = onRemoteSnapshot
    this._onRemoteFiles = onRemoteFiles
    this._onRemoteLayers = onRemoteLayers
    this._onRemotePointer = onRemotePointer
    this._onPresence = onPresence
    this._onStatus = onStatus

    this._channel = null
    this._destroyed = false
    this._connected = false
    this._sentVersions = new Map()

    this._sendDeltaThrottled = throttle(() => this._flushDelta(), 200)
    this._sendLayersThrottled = throttle((layers) => this._rawSend('scene.layers', { layers, senderId: this._identity.id }), 200)
    this._sendPointerThrottled = throttle((p) => this._rawSend('pointer', p), 50)

    this._init()
  }

  get _topic() {
    return `note:canvas:${this.noteId}`
  }

  _init() {
    const stale = this._supabase
      .getChannels()
      .find((ch) => ch.topic === `realtime:${this._topic}`)
    if (stale) {
      try {
        this._supabase.removeChannel(stale)
      } catch (_) {
        /* already gone */
      }
    }

    // private: true enables Supabase Realtime Authorization — the server
    // evaluates the note_canvas_receive/note_canvas_send RLS policies
    // (migration 20260911130000_notes_realtime_authorization_fix), which
    // allow the public read-only view through for a published note and
    // otherwise require ownership/a share, instead of relying on the note's
    // UUID being unguessable.
    this._channel = this._supabase.channel(this._topic, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: this._identity.id },
        private: true,
      },
    })

    this._channel
      .on('broadcast', { event: 'scene.delta' }, ({ payload }) => this._applyIncoming(payload?.elements))
      .on('broadcast', { event: 'scene.full' }, ({ payload }) => {
        if (payload && this._onRemoteSnapshot) this._onRemoteSnapshot(payload)
      })
      .on('broadcast', { event: 'scene.request' }, () => this._answerRequest())
      .on('broadcast', { event: 'scene.files' }, ({ payload }) => {
        if (payload?.files && this._onRemoteFiles) this._onRemoteFiles(payload.files)
      })
      .on('broadcast', { event: 'scene.layers' }, ({ payload }) => {
        if (Array.isArray(payload?.layers) && this._onRemoteLayers) this._onRemoteLayers(payload.layers)
      })
      .on('broadcast', { event: 'pointer' }, ({ payload }) => {
        if (payload && this._onRemotePointer) this._onRemotePointer(payload)
      })
      .on('presence', { event: 'sync' }, () => {
        if (!this._onPresence || !this._channel) return
        const state = this._channel.presenceState()
        const list = Object.values(state).flat().map((m) => m.user).filter(Boolean)
        this._onPresence(list)
      })
      .subscribe(async (status) => {
        if (this._destroyed) return
        this._onStatus?.(status)
        if (status === 'SUBSCRIBED') {
          this._connected = true
          try {
            await this._channel.track({ user: this._pubIdentity() })
          } catch (_) {
            /* presence best-effort */
          }
          // Pull current state from peers, and (as an editor holding state)
          // offer ours.
          this._rawSend('scene.request', { senderId: this._identity.id })
          if (!this._readOnly) this._broadcastFull()
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) {
          this._connected = false
        }
      })
  }

  _pubIdentity() {
    const { id, name, color, avatarUrl } = this._identity
    return { id, name, color, avatarUrl }
  }

  _rawSend(event, payload) {
    if (!this._channel || this._channel.state !== 'joined') return
    this._channel.send({ type: 'broadcast', event, payload })
  }

  _applyIncoming(incoming) {
    if (!Array.isArray(incoming) || incoming.length === 0) return
    const local = this._getLocalElements?.() ?? []
    const reconciled = reconcileElements(local, incoming, {})
    // Treat the reconciled state as already-broadcast so the onChange this
    // triggers locally does not echo the same elements straight back out.
    for (const el of reconciled) {
      if (el && el.id != null) this._sentVersions.set(el.id, el.version ?? 0)
    }
    this._onRemoteElements?.(reconciled)
  }

  _answerRequest() {
    if (this._readOnly) return
    this._broadcastFull()
  }

  _broadcastFull() {
    const snap = this._getSnapshot?.()
    if (!snap) return
    this._rawSend('scene.full', { ...snap, senderId: this._identity.id })
  }

  _flushDelta() {
    if (this._readOnly) return
    const els = this._getLocalElements?.() ?? []
    const { changed, nextMap } = diffElements(this._sentVersions, els)
    this._sentVersions = nextMap
    if (changed.length === 0) return
    this._rawSend('scene.delta', { elements: changed, senderId: this._identity.id })
  }

  // Push newly-uploaded image manifest entries so peers (and the public view)
  // can fetch and render them — deltas only carry elements, not file bytes.
  broadcastFiles(manifestSubset) {
    if (this._readOnly || !manifestSubset || !Object.keys(manifestSubset).length) return
    this._rawSend('scene.files', { files: manifestSubset, senderId: this._identity.id })
  }

  // Layer metadata (name/order/visible/locked/opacity/color) lives outside the
  // elements array, so it never rides the scene.delta version-diff — without
  // this, already-connected peers only ever see it once, at join time (full
  // snapshot), and creating/renaming/reordering/deleting a layer looks like it
  // never left the tab that made the change.
  broadcastLayers(layers) {
    if (this._readOnly || !Array.isArray(layers)) return
    this._sendLayersThrottled(layers)
  }

  // Called by CanvasEditor after every local onChange.
  notifyLocalChange() {
    if (this._readOnly) return
    this._sendDeltaThrottled()
  }

  broadcastPointer(p) {
    if (this._readOnly) return
    this._sendPointerThrottled({ ...p, senderId: this._identity.id, user: this._pubIdentity() })
  }

  destroy() {
    this._destroyed = true
    this._connected = false
    if (this._channel) {
      try {
        this._supabase.removeChannel(this._channel)
      } catch (_) {
        /* already gone */
      }
      this._channel = null
    }
  }
}
