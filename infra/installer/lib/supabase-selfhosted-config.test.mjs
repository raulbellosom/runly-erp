import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  signHs256Jwt,
  verifyHs256Jwt,
  resolveSupabaseSecrets,
  findFreePort,
  resolveSupabasePorts,
  assessSupabaseSecurityPosture,
} from './supabase-selfhosted-config.mjs';

test('signHs256Jwt round-trips through verifyHs256Jwt', () => {
  const token = signHs256Jwt({ role: 'anon' }, 'a-secret-at-least-32-bytes-long!');
  const payload = verifyHs256Jwt(token, 'a-secret-at-least-32-bytes-long!');
  assert.equal(payload.role, 'anon');
  assert.ok(payload.exp > payload.iat);
  assert.equal(verifyHs256Jwt(token, 'wrong-secret'), null);
  assert.equal(verifyHs256Jwt('not-a-jwt', 'a-secret'), null);
});

test('resolveSupabaseSecrets generates all required secrets once and preserves them across calls', () => {
  const first = resolveSupabaseSecrets({});
  assert.ok(Buffer.byteLength(first.SUPABASE_JWT_SECRET) >= 32);
  assert.ok(first.SUPABASE_POSTGRES_PASSWORD.length >= 16);
  assert.equal(first.RUNLY_SUPABASE_REALTIME_DB_ENC_KEY.length, 16);
  assert.ok(first.RUNLY_SUPABASE_SECRET_KEY_BASE.length >= 64);
  assert.ok(first.RUNLY_SUPABASE_META_CRYPTO_KEY.length >= 32);
  assert.ok(verifyHs256Jwt(first.SUPABASE_ANON_KEY, first.SUPABASE_JWT_SECRET).role === 'anon');
  assert.ok(verifyHs256Jwt(first.SUPABASE_SERVICE_ROLE_KEY, first.SUPABASE_JWT_SECRET).role === 'service_role');

  const again = resolveSupabaseSecrets(first);
  assert.deepEqual(again, first);
});

test('resolveSupabaseSecrets never rotates a secret that is already present', () => {
  const existing = { SUPABASE_JWT_SECRET: 'existing-secret-value-long-enough-32b' };
  const resolved = resolveSupabaseSecrets(existing);
  assert.equal(resolved.SUPABASE_JWT_SECRET, existing.SUPABASE_JWT_SECRET);
});

test('findFreePort returns the preferred port when free, and increments on collision', async () => {
  const busy = new Set([9000, 9001]);
  const fakeIsPortFree = async (port) => !busy.has(port);
  assert.equal(await findFreePort(9000, { isPortFreeImpl: fakeIsPortFree }), 9002);
  assert.equal(await findFreePort(9005, { isPortFreeImpl: fakeIsPortFree }), 9005);
});

test('resolveSupabasePorts persists previously allocated ports without re-scanning', async () => {
  const neverCalled = async () => { throw new Error('should not scan when already persisted'); };
  const ports = await resolveSupabasePorts(
    { RUNLY_SUPABASE_KONG_HOST_PORT: '8123', RUNLY_SUPABASE_STUDIO_HOST_PORT: '54999' },
    { findFreePortImpl: neverCalled },
  );
  assert.deepEqual(ports, { kongPort: 8123, studioPort: 54999 });
});

test('assessSupabaseSecurityPosture flags cli-dev mode as always non-production', () => {
  const findings = assessSupabaseSecurityPosture({ mode: 'cli-dev' });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'critical');
});

test('assessSupabaseSecurityPosture is clean for a well-formed selfhosted config', () => {
  const secrets = resolveSupabaseSecrets({});
  const findings = assessSupabaseSecurityPosture({
    mode: 'selfhosted',
    publicBindAddr: '127.0.0.1',
    kongPort: 8000,
    studioPort: 54323,
    secrets,
    smtpConfigured: true,
  });
  assert.deepEqual(findings.filter((f) => f.level === 'critical'), []);
});

test('assessSupabaseSecurityPosture flags a short JWT secret and a mismatched key', () => {
  const findings = assessSupabaseSecurityPosture({
    mode: 'selfhosted',
    publicBindAddr: '127.0.0.1',
    kongPort: 8000,
    studioPort: 54323,
    secrets: {
      SUPABASE_JWT_SECRET: 'short',
      SUPABASE_POSTGRES_PASSWORD: 'also-short-pw-but-16plus-chars',
      SUPABASE_ANON_KEY: signHs256Jwt({ role: 'anon' }, 'a-totally-different-secret-value'),
      SUPABASE_SERVICE_ROLE_KEY: signHs256Jwt({ role: 'service_role' }, 'short'),
    },
    smtpConfigured: true,
  });
  const messages = findings.map((f) => f.message).join('\n');
  assert.match(messages, /shorter than 32 bytes/);
  assert.match(messages, /SUPABASE_ANON_KEY does not verify/);
});

test('assessSupabaseSecurityPosture warns (not critical) when Kong is public with no proxy context and SMTP is unset', () => {
  const secrets = resolveSupabaseSecrets({});
  const findings = assessSupabaseSecurityPosture({
    mode: 'selfhosted',
    publicBindAddr: '0.0.0.0',
    kongPort: 8000,
    studioPort: 54323,
    secrets,
    smtpConfigured: false,
  });
  assert.equal(findings.filter((f) => f.level === 'critical').length, 0);
  assert.equal(findings.filter((f) => f.level === 'warning').length, 2);
});
