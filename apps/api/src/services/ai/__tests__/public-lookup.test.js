import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLookupQuery, createPublicLookup, isIdentifyingField } from '../public-lookup.js';

test('query is built from ordered descriptive fields and drops identifying ones', () => {
  assert.equal(buildLookupQuery({ type: 'Laptop', brand: 'Asus', model: 'TUF 15', serialNumber: 'NC31' }), 'Laptop Asus TUF 15 especificaciones fabricante');
  assert.equal(buildLookupQuery({ make: 'Toyota', model: 'Hilux', year: 2022, plate: 'ABC-1' }, 'ficha tecnica'), 'Toyota Hilux 2022 ficha tecnica');
  assert.equal(buildLookupQuery({ vin: 'X', owner: 'Ana' }), '');
  assert.ok(isIdentifyingField('assetTag') && isIdentifyingField('serial_number') && !isIdentifyingField('model'));
});

test('disabled without Tavily or when the web kill switch is set', () => {
  assert.equal(createPublicLookup({ env: { GROQ_API_KEY: 'k' } }).enabled, false);
  assert.equal(createPublicLookup({ env: { GROQ_API_KEY: 'k', TAVILY_API_KEY: 't', CHAT_MIRAI_WEB: 'false' } }).enabled, false);
  assert.equal(createPublicLookup({ env: { GROQ_API_KEY: 'k', TAVILY_API_KEY: 't' } }).enabled, true);
});

test('lookup normalizes sources and enforces the per-turn budget', async () => {
  let calls = 0;
  const svc = createPublicLookup({ search: async () => { calls++; return { answer: 'GPU RTX 3050', results: [{ title: 'Spec', url: 'javascript:x', content: 'c' }] }; } });
  const budget = svc.createTurnBudget();
  const first = await svc.lookup({ subject: { brand: 'Asus', model: 'TUF' }, budget });
  assert.equal(first.origin, 'external'); assert.equal(first.sources[0].url, null); assert.equal(first.summary, 'GPU RTX 3050');
  await svc.lookup({ subject: { brand: 'Asus', model: 'TUF' }, budget });
  assert.ok((await svc.lookup({ subject: { brand: 'Asus', model: 'TUF' }, budget })).error);
  assert.equal(calls, 2);
  assert.ok((await svc.lookup({ subject: { serial: 'X' } })).error);
});
