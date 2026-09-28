import test from 'node:test'
import assert from 'node:assert/strict'
import { createModuleRecordsViewQueryService } from '../module-records-view-query-service.js'

const MODEL = {
  moduleKey: 'custom.agenda',
  tableName: 'custom_agenda_cita',
  companyScoped: true,
  schema: {},
  fields: [
    { name: 'nombre', label: 'Nombre', type: 'text' },
    { name: 'fecha', label: 'Fecha', type: 'date' },
    { name: 'monto', label: 'Monto', type: 'decimal' },
    { name: 'estado', label: 'Estado', type: 'select', options: [{ value: 'NEW', label: 'Nueva' }] },
  ],
}

function fakePrisma(results) {
  const calls = []
  return {
    calls,
    runlyModel: { findFirst: async () => MODEL },
    $queryRawUnsafe: async (sql, ...values) => { calls.push({ sql, values }); return results.shift() ?? [] },
  }
}

const base = { title: 'Citas', path: '/app/m/custom.agenda/cita-calendar', entity: 'cita' }

test('calendar query is company-scoped, range-bounded and selects only referenced fields', async () => {
  const prisma = fakePrisma([[{ id: '1', fecha: '2026-09-02', nombre: 'A' }]])
  const svc = createModuleRecordsViewQueryService({ prisma })
  const data = await svc.queryView({
    moduleKey: 'custom.agenda', kind: 'CALENDAR', companyId: 'co-1',
    schema: { ...base, dateField: 'fecha', titleField: 'nombre' },
    range: { from: '2026-09-01', to: '2026-10-01' },
  })
  const { sql, values } = prisma.calls[0]
  assert.match(sql, /^SELECT "id", "fecha", "nombre" FROM "custom_agenda_cita" WHERE "company_id" = \$1::uuid AND "enabled" = true AND "fecha" >= \$2::date AND "fecha" < \$3::date ORDER BY "fecha" ASC/)
  assert.deepEqual(values, ['co-1', '2026-09-01', '2026-10-01'])
  assert.equal(data.records.length, 1)
  assert.deepEqual(data.fields.map((f) => f.name), ['fecha', 'nombre'])
})

test('rejects oversized calendar ranges and non-date date fields', async () => {
  const svc = createModuleRecordsViewQueryService({ prisma: fakePrisma([]) })
  await assert.rejects(svc.queryView({ moduleKey: 'custom.agenda', kind: 'CALENDAR', companyId: 'co-1', schema: { ...base, dateField: 'fecha', titleField: 'nombre' }, range: { from: '2026-01-01', to: '2026-12-31' } }), { code: 'INVALID_RANGE' })
  await assert.rejects(svc.queryView({ moduleKey: 'custom.agenda', kind: 'TIMELINE', companyId: 'co-1', schema: { ...base, dateField: 'nombre', titleField: 'nombre' } }), { code: 'INVALID_DATE_FIELD' })
})

test('report groups with option labels and a totals row', async () => {
  const prisma = fakePrisma([
    [{ __group: 'NEW', total: 2, monto: 150 }, { __group: null, total: 1, monto: 10 }],
    [{ total: 3, monto: 160 }],
  ])
  const svc = createModuleRecordsViewQueryService({ prisma })
  const data = await svc.queryView({
    moduleKey: 'custom.agenda', kind: 'REPORT', companyId: 'co-1',
    schema: { ...base, groupBy: 'estado', measures: [{ key: 'total', label: 'Citas', aggregate: 'count' }, { key: 'monto', label: 'Monto', aggregate: 'sum', field: 'monto' }] },
  })
  assert.match(prisma.calls[0].sql, /GROUP BY "estado"/)
  assert.deepEqual(data.groups.map((g) => g.label), ['Nueva', 'Sin valor'])
  assert.deepEqual(data.totals, { total: 3, monto: 160 })
})
