import test from 'node:test';
import assert from 'node:assert/strict';
import { createInventoryChatActions } from '../inventory-chat-actions.js';

const scope = { companyId: '01900000-0000-7000-8000-000000000001', actorId: '01900000-0000-7000-8000-000000000002', id: '01900000-0000-7000-8000-000000000003' };
const plan = { actions: [{ kind: 'brand', data: { name: 'Marca de prueba' } }, { kind: 'item', data: { name: 'Equipo', serialNumber: 'O0-I1-B8', brandName: 'Marca de prueba' } }] };

test('proposals validate input and check every kind of permission without writing', async () => {
  const checks = [];
  const svc = createInventoryChatActions({ prisma: {}, authorize: async (s, permissions) => { assert.equal(s.companyId, scope.companyId); checks.push(permissions); } });
  const p = await svc.prepare(plan, scope);
  assert.equal(p.status, 'pending'); assert.equal(p.actions[1].data.serialNumber, 'O0-I1-B8');
  assert.equal((await svc.prepare(plan, scope)).id, p.id);
  assert.ok(checks.flat().includes('inventory.catalog.manage')); assert.ok(checks.flat().includes('inventory.item.create'));
  for (const bad of [
    { actions: [{ kind: 'item', data: { name: 'X', companyId: scope.companyId } }] },
    { actions: [{ kind: 'brand', data: { name: 'x'.repeat(101) } }] },
    { actions: [{ kind: 'customField', data: { label: 'RAM', fieldKey: 'ram', fieldType: 'select' } }] },
    { actions: [{ kind: 'item', data: { name: 'X', status: 'assigned' } }] },
  ]) await assert.rejects(svc.prepare(bad, scope), e => e.status === 400);
  const denied = createInventoryChatActions({ prisma: {}, authorize: async (_s, p) => { if (p.includes('inventory.item.create')) throw Object.assign(new Error('Denied'), { status: 403 }); } });
  await assert.rejects(denied.prepare(plan, scope), e => e.status === 403);
});
