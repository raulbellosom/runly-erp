import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rowFingerprint, dedupeIntraFile, findAccountCandidates } from '../ai-import-dedup.js'

describe('rowFingerprint', () => {
  it('produces the same fingerprint for the same date+amount+name regardless of casing/whitespace', () => {
    const a = rowFingerprint({ fecha: '2026-03-27', nombre: '  Autopartes Salav  ', deposito: null, retiro: 15768.96 })
    const b = rowFingerprint({ fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV', deposito: null, retiro: 15768.96 })
    assert.equal(a, b)
  })

  it('produces different fingerprints for different amounts', () => {
    const a = rowFingerprint({ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 100 })
    const b = rowFingerprint({ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 200 })
    assert.notEqual(a, b)
  })
})

describe('dedupeIntraFile', () => {
  it('collapses the same movement represented twice in one document (the two-page statement case)', () => {
    const rows = [
      { fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV ROSHFRANS SA DE CV', referencia: 'PLA A CUENTA ACEITE', deposito: null, retiro: 15768.96 },
      { fecha: '2026-03-27', nombre: '  autopartes salav roshfrans sa de cv  ', referencia: 'GUIA:4252746', deposito: null, retiro: 15768.96 },
    ]
    const result = dedupeIntraFile(rows)
    assert.equal(result.length, 1)
  })

  it('keeps two rows with the same amount but different dates', () => {
    const rows = [
      { fecha: '2026-03-25', nombre: 'PROVEEDOR X', deposito: null, retiro: 500 },
      { fecha: '2026-04-25', nombre: 'PROVEEDOR X', deposito: null, retiro: 500 },
    ]
    assert.equal(dedupeIntraFile(rows).length, 2)
  })
})

describe('findAccountCandidates', () => {
  const accounts = [
    { id: 'acc-1', name: 'BBVA Operativa', bank: 'BBVA', account_number: '0163769917' },
    { id: 'acc-2', name: 'Santander Nomina', bank: 'Santander', account_number: '0044556677' },
  ]

  it('matches by account number suffix printed in the document', () => {
    const result = findAccountCandidates({ accounts, documentText: 'Cta BBVB .xxxx9917 S.P.d.l.P' })
    assert.equal(result.detected?.id, 'acc-1')
  })

  it('returns no detected account and all candidates when nothing matches', () => {
    const result = findAccountCandidates({ accounts, documentText: 'no account info here' })
    assert.equal(result.detected, null)
    assert.equal(result.candidates.length, 2)
  })
})
