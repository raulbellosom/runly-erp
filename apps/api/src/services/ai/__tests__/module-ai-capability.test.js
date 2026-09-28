import test from 'node:test';
import assert from 'node:assert/strict';
import { createModuleAiCapability } from '../module-ai-capability.js';
import { createPublicLookup } from '../public-lookup.js';

test('module lookup sends only declared public fields and audits under the module key', async () => {
  const queries = [], audits = [];
  const capability = createModuleAiCapability({
    prisma: { auditLog: { create: async ({ data }) => { audits.push(data); } } },
    createMirai: () => ({ isConfigured: () => true, answerWithTools: async () => ({}), publicLookup: createPublicLookup({ search: async q => { queries.push(q); return { results: [] }; } }) }),
  });
  const ai = capability('custom.fleet', { ai: { publicLookup: [{ model: 'vehicles', publicFields: ['make', 'model', 'year'], topics: ['ficha tecnica'] }] } });
  assert.equal(ai.publicLookupEnabled, true);
  assert.deepEqual(ai.publicLookup.toolDefinition('vehicles').function.parameters.properties.topic.enum, ['ficha tecnica']);
  assert.equal(ai.publicLookup.toolDefinition('drivers'), null);
  const result = await ai.publicLookup.run({ model: 'vehicles', record: { id: 'r1', make: 'Toyota', model: 'Hilux', year: 2022, plate: 'ABC-123', owner: 'Ana' }, topic: 'otro', companyId: 'c1', actorId: 'a1' });
  assert.equal(result.origin, 'external');
  assert.deepEqual(queries, ['Toyota Hilux 2022 ficha tecnica']);
  assert.equal(audits[0].action, 'custom.fleet.ai.public_lookup'); assert.equal(audits[0].moduleKey, 'custom.fleet');
  const undeclared = capability('custom.other', null);
  assert.equal(undeclared.publicLookupEnabled, false);
  assert.ok((await undeclared.publicLookup.run({ model: 'vehicles', record: {} })).error);
});
