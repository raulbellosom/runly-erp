import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryService } from '../inventory-service.js';

test('file association retries return the same relation and respect the file limit', async () => {
  const rows = []; let count = 0;
  const db = {
    invItem: { findFirst: async ({ where }) => where.companyId === 'allowed' ? { id: 'item' } : null },
    $queryRaw: async () => [],
    invItemFile: {
      findFirst: async ({ where }) => rows.find(row => row.itemId === where.itemId && row.fileAssetId === where.fileAssetId),
      count: async () => count,
      create: async ({ data }) => { const row = { id: 'association', ...data }; rows.push(row); count++; return row; },
    },
  };
  db.$transaction = async fn => fn(db);
  const service = createInventoryService({ prisma: db, activityBridge: { logAndPublish: async () => {} } });
  const first = await service.addItemFile('item', 'file', 'allowed');
  const retry = await service.addItemFile('item', 'file', 'allowed');
  assert.deepEqual(first, retry); assert.equal(rows.length, 1);
  count = 20;
  await assert.rejects(service.addItemFile('item', 'another-file', 'allowed'), e => e.status === 400);
  await assert.rejects(service.addItemFile('item', 'file', 'foreign'), e => e.status === 404);
});
