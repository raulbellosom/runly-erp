import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateView, defineView } from '../define-view.js'

test('validateView accepts TABLE with non-empty columns array', () => {
  const result = validateView({
    key: 'fleet.vehicle.table',
    kind: 'TABLE',
    schema: {
      columns: [{ field: 'plate' }],
    },
  })

  assert.equal(result.valid, true)
})

test('validateView rejects TABLE when schema.columns is missing', () => {
  const result = validateView({
    key: 'fleet.vehicle.table',
    kind: 'TABLE',
    schema: {},
  })

  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('schema.columns')))
})

test('validateView rejects TABLE when a column has no field/key/name', () => {
  const result = validateView({
    key: 'fleet.vehicle.table',
    kind: 'TABLE',
    schema: {
      columns: [{}],
    },
  })

  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('schema.columns[0]')))
})

test('validateView accepts FORM with sections containing fields', () => {
  const result = validateView({
    key: 'fleet.vehicle.form',
    kind: 'FORM',
    schema: {
      sections: [{ label: 'General', fields: [{ field: 'plate' }] }],
    },
  })

  assert.equal(result.valid, true)
})

test('validateView accepts FORM typed section without fields', () => {
  const result = validateView({
    key: 'fleet.vehicle.form',
    kind: 'FORM',
    schema: {
      sections: [{ type: 'attachments', attachments: { enabled: true } }],
    },
  })

  assert.equal(result.valid, true)
})

test('validateView rejects FORM without sections', () => {
  const result = validateView({
    key: 'fleet.vehicle.form',
    kind: 'FORM',
    schema: {},
  })

  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('schema.sections')))
})

test('validateView rejects DETAIL without sections', () => {
  const result = validateView({
    key: 'fleet.vehicle.detail',
    kind: 'DETAIL',
    schema: {},
  })

  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('schema.sections')))
})

test('validateView accepts CUSTOM with valid component key and path', () => {
  const result = validateView({
    key: 'custom.fleet:FleetDashboard',
    kind: 'CUSTOM',
    schema: {
      component: 'custom.fleet:FleetDashboardScreen',
      path: '/app/m/custom.fleet/dashboard',
    },
  })
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('validateView rejects CUSTOM when schema.component is missing', () => {
  const result = validateView({
    key: 'custom.fleet:FleetDashboard',
    kind: 'CUSTOM',
    schema: { path: '/app/m/custom.fleet/dashboard' },
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('schema.component')))
})

test('validateView rejects CUSTOM when schema.component has no namespace prefix', () => {
  const result = validateView({
    key: 'custom.fleet:FleetDashboard',
    kind: 'CUSTOM',
    schema: {
      component: 'FleetDashboardScreen',
      path: '/app/m/custom.fleet/dashboard',
    },
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('schema.component')))
})

test('validateView rejects CUSTOM when schema.path is missing', () => {
  const result = validateView({
    key: 'custom.fleet:FleetDashboard',
    kind: 'CUSTOM',
    schema: { component: 'custom.fleet:FleetDashboardScreen' },
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('schema.path')))
})

test('validateView rejects CUSTOM when schema.path does not start with /', () => {
  const result = validateView({
    key: 'custom.fleet:FleetDashboard',
    kind: 'CUSTOM',
    schema: {
      component: 'custom.fleet:FleetDashboardScreen',
      path: 'app/m/custom.fleet/dashboard',
    },
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('schema.path')))
})

test('defineView with CUSTOM kind does not throw when valid', () => {
  assert.doesNotThrow(() =>
    defineView({
      key: 'custom.fleet:FleetDashboard',
      kind: 'CUSTOM',
      schema: {
        component: 'custom.fleet:FleetDashboardScreen',
        path: '/app/m/custom.fleet/dashboard',
      },
    })
  )
})

test('validateView accepts CUSTOM with schema.public: true', () => {
  const result = validateView({
    key: 'custom.mymodule:CustomerPortal',
    kind: 'CUSTOM',
    schema: {
      component: 'custom.mymodule:CustomerPortalScreen',
      path: '/p/portal',
      public: true,
    },
  })
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('validateView rejects CUSTOM with schema.public as non-boolean', () => {
  const result = validateView({
    key: 'custom.mymodule:CustomerPortal',
    kind: 'CUSTOM',
    schema: {
      component: 'custom.mymodule:CustomerPortalScreen',
      path: '/p/portal',
      public: 'true',
    },
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('schema.public')))
})

test('validateView rejects CUSTOM with /p/ path but missing schema.public: true', () => {
  const result = validateView({
    key: 'custom.mymodule:CustomerPortal',
    kind: 'CUSTOM',
    schema: {
      component: 'custom.mymodule:CustomerPortalScreen',
      path: '/p/portal',
    },
  })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((e) => e.includes('/p/')))
})

test('validateView accepts a declarative DASHBOARD', () => {
  const result = validateView({ key: 'fleet.dashboard', kind: 'DASHBOARD', schema: {
    title: 'Flota', path: '/app/m/custom.fleet/dashboard',
    widgets: [{ key: 'totalVehicles', type: 'stat', title: 'Vehículos', source: { entity: 'vehicle', aggregate: 'count' } }],
  } })
  assert.deepEqual(result, { valid: true, errors: [] })
})

test('validateView rejects unsafe DASHBOARD widgets', () => {
  const result = validateView({ key: 'fleet.dashboard', kind: 'DASHBOARD', schema: {
    title: 'Flota', path: '/app/m/custom.fleet/dashboard',
    widgets: [
      { key: 'same', type: 'sql', title: 'Unsafe', source: { entity: 'vehicle', aggregate: 'count' } },
      { key: 'same', type: 'list', title: 'Too much', source: { entity: 'vehicle', limit: 1000, filters: [{ field: 'company_id', operator: 'eq', value: 'other' }] } },
    ],
  } })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('unsupported')))
  assert.ok(result.errors.some((error) => error.includes('unique')))
  assert.ok(result.errors.some((error) => error.includes('company_id')))
})

test('validateView accepts a safe declarative KANBAN', () => {
  const result = validateView({ key: 'fleet.kanban', kind: 'KANBAN', schema: {
    title: 'Operación', path: '/app/m/custom.fleet/vehicles-kanban', entity: 'vehicle', groupBy: 'status',
    apiPath: '/fleet/vehicles', card: { titleField: 'plate', subtitleField: 'brand' },
  } })
  assert.deepEqual(result, { valid: true, errors: [] })
})

test('validateView rejects unsafe KANBAN data controls', () => {
  const result = validateView({ key: 'fleet.kanban', kind: 'KANBAN', schema: {
    title: 'Unsafe', path: '/app/m/custom.fleet/kanban', entity: 'vehicle', groupBy: 'status',
    card: { titleField: 'plate' }, sql: 'select * from anything', companyId: 'foreign',
  } })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some((error) => error.includes('forbidden')))
})
