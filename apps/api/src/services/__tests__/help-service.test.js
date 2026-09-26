import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHelpService } from '../help-service.js'

const FLEET_MODULE = {
  id: 'mod-fleet',
  key: 'custom.fleet',
  name: 'Flotas',
  status: 'INSTALLED',
  enabled: true,
  manifest: { icon: 'Truck', navigation: [{ path: '/fleet/vehicles', label: 'Vehiculos' }] },
}

const CORE_MODULE = {
  id: 'mod-core',
  key: 'runly.core',
  name: 'Runly Core',
  status: 'INSTALLED',
  enabled: true,
  manifest: { icon: 'Layers', navigation: [{ path: '/modules', label: 'Modulos' }] },
}

const HELP_ROWS = [
  {
    moduleId: 'mod-fleet',
    kind: 'HELP',
    enabled: true,
    module: FLEET_MODULE,
    schema: { scope: 'module', viewKey: null, title: 'Flotas', summary: 'Gestiona vehiculos.', content: 'Modulo de flotas completo.' },
  },
  {
    moduleId: 'mod-fleet',
    kind: 'HELP',
    enabled: true,
    module: FLEET_MODULE,
    schema: { scope: 'view', viewKey: '/fleet/vehicles', title: 'Vehiculos', summary: 'Lista de vehiculos.', content: 'Aqui puedes dar de alta un vehiculo nuevo.' },
  },
  {
    moduleId: 'mod-core',
    kind: 'HELP',
    enabled: true,
    module: CORE_MODULE,
    schema: { scope: 'module', viewKey: null, title: 'Runly Core', summary: 'Nucleo del sistema.', content: 'Administra modulos y configuracion.' },
  },
];

function makePrisma({ modules = [CORE_MODULE, FLEET_MODULE], helpRows = HELP_ROWS } = {}) {
  return {
    runlyModule: {
      findMany: async ({ where }) => modules.filter((m) => {
        if (where?.status && m.status !== where.status) return false
        if (where?.enabled !== undefined && m.enabled !== where.enabled) return false
        if (where?.key && m.key !== where.key) return false
        return true
      }),
      findFirst: async ({ where }) => modules.find((m) =>
        m.key === where.key && m.status === where.status && m.enabled === where.enabled
      ) ?? null,
    },
    blueprint: {
      findMany: async ({ where }) => helpRows.filter((row) => {
        if (where?.kind && row.kind !== where.kind) return false
        if (where?.enabled !== undefined && row.enabled !== where.enabled) return false
        if (where?.moduleId && row.moduleId !== where.moduleId) return false
        if (where?.module?.key && row.module.key !== where.module.key) return false
        if (where?.module?.status && row.module.status !== where.module.status) return false
        if (where?.module?.enabled !== undefined && row.module.enabled !== where.module.enabled) return false
        return true
      }),
    },
  }
}

