import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  contactUpsertSchema,
  rfcPersonType,
  catalogForPersonType,
  REGIMEN_FISCAL,
} from '../index.js'

const base = { type: 'company', name: 'Maquinaria del Norte' }

describe('contacts fiscal validation', () => {
  it('detects persona moral/fisica from the RFC and rejects bad formats', () => {
    assert.equal(rfcPersonType('mcn990618ab2'), 'moral')
    assert.equal(rfcPersonType('GOMA850101AB1'), 'fisica')
    assert.equal(rfcPersonType('XYZ'), null)
  })

  it('filters régimen fiscal by person type', () => {
    const moral = catalogForPersonType(REGIMEN_FISCAL, 'moral').map((e) => e.code)
    assert.ok(moral.includes('601'))
    assert.ok(!moral.includes('612'))
  })

  it('normalizes a valid RFC and rejects an invalid one', () => {
    const ok = contactUpsertSchema.safeParse({ ...base, taxId: ' mcn990618ab2 ' })
    assert.equal(ok.success, true)
    assert.equal(ok.data.taxId, 'MCN990618AB2')
    const bad = contactUpsertSchema.safeParse({ ...base, taxId: 'MCN99061-INVALID' })
    assert.equal(bad.success, false)
  })

  it('validates catalog codes, CP and channel emails', () => {
    assert.equal(contactUpsertSchema.safeParse({ ...base, taxRegime: '999' }).success, false)
    assert.equal(contactUpsertSchema.safeParse({ ...base, fiscalPostalCode: '640' }).success, false)
    const channels = [{ kind: 'email', value: 'no-es-correo' }]
    assert.equal(contactUpsertSchema.safeParse({ ...base, channels }).success, false)
  })

  it('accepts a full payload with empty optional strings', () => {
    const result = contactUpsertSchema.safeParse({
      ...base, legalName: '', email: '', website: '', taxRegime: '601', cfdiUse: 'G03', fiscalPostalCode: '64000',
      tags: ['Mayorista'],
      channels: [{ kind: 'phone', value: '8183456700', countryCode: '+52', isPrimary: true }],
      addresses: [{ kind: 'fiscal', street: 'Av. Constitución 2450' }],
      persons: [{ name: 'Sofía Enríquez', role: 'Compras', email: '' }],
    })
    assert.equal(result.success, true, JSON.stringify(result.error?.issues))
    assert.equal(result.data.channels[0].label, 'other')
    assert.equal(result.data.addresses[0].country, 'MX')
  })
})
