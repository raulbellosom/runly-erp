import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Hono } from 'hono'
import { createRouteLoaderService } from '../route-loader-service.js'

async function writeModuleApi(projectRoot, moduleKey, routePath) {
  const moduleDir = path.join(projectRoot, 'modules', 'custom', moduleKey, 'api')
  await fs.mkdir(moduleDir, { recursive: true })
  const filePath = path.join(moduleDir, 'index.js')
  const content = `
export default function createRouter() {
  return {
    routes: [{ method: 'GET', path: '${routePath}' }],
    router: {
      match(method, requestPath) {
        const isMatch = method === 'GET' && requestPath === '${routePath}'
        return [isMatch ? [{}] : []]
      },
    },
    fetch() {
      return new Response(JSON.stringify({ ok: true, moduleKey: '${moduleKey}' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  }
}
`
  await fs.writeFile(filePath, content, 'utf8')
}

async function writeExternalModule(projectRoot, customModulesDir, moduleKey) {
  const moduleDir = path.join(customModulesDir, moduleKey)
  await fs.mkdir(path.join(moduleDir, 'api'), { recursive: true })
  await fs.mkdir(path.join(moduleDir, 'components'), { recursive: true })
  await fs.writeFile(
    path.join(moduleDir, 'api', 'index.js'),
    `export default function createRouter() {
      return {
        routes: [{ method: 'GET', path: '/external/demo' }],
        router: {
          match(method, requestPath) {
            const isMatch = method === 'GET' && requestPath === '/external/demo'
            return [isMatch ? [{}] : []]
          },
        },
        fetch() {
          return new Response(JSON.stringify({ ok: true, moduleKey: '${moduleKey}' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    }`,
    'utf8'
  )
  await fs.writeFile(
    path.join(moduleDir, 'components', 'index.js'),
    `export async function register(registry) {
      registry.register('${moduleKey}:ExternalWidget', function ExternalWidget() { return null })
    }`,
    'utf8'
  )
}

async function writeModuleWithWildcardMiddleware(projectRoot, moduleKey) {
  const moduleDir = path.join(projectRoot, 'modules', 'custom', moduleKey, 'api')
  await fs.mkdir(moduleDir, { recursive: true })
  await fs.writeFile(
    path.join(moduleDir, 'index.js'),
    `export default function createRouter() {
      return {
        routes: [
          { method: 'ALL', path: '/*' },
          { method: 'GET', path: '/custom/owned' },
        ],
        router: {
          match() {
            return [[{}]]
          },
        },
        fetch() {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    }`,
    'utf8'
  )
}

function createPrismaMock(modules) {
  const moduleMap = new Map(modules.map((row) => [row.key, { ...row }]))

  return {
    runlyModule: {
      async findUnique({ where, select }) {
        const row = moduleMap.get(where.key)
        if (!row) return null
        if (!select) return { ...row }
        const selected = {}
        for (const key of Object.keys(select)) {
          if (select[key]) selected[key] = row[key]
        }
        return selected
      },
      async findMany({ where }) {
        const rows = [...moduleMap.values()]
        return rows.filter((row) => {
          if (where?.status && row.status !== where.status) return false
          if (typeof where?.enabled === 'boolean' && row.enabled !== where.enabled) return false
          if (where?.key?.in && !where.key.in.includes(row.key)) return false
          return true
        })
      },
      async update({ where, data }) {
        const current = moduleMap.get(where.key)
        if (!current) throw new Error('module not found')
        const next = { ...current, ...data }
        moduleMap.set(where.key, next)
        return next
      },
    },
  }
}

