import test from 'node:test'
import assert from 'node:assert/strict'
import { activeMembershipFirst } from '../route-loader-service.js'

function ctx(header, memberships) {
  const store = new Map([['userContext', { profile: { id: 'u1' }, memberships }]])
  return { req: { header: (name) => (name === 'X-Runly-Company-Id' ? header : null) }, get: (k) => store.get(k), set: (k, v) => store.set(k, v) }
}

test('the requested company membership goes first for module routes', async () => {
  const c = ctx('b', [{ companyId: 'a' }, { companyId: 'b' }])
  await activeMembershipFirst(c, async () => {})
  assert.deepEqual(c.get('userContext').memberships.map((m) => m.companyId), ['b', 'a'])
  assert.equal(c.get('userContext').profile.id, 'u1')
})

test('a company the user does not belong to changes nothing', async () => {
  const c = ctx('zzz', [{ companyId: 'a' }, { companyId: 'b' }])
  await activeMembershipFirst(c, async () => {})
  assert.deepEqual(c.get('userContext').memberships.map((m) => m.companyId), ['a', 'b'])
})
