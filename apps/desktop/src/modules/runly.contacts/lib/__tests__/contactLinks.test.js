import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { whatsappHref, telHref, mapsHref, initials, primaryChannel } from '../contactLinks.js'

describe('contactLinks', () => {
  it('builds WhatsApp/tel links with the country code for 10-digit MX numbers', () => {
    assert.equal(whatsappHref('81 8345 6700', '+52'), 'https://wa.me/528183456700')
    assert.equal(telHref('+52 81 8345 6700'), 'tel:+528183456700')
    assert.equal(whatsappHref(''), null)
  })

  it('prefers the primary channel of a kind', () => {
    const rows = [{ kind: 'phone', value: '1' }, { kind: 'phone', value: '2', isPrimary: true }]
    assert.equal(primaryChannel(rows, 'phone').value, '2')
    assert.equal(primaryChannel(rows, 'email'), null)
  })

  it('formats maps links and initials', () => {
    assert.match(mapsHref({ street: 'Av. Uno', extNumber: '10', city: 'Monterrey' }), /query=Av\.%20Uno%2010/)
    assert.equal(initials('Maquinaria y Canteras'), 'MY')
  })
})
