import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAuthorizationRevision as revision } from '../membership-authorization-revision.js';

const permission = (key, active = true) => ({ permission: { key, active } });
const member = { companyId: 'company-a', userId: 'user-a', role: { id: 'role-a', key: 'member', permissions: [permission('company.profile.read'), permission('company.profile.update')] } };

test('membership revision ignores unrelated grants, branding, ordering and timestamps', () => {
  const updated = { ...member, updatedAt: new Date(), company: { name: 'New name', logoUrl: 'new-signed-url' }, role: { ...member.role, permissions: [...member.role.permissions].reverse() } };
  assert.equal(revision(member), revision(updated, [{ companyId: 'other-company', ...permission('identity.users.create') }]));
  assert.equal(revision(member), revision(member, [{ companyId: 'company-a', ...permission('inactive', false) }]));
});

test('role permission revocation and company-specific additive grants change the revision', () => {
  assert.notEqual(revision(member), revision({ ...member, role: { ...member.role, permissions: [permission('company.profile.read')] } }));
  assert.notEqual(revision(member), revision(member, [{ companyId: 'company-a', ...permission('identity.users.create') }]));
  assert.notEqual(revision(member), revision({ ...member, role: { ...member.role, key: 'runly.admin' } }));
});
