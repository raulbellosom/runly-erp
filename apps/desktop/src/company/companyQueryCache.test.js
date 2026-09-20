import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { clearCompanyQueryCache } from './companyQueryCache.js'

test('company changes and permission refreshes preserve the application guard', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  let instanceRequests = 0
  const guardOptions = {
    queryKey: ['instance-status'], staleTime: 30_000,
    queryFn: async () => { instanceRequests += 1; return { initialized: true } },
  }
  await client.fetchQuery(guardOptions)
  client.setQueryData(['memberships-me', 'session'], { data: [{ company: { id: 'company-a' } }] })
  const guard = new QueryObserver(client, guardOptions)
  const unsubscribe = guard.subscribe(() => {})
  try {
    for (let transition = 0; transition < 3; transition += 1) {
      client.setQueryData(['chat-conversations'], ['private-company-data'])
      client.setQueryData(['notes', 'private-note'], { body: 'private' })
      clearCompanyQueryCache(client)
      // A React guard reevaluates its query options on the next render.
      const result = guard.getOptimisticResult(guardOptions)
      assert.equal(result.isPending, false, 'must not unmount the company provider')
      assert.equal(result.data.initialized, true)
      assert.ok(client.getQueryData(['memberships-me', 'session']))
      assert.equal(client.getQueryData(['chat-conversations']), undefined)
      assert.equal(client.getQueryData(['notes', 'private-note']), undefined)
    }
    assert.equal(instanceRequests, 1)
  } finally { unsubscribe(); client.clear() }
})

test('switching company cancels requests so late results cannot restore old data', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  let finish
  let signal
  const pending = client.fetchQuery({ queryKey: ['private-resource'], queryFn: (context) => {
    signal = context.signal
    return new Promise((resolve) => { finish = resolve })
  } }).catch(() => {})
  clearCompanyQueryCache(client)
  assert.equal(signal.aborted, true)
  finish({ secret: 'previous-company' })
  await pending
  assert.equal(client.getQueryData(['private-resource']), undefined)
  client.clear()
})
