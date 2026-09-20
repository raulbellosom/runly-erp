import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommentsService } from '../comments-service.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';
function fixture() {
  const written = [];
  const prisma = {
    membership: { findFirst: async ({ where }) => where.companyId === 'company-a' && where.userId === ACTOR
      ? { role: { key: 'reader', permissions: [{ permission: { key: 'inventory.item.read', active: true } }] } } : null },
    userPermissionGrant: { findFirst: async () => null },
    userProfile: { findFirst: async () => ({ id: ACTOR }) },
    invItem: { findFirst: async ({ where }) => where.id === 'item-a' && where.companyId === 'company-a' ? { id: 'item-a' } : null },
    entityComment: {
      findMany: async () => [{ id: 'comment-a' }],
      findFirst: async ({ where }) => where.entityId === 'item-a' ? { id: 'comment-a', entityType: 'InvItem', entityId: 'item-a', authorId: ACTOR } : null,
      create: async ({ data }) => { written.push(data); return data; },
    },
  };
  return { prisma, written, service: createCommentsService({ prisma }) };
}

test('inventory comments accept authorized members and reject foreign item UUIDs', async () => {
  const { service } = fixture();
  assert.equal((await service.listComments('InvItem', 'item-a', 'company-a', ACTOR)).length, 1);
  await assert.rejects(service.listComments('InvItem', 'item-b', 'company-a', ACTOR), { status: 404 });
  await assert.rejects(service.listComments('InvItem', 'item-a', 'company-b', ACTOR), { status: 404 });
  await assert.rejects(service.updateComment('comment-a', 'auth', 'changed', 'company-a', 'item-b'), { status: 404 });
});

test('inventory mentions require both membership and permission before persisting', async () => {
  const { service, prisma, written } = fixture();
  await service.createComment('InvItem', 'item-a', 'auth', 'valid comment', 'company-a');
  await assert.rejects(service.createComment('InvItem', 'item-a', 'auth', `@[${TARGET}:Target]`, 'company-a'), { status: 404 });
  prisma.membership.findFirst = async ({ where }) => ({ role: { key: 'member', permissions: where.userId === ACTOR
    ? [{ permission: { key: 'inventory.item.read', active: true } }] : [] } });
  await assert.rejects(service.createComment('InvItem', 'item-a', 'auth', `@[${TARGET}:Target]`, 'company-a'), { status: 404 });
  assert.equal(written.length, 1);
});
