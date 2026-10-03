import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveRecordLabel } from '../record-label.js'

const ID = '01a1029d-3bfa-781e-ad22-f17f5ad553a7'
const DETAIL = { schema: { sections: [{ fields: [{ field: 'articulo', type: 'relation' }, { field: 'certificado', type: 'text' }, { field: 'fecha', type: 'date' }] }] } }

describe('resolveRecordLabel', () => {
  it('prefers well-known name keys', () => {
    assert.equal(resolveRecordLabel({ id: ID, nombre: 'Visita a Ana' }), 'Visita a Ana')
  })

  it('uses the first text field of the blueprint, never the relation id', () => {
    assert.equal(resolveRecordLabel({ id: ID, articulo: ID, certificado: 'PVR-CERT-1239' }, [DETAIL]), 'PVR-CERT-1239')
  })

  it('honors a declared title field', () => {
    assert.equal(resolveRecordLabel({ id: ID, folio: '', codigo_interno: 'X-1' }, { schema: { hero: { titleField: 'codigo_interno' } } }), 'X-1')
  })

  it('falls back to a relation label, then null — never a UUID', () => {
    assert.equal(resolveRecordLabel({ id: ID, articulo: ID, articulo__label: 'Asus TUF 15 · INV-2026-0001' }, [DETAIL]), 'Asus TUF 15 · INV-2026-0001')
    assert.equal(resolveRecordLabel({ id: ID, articulo: ID }, [DETAIL]), null)
    assert.equal(resolveRecordLabel({ id: ID, name: ID }), null)
  })
})
