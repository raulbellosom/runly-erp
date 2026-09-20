import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rowFingerprint, dedupeIntraFile, markDbDuplicates, findAccountCandidates } from '../ai-import-dedup.js'

describe('rowFingerprint', () => {
  it('produces the same fingerprint for the same date+amount even when the name text differs (the two-page statement case)', () => {
    // Real motivating case: the same movement printed twice in one document
    // under two different bank report formats, with two different name
    // strings for the same counterparty — a full legal name in the official
    // table, an abbreviated one in the app-style transaction detail.
    const a = rowFingerprint({ fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV ROSHFRANS SA DE CV', deposito: null, retiro: 15768.96 })
    const b = rowFingerprint({ fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV ROS', deposito: null, retiro: 15768.96 })
    assert.equal(a, b)
  })

  it('produces different fingerprints for different amounts', () => {
    const a = rowFingerprint({ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 100 })
    const b = rowFingerprint({ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 200 })
    assert.notEqual(a, b)
  })

  it('produces different fingerprints for different dates', () => {
    const a = rowFingerprint({ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 100 })
    const b = rowFingerprint({ fecha: '2026-03-28', nombre: 'X', deposito: null, retiro: 100 })
    assert.notEqual(a, b)
  })

  it('produces the same fingerprint whether fecha is an ISO string (fresh extraction) or a Date object ($queryRaw on a @db.Date column)', () => {
    // Regression: prisma.$queryRaw returns @db.Date columns as JS Date
    // instances, not ISO strings. Without normalizing both shapes the same
    // way, a row read back from the DB would never match a freshly
    // extracted row for the same calendar date, silently defeating
    // markDbDuplicates in production even though every unit test above
    // (string dates on both sides) would still pass.
    const a = rowFingerprint({ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 100 })
    const b = rowFingerprint({ fecha: new Date('2026-03-27T00:00:00.000Z'), nombre: 'X', deposito: null, retiro: 100 })
    assert.equal(a, b)
  })
})

describe('dedupeIntraFile', () => {
  it('collapses the same movement represented twice in one document (the two-page statement case)', () => {
    const rows = [
      { fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV ROSHFRANS SA DE CV', referencia: 'PLA A CUENTA ACEITE', deposito: null, retiro: 15768.96 },
      { fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV ROS', referencia: 'GUIA:4252746', deposito: null, retiro: 15768.96 },
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

describe('markDbDuplicates', () => {
  it('flags a row that matches an existing DB transaction, whose fecha comes back as a Date object like a real $queryRaw result', () => {
    const existingTransactions = [
      { id: 'tx-1', consecutive: 5, fecha: new Date('2026-03-27T00:00:00.000Z'), deposito: null, retiro: 15768.96, nombre: 'AUTOPARTES SALAV ROSHFRANS SA DE CV' },
    ]
    const extractedRows = [
      { fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV ROS', deposito: null, retiro: 15768.96 },
    ]
    const [flagged] = markDbDuplicates(extractedRows, existingTransactions)
    assert.deepEqual(flagged.possibleDuplicate, { existingTransactionId: 'tx-1', existingConsecutive: 5 })
  })

  it('leaves a row unflagged when nothing matches', () => {
    const [flagged] = markDbDuplicates(
      [{ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 1 }],
      [{ id: 'tx-1', consecutive: 1, fecha: new Date('2026-01-01'), deposito: null, retiro: 999 }],
    )
    assert.equal(flagged.possibleDuplicate, null)
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
