import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { createInventoryIntakeRouter } from '../intake-routes.js';
import { createInventoryAssistantRouter } from '../assistant-routes.js';

function appFor({ deny, authorize = async () => {}, recognize } = {}) {
  const calls = [], permissions = [];
  const app = new Hono();
  app.use('*', async (c, next) => { c.set('companyId', 'company-from-session'); c.set('userId', 'actor-from-session'); c.set('authUserId', 'auth-user'); await next(); });
  const requirePermission = key => async (c, next) => { permissions.push(key); if (key === deny) return c.json({ error: 'forbidden' }, 403); await next(); };
  const record = async args => { calls.push(args); return { items: [] }; };
  app.route('/', createInventoryIntakeRouter({ prisma: {}, requirePermission, authorize, intake: {
    isConfigured: () => true, create: record,
    recognize: recognize ?? (async args => { calls.push(args); return { images: [] }; }),
    validate: async args => { calls.push(args); return { issues: [], duplicates: [] }; },
  } }));
  app.route('/', createInventoryAssistantRouter({ prisma: {}, requirePermission, assistant: { turn: record }, chat: { decide: record } }));
  return { app, calls, permissions };
}
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
test('intake and assistant identity come from authenticated middleware, never the body', async () => {
  const f = appFor();
  for (const path of ['/inventory/items/bulk', '/inventory/items/validate-batch', '/inventory/ai/messages', '/inventory/ai/threads/thread/decision']) {
    const response = await f.app.request(path, json({ companyId: 'foreign', actorId: 'forged' }));
    assert.ok(response.ok);
    assert.equal(f.calls.at(-1).companyId, 'company-from-session'); assert.equal(f.calls.at(-1).actorId, 'actor-from-session');
  }
  assert.ok(f.permissions.includes('inventory.item.create')); assert.ok(f.permissions.includes('inventory.item.read'));
});
test('create permission is required before consuming vision or writing any units', async () => {
  const f = appFor({ deny: 'inventory.item.create' });
  const form = new FormData(); form.append('files', new File(['jpeg'], 'label.jpg', { type: 'image/jpeg' }));
  assert.equal((await f.app.request('/inventory/ai/recognize', { method: 'POST', body: form })).status, 403);
  assert.equal((await f.app.request('/inventory/items/bulk', json({}))).status, 403);
  assert.equal(f.calls.length, 0);
});
test('recognition rechecks current permissions before returning observations', async () => {
  let authorized = true;
  const f = appFor({ authorize: async () => { if (!authorized) throw Object.assign(new Error('revoked'), { status: 403 }); }, recognize: async () => { authorized = false; return { images: [{ serialNumber: 'SECRET' }] }; } });
  const form = new FormData(); form.append('files', new File(['jpeg'], 'label.jpg', { type: 'image/jpeg' }));
  const response = await f.app.request('/inventory/ai/recognize', { method: 'POST', body: form });
  assert.equal(response.status, 403); assert.ok(!(await response.text()).includes('SECRET'));
});
test('malformed JSON and oversized messages fail without service calls', async () => {
  const f = appFor();
  const bad = await f.app.request('/inventory/items/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
  const big = await f.app.request('/inventory/ai/messages', json({ content: 'x'.repeat(120001) }));
  assert.equal(big.status, 413); assert.equal(f.calls.length, 0);
});
