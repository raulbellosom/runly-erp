import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { buildYDocSave, applyServerCatchUp } from '../ydocPersistence.js'
import { base64ToBytes, bytesToBase64 } from '../SupabaseYjsProvider.js'

describe('ydocPersistence', () => {
  it('sends only the diff past the server state vector', () => {
    const doc = new Y.Doc()
    doc.getText('t').insert(0, 'x'.repeat(5000))
    const serverSV = Y.encodeStateVector(doc)
    doc.getText('t').insert(0, 'nuevo')

    const save = buildYDocSave(doc, serverSV)
    assert.ok(base64ToBytes(save.update).length < 200)

    const server = new Y.Doc()
    Y.applyUpdate(server, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(server)))
    Y.applyUpdate(server, base64ToBytes(save.update))
    assert.equal(server.getText('t').toString(), doc.getText('t').toString())
  })

  it('applies the server catch-up from either response shape', () => {
    const peer = new Y.Doc()
    peer.getText('t').insert(0, 'de otro usuario')
    const missing = bytesToBase64(Y.encodeStateAsUpdate(peer))

    const doc = new Y.Doc()
    assert.equal(applyServerCatchUp(doc, { ok: true, missing }), true)
    assert.equal(doc.getText('t').toString(), 'de otro usuario')
    assert.equal(applyServerCatchUp(doc, { data: { ok: true } }), false)
  })
})
