// The inventory-assistant chat thread table stays after the inventory
// assistant service itself was removed (2026-09-30-mirai-inventory-capability
// §5: "Thread tables stay"). This safety check moved here from the deleted
// services/__tests__/inventory-chat.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryAssistantThread } from '../inventory-assistant.model.js';
import { generateCreateTableSql, assertSafeMigrationSql } from '@runly/module-engine';

test('private conversation model enables RLS without granting client access', () => {
  const sql = generateCreateTableSql(inventoryAssistantThread);
  assert.match(sql, /DEFAULT uuidv7\(\)/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON TABLE .* FROM PUBLIC, anon, authenticated/);
  assert.doesNotThrow(() => assertSafeMigrationSql(sql));
  for (const part of sql.split(';').filter((s) => s.trim())) assert.doesNotThrow(() => assertSafeMigrationSql(`${part.trim()};`));
  assert.throws(() => assertSafeMigrationSql('ALTER TABLE secrets DISABLE ROW LEVEL SECURITY;'));
  assert.throws(() => assertSafeMigrationSql('ALTER TABLE secrets ENABLE ROW LEVEL SECURITY; ALTER TABLE secrets DROP COLUMN owner;'));
});
