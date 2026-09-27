import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBackupConfig, getBackupComposeProfiles, generateResticPassword } from './backup-config.mjs';

test('generateResticPassword returns a long random base64url string', () => {
  const a = generateResticPassword();
  const b = generateResticPassword();
  assert.ok(a.length >= 32);
  assert.notEqual(a, b);
});

test('resolveBackupConfig defaults to disabled and requires no other vars', () => {
  const config = resolveBackupConfig({ deployment: 'local', supabaseMode: 'cli-dev', values: {} });
  assert.equal(config.mode, 'disabled');
  assert.equal(config.storageMountEnabled, false);
  assert.equal(config.resticPasswordGenerated, false);
});

test('resolveBackupConfig rejects an invalid BACKUP_MODE', () => {
  assert.throws(
    () => resolveBackupConfig({ deployment: 'local', supabaseMode: 'selfhosted', values: { mode: 'weird' } }),
    /BACKUP_MODE must be "disabled" or "enabled"/,
  );
});

test('resolveBackupConfig rejects enabling backup in local cli-dev mode', () => {
  assert.throws(
    () => resolveBackupConfig({
      deployment: 'local',
      supabaseMode: 'cli-dev',
      values: {
        mode: 'enabled',
        s3Endpoint: 'https://s3.example.com',
        s3Bucket: 'bucket',
        s3AccessKeyId: 'id',
        s3SecretAccessKey: 'secret',
      },
    }),
    /RUNLY_SUPABASE_MODE=selfhosted/,
  );
});

test('resolveBackupConfig requires all BACKUP_S3_* vars when enabled', () => {
  assert.throws(
    () => resolveBackupConfig({
      deployment: 'external',
      values: { mode: 'enabled', s3Endpoint: 'https://s3.example.com' },
    }),
    /requires BACKUP_S3_ENDPOINT/,
  );
});

test('resolveBackupConfig rejects a non-positive BACKUP_RETENTION_DAYS', () => {
  assert.throws(
    () => resolveBackupConfig({
      deployment: 'external',
      values: {
        mode: 'enabled',
        retentionDays: '0',
        s3Endpoint: 'https://s3.example.com',
        s3Bucket: 'bucket',
        s3AccessKeyId: 'id',
        s3SecretAccessKey: 'secret',
      },
    }),
    /BACKUP_RETENTION_DAYS must be a positive integer/,
  );
});

test('resolveBackupConfig generates RESTIC_PASSWORD once and preserves it on re-runs', () => {
  const first = resolveBackupConfig({
    deployment: 'external',
    values: {
      mode: 'enabled',
      s3Endpoint: 'https://s3.example.com',
      s3Bucket: 'bucket',
      s3AccessKeyId: 'id',
      s3SecretAccessKey: 'secret',
    },
  });
  assert.ok(first.resticPassword.length >= 32);
  assert.equal(first.resticPasswordGenerated, true);

  const again = resolveBackupConfig({
    deployment: 'external',
    values: {
      mode: 'enabled',
      s3Endpoint: 'https://s3.example.com',
      s3Bucket: 'bucket',
      s3AccessKeyId: 'id',
      s3SecretAccessKey: 'secret',
      resticPassword: first.resticPassword,
    },
  });
  assert.equal(again.resticPassword, first.resticPassword);
  assert.equal(again.resticPasswordGenerated, false);
});

test('resolveBackupConfig applies defaults for schedule/retention/region when enabled', () => {
  const config = resolveBackupConfig({
    deployment: 'local',
    supabaseMode: 'selfhosted',
    values: {
      mode: 'enabled',
      s3Endpoint: 'https://s3.example.com',
      s3Bucket: 'bucket',
      s3AccessKeyId: 'id',
      s3SecretAccessKey: 'secret',
    },
  });
  assert.equal(config.scheduleCron, '0 3 * * *');
  assert.equal(config.retentionDays, 14);
  assert.equal(config.s3Region, 'us-east-1');
  assert.equal(config.storageMountEnabled, true);
});

test('getBackupComposeProfiles returns the deployment-specific profile only when enabled', () => {
  const disabled = resolveBackupConfig({ deployment: 'local', supabaseMode: 'selfhosted', values: {} });
  assert.deepEqual(getBackupComposeProfiles(disabled, 'local'), []);

  const enabled = resolveBackupConfig({
    deployment: 'local',
    supabaseMode: 'selfhosted',
    values: {
      mode: 'enabled',
      s3Endpoint: 'https://s3.example.com',
      s3Bucket: 'bucket',
      s3AccessKeyId: 'id',
      s3SecretAccessKey: 'secret',
    },
  });
  assert.deepEqual(getBackupComposeProfiles(enabled, 'local'), ['backup-local']);
  assert.deepEqual(getBackupComposeProfiles(enabled, 'external'), ['backup-external']);
});
