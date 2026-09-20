import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompanyFetch, createRunlyClient } from '../index.js';

test('company transport scopes every request and preserves multipart, custom headers and cancellation', async () => {
  let company = 'a';
  const calls = [];
  const fetch = createCompanyFetch({ getBaseUrl: () => 'https://api.example.test/v1', getCompanyId: () => company,
    fetchImpl: async (...args) => { calls.push(args); return new Response('{}'); } });
  const body = new FormData(); body.append('file', new Blob(['test']), 'test.txt');
  const signal = new AbortController().signal;
  await fetch('https://api.example.test/v1/files/upload', { method: 'POST', body, signal, headers: { Authorization: 'Bearer test' } });
  assert.equal(calls[0][1].headers.get('X-Runly-Company-Id'), 'a');
  assert.equal(calls[0][1].headers.get('Content-Type'), null);
  assert.equal(calls[0][1].body, body);
  assert.equal(calls[0][1].signal, signal);
  company = 'b';
  await fetch(new Request('https://api.example.test/v1/items', { headers: { Authorization: 'Bearer test' } }), { headers: new Headers({ Accept: 'application/json' }) });
  assert.equal(calls[1][1].headers.get('X-Runly-Company-Id'), 'b');
  assert.equal(calls[1][1].headers.get('Authorization'), 'Bearer test');
  assert.equal(calls[1][1].headers.get('Accept'), 'application/json');
  await assert.rejects(fetch('https://api.example.test/v1/items', { headers: { 'x-runly-company-id': 'a' } }), { code: 'company_changed' });
  for (const url of ['https://other.example.test/v1/items', 'https://api.example.test/v10/items', 'https://api.example.test/other']) {
    await assert.rejects(fetch(url), { code: 'invalid_api_origin' });
  }
  company = null;
  await assert.rejects(fetch('https://api.example.test/v1/items'), { code: 'company_required' });
  assert.equal(calls.length, 2);
});

test('late responses cannot update the next company in either transport', async (t) => {
  let company = 'a';
  const transport = createCompanyFetch({ getBaseUrl: () => 'https://api.example.test', getCompanyId: () => company,
    fetchImpl: async () => { company = 'b'; return new Response('{}'); } });
  await assert.rejects(transport('https://api.example.test/items'), { code: 'company_changed' });
  company = 'a';
  const slowBody = createCompanyFetch({ getBaseUrl: () => 'https://api.example.test', getCompanyId: () => company,
    fetchImpl: async () => ({ ok: true, json: async () => { company = 'b'; return {}; } }) });
  const response = await slowBody('https://api.example.test/items');
  await assert.rejects(response.json(), { code: 'company_changed' });
  company = 'a';
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => { company = 'b'; return { private: true }; } }));
  const client = createRunlyClient({ baseUrl: 'https://api.example.test', getActiveCompanyId: () => company });
  await assert.rejects(client.auth.me('test'), { code: 'company_changed' });
});

test('module ZIP upload includes company without overriding multipart boundary', async (t) => {
  let headers;
  t.mock.method(globalThis, 'fetch', async (_url, options) => { headers = new Headers(options.headers); return { ok: true, json: async () => ({}) }; });
  const client = createRunlyClient({ baseUrl: 'https://api.example.test', getActiveCompanyId: () => 'a' });
  await client.modules.uploadModuleZip('custom.example', new FormData(), 'test');
  assert.equal(headers.get('X-Runly-Company-Id'), 'a');
  assert.equal(headers.get('Content-Type'), null);
});
