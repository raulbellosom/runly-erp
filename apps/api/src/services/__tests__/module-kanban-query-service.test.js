import test from 'node:test'
import assert from 'node:assert/strict'
import { createModuleKanbanQueryService } from '../module-kanban-query-service.js'

const model = {
  moduleKey: 'custom.fleet', name: 'fleet.vehicle', tableName: 'fleet_vehicle', companyScoped: true,
  schema: { softDelete: true }, fields: [
    { name: 'plate', type: 'text', required: true },
    { name: 'status', type: 'select', required: false, options: [{ value: 'NEW', label: 'Nuevo' }, { value: 'DONE', label: 'Terminado' }] },
  ],
}
const schema = { title: 'Flujo', path: '/app/m/custom.fleet/kanban', entity: 'vehicle', groupBy: 'status', card: { titleField: 'plate' }, filters: [{ field: 'status', operator: 'neq', value: 'HIDDEN' }] }

function fixture(rows) {
  const calls = []
  const prisma = { runlyModel: { findFirst: async () => model }, $queryRawUnsafe: async (sql, ...values) => { calls.push({ sql, values }); return rows } }
  return { service: createModuleKanbanQueryService({ prisma }), calls }
}

test('queries an allowlisted, tenant-scoped board and derives empty/null/legacy columns', async () => {
  const { service, calls } = fixture([{ id: '1', plate: 'ABC', status: 'NEW' }, { id: '2', plate: 'XYZ', status: 'LEGACY' }])
  const board = await service.queryBoard({ moduleKey: 'custom.fleet', schema, companyId: '00000000-0000-4000-8000-000000000001' })
  assert.match(calls[0].sql, /"company_id" = \$1::uuid/)
  assert.match(calls[0].sql, /"enabled" = true/)
  assert.deepEqual(calls[0].values, ['00000000-0000-4000-8000-000000000001', 'HIDDEN'])
  assert.deepEqual(board.columns.map((column) => column.label), ['Nuevo', 'Terminado', 'Sin asignar', 'Otros · LEGACY'])
  assert.equal(board.columns.at(-1).acceptsDrop, false)
})

test('enforces the hard record limit and reports truncation', async () => {
  const rows = Array.from({ length: 3 }, (_, index) => ({ id: String(index), plate: `P${index}`, status: 'NEW' }))
  const { service } = fixture(rows)
  const board = await service.queryBoard({ moduleKey: 'custom.fleet', schema: { ...schema, limit: 2 }, companyId: '00000000-0000-4000-8000-000000000001' })
  assert.equal(board.records.length, 2)
  assert.equal(board.truncated, true)
})
