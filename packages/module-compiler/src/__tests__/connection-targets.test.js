import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs'
import { EXTERNAL_RELATION_TARGETS, connectionTarget, connectionsManagePermission, targetTypeFromRecordContext } from '../external-relations.js'

const schema = fs.readFileSync(new URL('../../../../prisma/schema.prisma', import.meta.url), 'utf8')
const mappedTables = new Set([...schema.matchAll(/@@map\("([a-z_]+)"\)/g)].map((m) => m[1]))

test('every connectable target points at a real Prisma table', () => {
  for (const type of Object.keys(EXTERNAL_RELATION_TARGETS)) {
    const target = connectionTarget(type)
    assert.ok(target, `${type} has connection metadata`)
    assert.ok(mappedTables.has(target.table), `${type} -> ${target.table} is not a @@map table`)
  }
})

test('record context aliases resolve to target types', () => {
  assert.equal(targetTypeFromRecordContext('item'), 'inventory_item')
  assert.equal(targetTypeFromRecordContext('employee'), 'hr_employee')
  assert.equal(targetTypeFromRecordContext('contact'), 'contact')
  assert.equal(targetTypeFromRecordContext('note'), null)
})

test('connections manage permission is derived from the owning module', () => {
  assert.equal(connectionsManagePermission('inventory_item'), 'inventory.connections.manage')
  assert.equal(connectionsManagePermission('contact'), 'contacts.connections.manage')
  assert.equal(connectionsManagePermission('nope'), null)
})
