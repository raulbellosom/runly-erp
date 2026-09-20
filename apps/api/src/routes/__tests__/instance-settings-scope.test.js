import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsRouter } from '../settings-routes.js';
import { getActivityContext, publishActivityFromContext } from '../../services/activity-publisher.js';

test('company administrators cannot read, rotate or delete instance-wide push settings', async () => {
  let reads = 0;
  let systemAdmin = false;
  const app = createSettingsRouter({ prisma: { instanceConfig: { findMany: async () => { reads++; return []; } } },
    requirePermission: () => async (c, next) => { c.set('tenantContext', { companyId: 'company-a', isSystemAdmin: systemAdmin }); await next(); } });
  for (const [method, path] of [['GET', ''], ['POST', ''], ['POST', '/generate'], ['DELETE', '']]) {
    assert.equal((await app.request(`/settings/notifications/webpush${path}`, { method })).status, 403);
  }
  assert.equal(reads, 0);
  systemAdmin = true;
  assert.equal((await app.request('/settings/notifications/webpush')).status, 200);
  assert.equal(reads, 1);
});

test('activity never selects a company from membership order', async () => {
  const context = { userContext: { profile: { id: 'user' }, memberships: [{ companyId: 'wrong-company' }] } };
  const c = { get: key => context[key] };
  assert.equal(getActivityContext(c).companyId, null);
  assert.equal(await publishActivityFromContext({}, c, { type: 'test' }), null);
  context.companyId = 'selected-company';
  assert.equal(getActivityContext(c).companyId, 'selected-company');
});