describe('help-service', () => {
  it('listModulesWithHelp returns one entry per module with a module-scope article', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.listModulesWithHelp()
    assert.equal(result.length, 2)
    const fleet = result.find((r) => r.moduleKey === 'custom.fleet')
    assert.equal(fleet.summary, 'Gestiona vehiculos.')
  })

  it('listModulesWithHelp excludes a DISABLED module even if it has help rows', async () => {
    const disabledFleet = { ...FLEET_MODULE, status: 'DISABLED' }
    const service = createHelpService({
      prisma: makePrisma({
        modules: [CORE_MODULE, disabledFleet],
        helpRows: HELP_ROWS.map((row) => ({ ...row, module: disabledFleet })),
      }),
    })
    const result = await service.listModulesWithHelp()
    assert.equal(result.length, 0)
  })

  it('getModuleHelp returns overview + views for an installed module', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.getModuleHelp('custom.fleet')
    assert.equal(result.overview.title, 'Flotas')
    assert.equal(result.views.length, 1)
    assert.equal(result.views[0].viewKey, '/fleet/vehicles')
  })

  it('getModuleHelp returns null for a module that is not installed', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.getModuleHelp('custom.unknown')
    assert.equal(result, null)
  })

  it('resolveHelp matches the view by the real, module-prefixed frontend path', async () => {
    // Manifests declare navigation.path/viewKey relative to the module's own
    // screen ("/fleet/vehicles"); the real frontend route is always
    // /m/<moduleKey>/... (ModuleSidebar's buildFullPath) — resolveHelp must
    // translate before comparing, not match the raw manifest value directly.
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.resolveHelp('/m/custom.fleet/fleet/vehicles')
    assert.equal(result.moduleKey, 'custom.fleet')
    assert.equal(result.view.title, 'Vehiculos')
    assert.equal(result.overview.title, 'Flotas')
  })

  it('resolveHelp does not match on the raw, unprefixed manifest path (regression guard)', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.resolveHelp('/fleet/vehicles')
    assert.notEqual(result.moduleKey, 'custom.fleet')
  })

  it('resolveHelp falls back to overview-only when no view matches', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.resolveHelp('/m/runly.core/modules')
    assert.equal(result.moduleKey, 'runly.core')
    assert.equal(result.view, null)
  })

  it('resolveHelp honors an explicit /app/-prefixed nav path (top-level route, bypasses the module prefix)', async () => {
    const coreWithTopLevelHelp = {
      ...CORE_MODULE,
      manifest: { ...CORE_MODULE.manifest, navigation: [...CORE_MODULE.manifest.navigation, { path: '/app/help', label: 'Ayuda' }] },
    }
    const service = createHelpService({
      prisma: makePrisma({
        modules: [coreWithTopLevelHelp, FLEET_MODULE],
        helpRows: HELP_ROWS.map((row) => (row.moduleId === 'mod-core' ? { ...row, module: coreWithTopLevelHelp } : row)),
      }),
    })
    const result = await service.resolveHelp('/help')
    assert.equal(result.moduleKey, 'runly.core')
  })

  it('resolveHelp shows only the fallback view (suppresses the generic overview) when one exists, e.g. a home welcome screen', async () => {
    const helpRowsWithHome = [
      ...HELP_ROWS,
      {
        moduleId: 'mod-core',
        kind: 'HELP',
        enabled: true,
        module: CORE_MODULE,
        schema: { scope: 'view', viewKey: '/app/home', title: 'Bienvenida', summary: 'Tips de inicio.', content: 'Usa el menu lateral...' },
      },
    ]
    const service = createHelpService({ prisma: makePrisma({ helpRows: helpRowsWithHome }) })
    const result = await service.resolveHelp('/home')
    assert.equal(result.moduleKey, 'runly.core')
    assert.equal(result.view.title, 'Bienvenida')
    assert.equal(result.overview, null)
  })

  it('resolveHelp falls back to runly.core general orientation when the path belongs to no known module', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.resolveHelp('/unknown/path')
    assert.equal(result.moduleKey, 'runly.core')
    assert.equal(result.overview.title, 'Runly Core')
    assert.equal(result.view, null)
  })

  it('resolveHelp returns nulls only when runly.core itself is not installed', async () => {
    const service = createHelpService({ prisma: makePrisma({ modules: [FLEET_MODULE] }) })
    const result = await service.resolveHelp('/unknown/path')
    assert.equal(result.moduleKey, null)
  })

  it('searchHelp finds matches across module and view content, accent-insensitive', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.searchHelp('vehiculo')
    assert.ok(result.length >= 1)
    assert.ok(result.some((r) => r.viewKey === '/fleet/vehicles'))
  })

  it('searchHelp returns [] when nothing matches', async () => {
    const service = createHelpService({ prisma: makePrisma() })
    const result = await service.searchHelp('xyzxyz')
    assert.deepEqual(result, [])
  })
})
