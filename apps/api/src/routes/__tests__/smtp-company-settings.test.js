import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { createSettingsRouter } from '../settings-routes.js';
import { createWebsiteSettingsRouter } from '../website/website-settings-routes.js';
import { createSmtpService, createWebsiteSmtpService, decryptPassword } from '../../services/smtp-service.js';

test('SMTP settings and delivery stay within the authorized company', async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'smtp-company-test-only';
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  const rows = new Map([
    ['smtp.host', 'legacy.example.test'], ['smtp.user', 'legacy@example.test'],
  ]);
  const prisma = {
    instanceConfig: {
      findMany: async ({ where }) => where.key.in.filter(key => rows.has(key)).map(key => ({ key, value: rows.get(key) })),
      upsert: ({ where, create }) => () => rows.set(where.key, create.value),
    },
    $transaction: async (writes) => writes.forEach(write => write()),
    userProfile: { findFirst: async () => ({ email: 'recipient@example.test' }) },
  };
  const requirePermission = () => async (c, next) => {
    const companyId = c.req.header('X-Runly-Company-Id');
    if (!companyId) return c.json({ error: 'company_required' }, 400);
    if (!['a', 'b', 'empty'].includes(companyId)) return c.json({ error: 'forbidden' }, 403);
    c.set('companyId', companyId);
    return next();
  };
  const app = createSettingsRouter({ prisma, requirePermission });
  const website = createWebsiteSettingsRouter({ prisma, requirePermission });
  const request = (companyId, method = 'GET', body, site = false) => (site ? website : app).request(
    site ? '/website/settings/smtp' : '/settings/smtp', {
      method, headers: { 'Content-Type': 'application/json', ...(companyId ? { 'X-Runly-Company-Id': companyId } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  assert.equal((await request(null, 'POST', {})).status, 400);
  assert.equal((await request('forbidden', 'POST', {})).status, 403);
  const config = (id) => ({ host: `${id}.example.test`, user: `${id}@example.test`, port: 587, pass: `test-only-${id}`, tls: true });
  assert.equal((await request('a', 'POST', { ...config('a'), companyId: 'b' })).status, 200);
  assert.equal((await request('b', 'POST', config('b'))).status, 200);
  assert.equal(rows.get('smtp.host'), 'legacy.example.test');
  assert.equal(decryptPassword(rows.get('company:a:smtp.pass')), 'test-only-a');
  for (const id of ['a', 'b']) {
    const { data } = await (await request(id)).json();
    assert.equal(data.host, `${id}.example.test`);
    assert.equal(data.configured, true);
    assert.equal(data.pass, undefined);
    assert.ok(!JSON.stringify(data).includes(`test-only-${id}`));
  }
  const { pass, ...withoutPassword } = config('b');
  assert.equal((await request('b', 'POST', { ...withoutPassword, from_name: 'Company B' })).status, 200);
  assert.equal(decryptPassword(rows.get('company:b:smtp.pass')), pass);
  assert.equal((await (await request('empty')).json()).data.configured, false);
  const svc = createSmtpService({ prisma });
  const transports = [];
  t.mock.method(nodemailer, 'createTransport', (options) => {
    transports.push(options);
    return { sendMail: async () => ({}) };
  });
  for (const companyId of ['a', 'b']) await svc.sendEmail({ companyId, to: 'recipient@example.test', text: 'Test' });
  assert.deepEqual(transports.map(o => o.host), ['a.example.test', 'b.example.test']);
  await assert.rejects(svc.sendEmail({ companyId: 'empty', to: 'recipient@example.test' }), /SMTP no configurado/);
  assert.equal(transports.length, 2);
  assert.equal((await app.request('/settings/smtp/test', {
    method: 'POST', headers: { 'X-Runly-Company-Id': 'b' },
  })).status, 200);
  assert.equal(transports.at(-1).host, 'b.example.test');
  assert.equal((await createWebsiteSmtpService({ prisma, companyId: 'a' }).getConfig()).host, 'a.example.test');
  assert.equal((await request('a', 'POST', config('site-a'), true)).status, 200);
  assert.equal((await createWebsiteSmtpService({ prisma, companyId: 'a' }).getConfig()).host, 'site-a.example.test');
  assert.equal((await website.request('/website/settings/smtp/test', {
    method: 'POST', headers: { 'X-Runly-Company-Id': 'a' },
  })).status, 200);
  assert.equal(transports.at(-1).host, 'site-a.example.test');
  assert.equal((await createWebsiteSmtpService({ prisma, companyId: 'b' }).getConfig()).host, 'b.example.test');
  assert.equal(await createWebsiteSmtpService({ prisma, companyId: 'empty' }).getConfig(), null);
  assert.equal((await svc.getConfig()).host, 'legacy.example.test');
});
