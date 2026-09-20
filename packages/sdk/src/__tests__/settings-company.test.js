import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunlyClient } from '../index.js';

test('all settings requests include the current company and secrets are never queued offline', async (t) => {
  let companyId = 'company-a';
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...options });
    return { ok: true, json: async () => ({ ok: true }) };
  });
  const client = createRunlyClient({ baseUrl: 'https://erp.example.test', getActiveCompanyId: () => companyId });
  const queue = t.mock.fn();
  client.setOfflineTransport({ queue });
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'navigator', descriptor) : delete globalThis.navigator);
  for (const id of ['company-a', 'company-b']) {
    companyId = id;
    await client.settings.getSmtp('test-token');
    await client.settings.saveSmtp({ host: 'smtp.example.test', pass: 'test-only' }, 'test-token');
    await client.settings.testSmtp('test-token');
    await client.settings.getWebsiteSmtp('test-token');
    await client.settings.saveWebsiteSmtp({ host: 'smtp.example.test', pass: 'test-only' }, 'test-token');
    await client.settings.testWebsiteSmtp('test-token');
    await client.settings.getWebPush('test-token');
    await client.settings.saveWebPush({ privateKey: 'test-only' }, 'test-token');
    await client.settings.generateWebPush('test-token');
    await client.settings.clearWebPush('test-token');
    for (const request of requests.splice(0)) {
      assert.equal(request.headers['X-Runly-Company-Id'], id);
      assert.equal(request.headers.Authorization, 'Bearer test-token');
      assert.equal(request.onlineOnly, undefined);
    }
  }
  assert.equal(queue.mock.callCount(), 0);
});
