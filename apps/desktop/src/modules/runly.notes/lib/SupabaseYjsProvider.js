import { authorizeRealtimeClient } from '../../../lib/authorizedRealtime.js'
// apps/desktop/src/modules/runly.notes/lib/SupabaseYjsProvider.js
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'

// btoa(String.fromCharCode(...bytes)) blows the call stack once a Y.js update or
// full-document state grows past ~100 KB. Encode in fixed-size chunks instead.
const B64_CHUNK = 0x8000

export function bytesToBase64(bytes) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + B64_CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(b64) {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// GET /notes/:id/ydoc responds with { data: { state, version } } (Hono route
// wraps the service result), while the service itself and older shapes hand back
// a bare { state }. Reading `res.state` directly always saw `undefined` against
// the live API, so the persisted Y.js document was never applied on reload and
// the collaborative editor mounted blank. Accept both shapes.
export function extractServerYState(res) {
  const payload = res && typeof res === 'object' && res.data != null ? res.data : res
  const state = payload?.state
  return typeof state === 'string' && state.length > 0 ? state : null
}

export class SupabaseYjsProvider {
  // publicSlug + readOnly: the public note page (no session/token, anon
  // Supabase client) uses this to join the same `note:ydoc:<id>` topic as the
  // authenticated editor, receive-only. See note_ydoc_receive's anon branch
  // (migration 20260919120000_notes_ydoc_public_realtime) — sending stays
  // authenticated-only, so a readOnly provider never attempts to broadcast.
  constructor(ydoc, { noteId, supabase, runly, token, publicSlug, readOnly = false, onSynced, onStatus }) {
    this.ydoc = ydoc
    this.noteId = noteId
    this.synced = false
    // Whether the realtime channel has actually joined. Until it has, send()
    // silently falls back to the REST broadcast endpoint (Supabase logs a
    // deprecation warning for that), so we hold local broadcasts until join.
    this.connected = false
    // Whether the server already had persisted Y.js state for this note. When
    // false, the note's content still lives only in the legacy `notes.content`
    // HTML column and the editor must seed the empty ydoc from it once.
    this.hadServerState = false
    this.awareness = new awarenessProtocol.Awareness(ydoc)
    this._supabase = authorizeRealtimeClient(supabase)
    this._readOnly = readOnly
    this._publicSlug = publicSlug
    this._channel = null
    this._updateHandler = null
    this._awarenessHandler = null
    this._onSynced = onSynced
    this._onStatus = onStatus
    // Set by destroy(). _init is async and can still be mid-flight (or not
    // started) when the owning component unmounts — switching notes tears a
    // provider down within the same tick it was created. Every step of _init
    // bails if this is set, so a torn-down provider never subscribes a channel
    // or attaches doc listeners that would then leak.
    this._destroyed = false

    this._init(runly, token)
  }

  get _topic() {
    return `note:ydoc:${this.noteId}`
  }

  async _init(runly, token) {
    // 1. Load persisted server state
    try {
      const res = this._publicSlug
        ? await runly.notes.getPublicYDoc(this._publicSlug)
        : await runly.notes.getYDoc(this.noteId, token)
      const serverState = extractServerYState(res)
      if (serverState) {
        Y.applyUpdate(this.ydoc, base64ToBytes(serverState), 'server-load')
        this.hadServerState = true
        console.debug(
          `[notes/yjs] loaded server state (${serverState.length} b64 chars), ` +
            `fragment length=${this.ydoc.getXmlFragment('default').length}`,
        )
      } else {
        console.debug('[notes/yjs] no server Y.js state for this note')
      }
    } catch (err) {
      console.debug('[notes/yjs] getYDoc failed:', err?.message ?? err)
    }

    if (this._destroyed) return

    this.synced = true
    this._onSynced?.()

    // 2. Reuse of a channel topic that is still registered on the client returns
    //    the STALE object — calling .on()/.subscribe() on it is a no-op and
    //    realtime silently never connects. This happens on every note switch and
    //    under React strict-mode double-mount. Drop any stale channel first.
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

    // 3. Subscribe to the realtime broadcast channel. private: true enables
    // Supabase Realtime Authorization — the server evaluates the
    // note_ydoc_receive/note_ydoc_send RLS policies (migration
    // 20260911130000_notes_realtime_authorization_fix) before letting this
    // client join or send at all, instead of "unguessable UUID" being the
    // only thing standing between a stranger and someone else's note.
    this._channel = this._supabase.channel(this._topic, {
      config: { broadcast: { self: false, ack: false }, private: true },
    })

    this._channel
      .on('broadcast', { event: 'ydoc.update' }, ({ payload }) => {
        try {
          Y.applyUpdate(this.ydoc, base64ToBytes(payload.update), 'broadcast')
          console.debug('[notes/yjs] applied remote ydoc.update')
        } catch (err) {
          console.warn('[notes/yjs] bad ydoc.update payload:', err?.message ?? err)
        }
      })
      .on('broadcast', { event: 'awareness.update' }, ({ payload }) => {
        try {
          awarenessProtocol.applyAwarenessUpdate(
            this.awareness,
            base64ToBytes(payload.update),
            'broadcast',
          )
        } catch (err) {
          console.warn('[notes/yjs] bad awareness.update payload:', err?.message ?? err)
        }
      })
      .subscribe((status, err) => {
        if (this._destroyed) return
        this._onStatus?.(status)
        if (status === 'SUBSCRIBED') {
          this.connected = true
          console.info(`[notes/yjs] realtime connected: ${this._topic}`)
          // Catch every peer up with our full doc + awareness state. Y.js
          // updates are commutative/idempotent, so a full-state broadcast on
          // (re)connect is how late joiners and post-dropout clients converge.
          // A readOnly (public) provider never sends — note_ydoc_send stays
          // authenticated-only, so this would just be rejected by RLS anyway.
          if (!this._readOnly) {
            this._broadcastFullState()
            this._broadcastAwareness([...this.awareness.getStates().keys()])
          }
        } else if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          this.connected = false
          if (err) {
            console.warn(`[notes/yjs] channel ${status}:`, err?.message ?? err)
          }
        }
      })

    // 4. Broadcast local doc updates to peers. Skipped entirely in readOnly
    // mode (public view) — it never has local edits to broadcast, and
    // note_ydoc_send would reject an anon sender anyway.
    if (!this._readOnly) {
      this._updateHandler = (update, origin) => {
        if (origin === 'server-load' || origin === 'broadcast') return
        this._send('ydoc.update', bytesToBase64(update))
      }
      this.ydoc.on('update', this._updateHandler)

      // 5. Broadcast awareness (cursor) changes to peers. Skip changes that came
      //    in FROM a peer — applyAwarenessUpdate re-fires 'update' with
      //    origin 'broadcast' and echoing those would loop.
      this._awarenessHandler = ({ added, updated, removed }, origin) => {
        if (origin === 'broadcast') return
        this._broadcastAwareness([...added, ...updated, ...removed])
      }
      this.awareness.on('update', this._awarenessHandler)
    }
  }

  _send(event, encoded) {
    // Before the socket has joined, channel.send() falls back to a REST POST
    // (deprecated + unreliable for fan-out). Skip it — _broadcastFullState on
    // SUBSCRIBED replays whatever was missed.
    if (!this._channel || this._channel.state !== 'joined') return
    this._channel.send({ type: 'broadcast', event, payload: { update: encoded } })
  }

  _broadcastFullState() {
    this._send('ydoc.update', bytesToBase64(Y.encodeStateAsUpdate(this.ydoc)))
  }

  _broadcastAwareness(clientIds) {
    if (!clientIds || clientIds.length === 0) return
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, clientIds)
    this._send('awareness.update', bytesToBase64(update))
  }

  setAwarenessField(field, value) {
    this.awareness.setLocalStateField(field, value)
  }

  destroy() {
    this._destroyed = true
    this.connected = false
    // Broadcast local-state removal first (while _awarenessHandler is still
    // attached) so peers see this user's presence disappear immediately,
    // instead of lingering until their own connection times out.
    this.awareness.setLocalState(null)
    if (this._updateHandler) this.ydoc.off('update', this._updateHandler)
    if (this._awarenessHandler) this.awareness.off('update', this._awarenessHandler)
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      [this.ydoc.clientID],
      'provider-destroy',
    )
    this.awareness.destroy()
    // removeChannel (not just unsubscribe) so channel() does not hand back this
    // dead object on the next mount for the same note.
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