test('route-loader keeps first module route and flags collision on subsequent module', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-route-loader-'))
  await fs.writeFile(path.join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n', 'utf8')
  await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"tmp","type":"module"}', 'utf8')
  await fs.mkdir(path.join(projectRoot, 'modules', 'official'), { recursive: true })

  await writeModuleApi(projectRoot, 'custom.alpha', '/fleet/vehicles')
  await writeModuleApi(projectRoot, 'custom.beta', '/fleet/vehicles')

  const prisma = createPrismaMock([
    {
      key: 'custom.alpha',
      status: 'INSTALLED',
      enabled: true,
      manifest: { key: 'custom.alpha' },
      lifecycleConfig: { discovery: { localPath: 'modules/custom/custom.alpha' } },
      core: false,
    },
    {
      key: 'custom.beta',
      status: 'INSTALLED',
      enabled: true,
      manifest: { key: 'custom.beta' },
      lifecycleConfig: { discovery: { localPath: 'modules/custom/custom.beta' } },
      core: false,
    },
  ])

  const previousRoot = process.env.RUNLY_PROJECT_ROOT
  process.env.RUNLY_PROJECT_ROOT = projectRoot

  const routeLoader = createRouteLoaderService({
    prisma,
    authMiddleware: async (_c, next) => next(),
    requirePermission: () => async (_c, next) => next(),
  })

  const first = await routeLoader.reloadModule('custom.alpha')
  assert.equal(first.loaded, true)

  const second = await routeLoader.reloadModule('custom.beta')
  assert.equal(second.loaded, false)
  assert.equal(second.reason, 'route_collision')
  assert.equal(second.collision?.conflictingModuleKey, 'custom.alpha')
  assert.equal(second.collision?.method, 'GET')
  assert.equal(second.collision?.path, '/fleet/vehicles')

  const status = routeLoader.getModuleRouteStatus('custom.beta')
  assert.equal(status?.status, 'ERROR')
  assert.equal(status?.collision?.code, 'ROUTE_COLLISION')

  if (typeof previousRoot === 'string') {
    process.env.RUNLY_PROJECT_ROOT = previousRoot
  } else {
    delete process.env.RUNLY_PROJECT_ROOT
  }
  await fs.rm(projectRoot, { recursive: true, force: true })
})

test('route-loader loads API and components from RUNLY_MODULES_DIR custom root', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-route-loader-ext-'))
  const customModulesDir = path.join(projectRoot, 'custom-modules')
  await fs.writeFile(path.join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n', 'utf8')
  await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"tmp","type":"module"}', 'utf8')
  await fs.mkdir(path.join(projectRoot, 'modules', 'official'), { recursive: true })
  await writeExternalModule(projectRoot, customModulesDir, 'custom.external')

  const prisma = createPrismaMock([
    {
      key: 'custom.external',
      status: 'INSTALLED',
      enabled: true,
      manifest: { key: 'custom.external' },
      lifecycleConfig: { discovery: { localPath: 'custom.external' } },
      core: false,
    },
  ])

  const previousRoot = process.env.RUNLY_PROJECT_ROOT
  const previousModulesDir = process.env.RUNLY_MODULES_DIR
  process.env.RUNLY_PROJECT_ROOT = projectRoot
  process.env.RUNLY_MODULES_DIR = customModulesDir

  const routeLoader = createRouteLoaderService({
    prisma,
    authMiddleware: async (_c, next) => next(),
    requirePermission: () => async (_c, next) => next(),
  })

  const result = await routeLoader.reloadModule('custom.external')
  assert.equal(result.loaded, true)

  const loaded = routeLoader.getLoadedModules()
  assert.equal(loaded.length, 1)
  assert.equal(loaded[0]?.moduleKey, 'custom.external')
  assert.equal(loaded[0]?.routes?.[0]?.path, '/external/demo')
  const components = routeLoader.getModuleComponents('custom.external')
  assert.equal(typeof components['custom.external:ExternalWidget'], 'function')

  if (typeof previousRoot === 'string') {
    process.env.RUNLY_PROJECT_ROOT = previousRoot
  } else {
    delete process.env.RUNLY_PROJECT_ROOT
  }
  if (typeof previousModulesDir === 'string') {
    process.env.RUNLY_MODULES_DIR = previousModulesDir
  } else {
    delete process.env.RUNLY_MODULES_DIR
  }
  await fs.rm(projectRoot, { recursive: true, force: true })
})

