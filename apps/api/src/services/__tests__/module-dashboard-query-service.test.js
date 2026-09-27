import test from 'node:test'
import assert from 'node:assert/strict'
import { createModuleDashboardQueryService } from '../module-dashboard-query-service.js'

const model = {
  moduleKey: 'custom.fleet', name: 'fleet.vehicle', tableName: 'fleet_vehicle',
  companyScoped: true, schema: { softDelete: true }, enabled: true,
  fields: [
    { name: 'plate', type: 'text' },
    { name: 'status', type: 'select' },
    { name: 'cost', type: 'decimal' },
  ],
}

function fixture(rows = [{ value: 3 }], selectedModel = model) {
  const calls = []
  const prisma = {
    runlyModel: { findFirst: async () => selectedModel },
    $queryRawUnsafe: async (sql, ...values) => { calls.push({ sql, values }); return rows },
  }
  return { service: createModuleDashboardQueryService({ prisma }), calls }
}

test('count is tenant scoped and excludes soft-deleted records', async () => {
  const { service, calls } = fixture([{ value: 2 }])
  const result = await service.executeWidget({ moduleKey: 'custom.fleet', companyId: '00000000-0000-4000-8000-000000000001', widget: {
    type: 'stat', source: { entity: 'vehicle', aggregate: 'count', filters: [{ field: 'status', operator: 'eq', value: 'ACTIVE' }] },
  } })
  assert.equal(result.value, 2)
  assert.match(calls[0].sql, /"company_id" = \$1::uuid/)
  assert.match(calls[0].sql, /"enabled" = true/)
  assert.match(calls[0].sql, /"status" = \$2/)
  assert.deepEqual(calls[0].values, ['00000000-0000-4000-8000-000000000001', 'ACTIVE'])
})

test('supports numeric sum and avg plus grouped count', async () => {
  for (const aggregate of ['sum', 'avg']) {
    const { service, calls } = fixture([{ value: 12.5 }])
    await service.executeWidget({ moduleKey: 'custom.fleet', companyId: '00000000-0000-4000-8000-000000000001', widget: { type: 'stat', source: { entity: 'vehicle', aggregate, aggregateField: 'cost' } } })
    assert.match(calls[0].sql, new RegExp(`${aggregate.toUpperCase()}\\(\"cost\"\\)`))
  }
  const { service, calls } = fixture([{ label: 'ACTIVE', value: 2 }])
  const result = await service.executeWidget({ moduleKey: 'custom.fleet', companyId: '00000000-0000-4000-8000-000000000001', widget: { type: 'chart', source: { entity: 'vehicle', aggregate: 'count', groupBy: 'status' } } })
  assert.equal(result.kind, 'series')
  assert.match(calls[0].sql, /GROUP BY "status"/)
})

// Regression: list widgets never carry `source.aggregate` (forbidden by the
// dashboard-schema.js validator), but the aggregate-field check used to run
// before the `widget.type === 'list'` branch and rejected every list widget
// with a bare AGGREGATE_FIELD_REQUIRED. Found during golden-path QA
// against a real installed module's "Últimos vehículos" list widget.
test('list widgets run without an aggregate and select id/title/subtitle ordered by the requested field', async () => {
  const { service, calls } = fixture([{ id: 'v1', plate: 'ABC123' }])
  const result = await service.executeWidget({
    moduleKey: 'custom.fleet', companyId: '00000000-0000-4000-8000-000000000001',
    widget: { type: 'list', display: { titleField: 'plate' }, source: { entity: 'vehicle', limit: 5, orderBy: { field: 'status', direction: 'asc' } } },
  })
  assert.equal(result.kind, 'records')
  assert.deepEqual(result.rows, [{ id: 'v1', plate: 'ABC123' }])
  assert.match(calls[0].sql, /SELECT "id", "plate" FROM/)
  assert.match(calls[0].sql, /ORDER BY "status" ASC LIMIT 5/)
})

test('rejects invalid fields, aggregate types and cross-module models', async () => {
  const { service } = fixture()
  await assert.rejects(service.executeWidget({ moduleKey: 'custom.fleet', companyId: '00000000-0000-4000-8000-000000000001', widget: { type: 'stat', source: { entity: 'vehicle', aggregate: 'sum', aggregateField: 'plate' } } }), /AGGREGATE_TYPE_MISMATCH/)
  await assert.rejects(service.executeWidget({ moduleKey: 'custom.fleet', companyId: '00000000-0000-4000-8000-000000000001', widget: { type: 'stat', source: { entity: 'vehicle', aggregate: 'count', filters: [{ field: 'secret', operator: 'eq', value: 1 }] } } }), /UNKNOWN_FIELD/)
  const foreign = fixture([], { ...model, moduleKey: 'custom.other' }).service
  await assert.rejects(foreign.executeWidget({ moduleKey: 'custom.fleet', companyId: '00000000-0000-4000-8000-000000000001', widget: { type: 'stat', source: { entity: 'vehicle', aggregate: 'count' } } }), /CROSS_MODULE_SOURCE_REJECTED/)
})

test('batch isolates widget errors', async () => {
  const { service } = fixture([{ value: 1 }])
  const result = await service.executeDashboard({ moduleKey: 'custom.fleet', companyId: '00000000-0000-4000-8000-000000000001', widgets: [
    { key: 'good', type: 'stat', source: { entity: 'vehicle', aggregate: 'count' } },
    { key: 'bad', type: 'stat', source: { entity: 'vehicle', aggregate: 'sum', aggregateField: 'plate' } },
  ] })
  assert.equal(result.good.status, 'success')
  assert.equal(result.bad.status, 'error')
})
