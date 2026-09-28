import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  enforceSingleFlag,
  primaryMirror,
  replaceContactCollections,
  withLegacyChannels,
} from '../contacts/contact-children-service.js'
import { createContactActivityService } from '../contacts/contact-activity-service.js'

function fakeDelegate(initial = []) {
  const rows = initial.map((r) => ({ ...r }))
  return {
    rows,
    async findMany() { return rows.map(({ id }) => ({ id })) },
    async deleteMany({ where }) {
      for (let i = rows.length - 1; i >= 0; i--) if (!where.id.notIn.includes(rows[i].id)) rows.splice(i, 1)
    },
    async update({ where, data }) { Object.assign(rows.find((r) => r.id === where.id), data) },
    async create({ data }) { rows.push({ id: `new-${rows.length}`, ...data }) },
  }
}

describe('contact children', () => {
  it('keeps exactly one primary per kind', () => {
    const out = enforceSingleFlag(
      [{ kind: 'phone', isPrimary: true }, { kind: 'phone', isPrimary: true }, { kind: 'email' }],
      'isPrimary', (r) => r.kind,
    )
    assert.deepEqual(out.map((r) => r.isPrimary), [true, false, true])
  })

  it('mirrors the primary channel onto email/phone', () => {
    const mirror = primaryMirror([
      { kind: 'phone', value: '111', isPrimary: false },
      { kind: 'phone', value: '222', isPrimary: true },
    ])
    assert.deepEqual(mirror, { email: null, phone: '222' })
  })

  it('replaces only collections present in the payload', async () => {
    const tx = {
      contactChannel: fakeDelegate([{ id: 'a', kind: 'phone', value: '1' }]),
      contactAddress: fakeDelegate([{ id: 'x', street: 'Calle 1' }]),
      contactPerson: fakeDelegate(),
    }
    const patch = await replaceContactCollections(tx, {
      companyId: 'c', contactId: 'k',
      payload: { channels: [{ kind: 'email', value: 'a@b.mx' }] },
    })
    assert.equal(tx.contactChannel.rows.length, 1)
    assert.equal(tx.contactChannel.rows[0].value, 'a@b.mx')
    assert.equal(tx.contactAddress.rows.length, 1, 'addresses untouched when key absent')
    assert.deepEqual(patch, { email: 'a@b.mx', phone: null })

    await replaceContactCollections(tx, { companyId: 'c', contactId: 'k', payload: { addresses: [] } })
    assert.equal(tx.contactAddress.rows.length, 0, 'empty array clears the collection')
  })

  it('rejects child ids that belong to another contact', async () => {
    const tx = { contactChannel: fakeDelegate([{ id: 'a' }]), contactAddress: fakeDelegate(), contactPerson: fakeDelegate() }
    await assert.rejects(
      replaceContactCollections(tx, { companyId: 'c', contactId: 'k', payload: { channels: [{ id: 'foreign', kind: 'phone', value: '1' }] } }),
      /no pertenece/,
    )
  })

  it('synthesizes channels for legacy contacts', () => {
    const rows = withLegacyChannels({ phone: '55', email: 'x@y.mx' }, [])
    assert.deepEqual(rows.map((r) => r.kind), ['phone', 'email'])
  })
})

describe('contact activity', () => {
  const provider = (key, moduleKey, overrides = {}) => ({
    key, moduleKey, label: key, permission: `${key}.read`,
    count: async () => 1,
    list: async () => [{ id: `${key}:1`, occurredAt: new Date('2026-09-01'), title: key }],
    ...overrides,
  })
  const prisma = { runlyModule: { findMany: async () => [{ key: 'm.a' }, { key: 'm.b' }] } }

  it('skips uninstalled modules, missing permissions and failing providers', async () => {
    const service = createContactActivityService({
      prisma,
      logger: { warn() {} },
      providers: [
        provider('a', 'm.a'),
        provider('b', 'm.b', { count: async () => { throw new Error('boom') } }),
        provider('c', 'm.not-installed'),
        provider('d', 'm.a', { permission: 'nope' }),
      ],
    })
    const result = await service.getActivity({
      companyId: 'c', contactId: 'k', isAdmin: false,
      permissionSet: new Set(['a.read', 'b.read', 'c.read']),
    })
    assert.deepEqual(result.summary.map((s) => s.key), ['a'])
    assert.equal(result.items.length, 1)
    assert.equal(result.items[0].module, 'm.a')
  })
})