test('route-loader wildcard middleware does not intercept unrelated core routes', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-route-loader-wildcard-'))
  await fs.writeFile(path.join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n', 'utf8')
  await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"tmp","type":"module"}', 'utf8')
  await fs.mkdir(path.join(projectRoot, 'modules', 'official'), { recursive: true })
  await writeModuleWithWildcardMiddleware(projectRoot, 'custom.wildcard')

  const prisma = createPrismaMock([
    {
      key: 'custom.wildcard',
      status: 'INSTALLED',
      enabled: true,
      manifest: { key: 'custom.wildcard' },
      lifecycleConfig: { discovery: { localPath: 'modules/custom/custom.wildcard' } },
      core: false,
    },
  ])
  const previousRoot = process.env.RUNLY_PROJECT_ROOT
  process.env.RUNLY_PROJECT_ROOT = projectRoot

  try {
    const app = new Hono()
    const routeLoader = createRouteLoaderService({
      prisma,
      authMiddleware: async (c) => c.json({ error: 'No autorizado' }, 401),
      requirePermission: () => async (_c, next) => next(),
    })
    await routeLoader.initialize(app)
    app.get('/modules/:key/bundle.js', (c) => c.text(`bundle:${c.req.param('key')}`))

    const response = await app.request('/modules/atlas.ledger/bundle.js')
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'bundle:atlas.ledger')
  } finally {
    if (typeof previousRoot === 'string') {
      process.env.RUNLY_PROJECT_ROOT = previousRoot
    } else {
      delete process.env.RUNLY_PROJECT_ROOT
    }
    await fs.rm(projectRoot, { recursive: true, force: true })
  }
})

test('route-loader reload picks up a replaced module, including its relative imports', async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-route-loader-'))
  await fs.writeFile(path.join(projectRoot, 'pnpm-workspace.yaml'), 'packages:\n  - "apps/*"\n', 'utf8')
  await fs.writeFile(path.join(projectRoot, 'package.json'), '{"name":"tmp","type":"module"}', 'utf8')
  await fs.mkdir(path.join(projectRoot, 'modules', 'official'), { recursive: true })
  const apiDir = path.join(projectRoot, 'modules', 'custom', 'custom.survey', 'api')
  await fs.mkdir(apiDir, { recursive: true })
  const writeVersion = async (routePath) => {
    await fs.writeFile(path.join(apiDir, 'routes.js'), `export const ROUTE = '${routePath}'\n`, 'utf8')
    await fs.writeFile(
      path.join(apiDir, 'index.js'),
      `import { ROUTE } from './routes.js'
export default function createRouter() {
  return {
    routes: [{ method: 'GET', path: ROUTE }],
    router: { match: (m, p) => [m === 'GET' && p === ROUTE ? [{}] : []] },
    fetch: () => new Response('ok'),
  }
}
`,
      'utf8'
    )
  }

  const prisma = createPrismaMock([
    { key: 'custom.survey', status: 'INSTALLED', enabled: true, manifest: { key: 'custom.survey' }, lifecycleConfig: {}, core: false },
  ])
  const previousRoot = process.env.RUNLY_PROJECT_ROOT
  process.env.RUNLY_PROJECT_ROOT = projectRoot
  try {
    const routeLoader = createRouteLoaderService({
      prisma,
      authMiddleware: async (_c, next) => next(),
      requirePermission: () => async (_c, next) => next(),
    })

    await writeVersion('/survey/records')
    await routeLoader.reloadModule('custom.survey')
    assert.deepEqual(routeLoader.getLoadedModules()[0].routes.map((r) => r.path), ['/survey/records'])

    // An upload rewrites the files with a newer mtime.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await writeVersion('/survey/dashboard')
    await routeLoader.reloadModule('custom.survey')
    assert.deepEqual(routeLoader.getLoadedModules()[0].routes.map((r) => r.path), ['/survey/dashboard'])
  } finally {
    if (typeof previousRoot === 'string') process.env.RUNLY_PROJECT_ROOT = previousRoot
    else delete process.env.RUNLY_PROJECT_ROOT
    await fs.rm(projectRoot, { recursive: true, force: true })
  }
})
