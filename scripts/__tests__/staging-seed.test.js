import test from 'node:test';
import assert from 'node:assert/strict';
import { requireStagingSeed } from '../staging-seed.mjs';
test('Staging seed rejects non-session and production destinations', () => {
  const env = { RUNLY_STAGING_ENABLED: 'true', RUNLY_STAGING_ENVIRONMENT: 'local', RUNLY_STAGING_SESSION_ID: '11111111-1111-4111-8111-111111111111', DATABASE_URL: 'postgres://postgres:synthetic@db/postgres', NODE_ENV: 'test' };
  requireStagingSeed(env);
  for (const change of [{ NODE_ENV: 'production' }, { RUNLY_STAGING_ENVIRONMENT: 'production' }, { RUNLY_STAGING_ENABLED: 'false' }, { DATABASE_URL: 'postgres://postgres:synthetic@example.test/postgres' }]) assert.throws(() => requireStagingSeed({ ...env, ...change }));
});
