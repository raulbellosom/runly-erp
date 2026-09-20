import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContactsService } from '../contacts-service.js';
import { createHrService } from '../hr-service.js';

test('Contacts and HR never choose a membership when company context is missing', async () => {
  const prisma = new Proxy({}, { get() { throw new Error('Database must not be queried without a company'); } });
  for (const service of [createContactsService({ prisma }), createHrService({ prisma, activityBridge: {} })]) {
    for (const [name, method] of Object.entries(service)) {
      for (const companyId of [undefined, null, '']) {
        await assert.rejects(method({ authUserId: 'test', companyId, ids: ['test'], id: 'test' }), { status: 400 }, name);
      }
    }
  }
});
