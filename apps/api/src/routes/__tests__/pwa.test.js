import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import sharp from 'sharp'
import { createPwaRouter } from '../pwa.js'

const CALENDAR_LOGO_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="#7C3AED"/></svg>',
)

function createLogoLoader(buffer) {
  return async () => ({
    buffer,
    hash: createHash('sha256').update(buffer).digest('hex'),
  })
}

const modules = new Map([
  [
    'atlas.inventory',
    {
      key: 'atlas.inventory',
      status: 'INSTALLED',
      enabled: true,
      version: '1.0.0',
      manifest: {
        name: 'Inventario',
        description: 'Gestion de activos',
        icon: 'Boxes',
        color: '#7c3aed',
        pwa: {
          shortName: 'Inventario',
          startPath: '/inventory',
        },
      },
    },
  ],
  [
    'atlas.projects',
    {
      key: 'atlas.projects',
      status: 'INSTALLED',
      enabled: true,
      version: '1.0.0',
      manifest: {
        name: 'Proyectos',
        description: 'Gestion de proyectos',
        icon: 'SquareKanban',
        color: '#09090b',
        pwa: {
          shortName: 'Proyectos',
          startPath: '/',
        },
      },
    },
  ],
  [
    'atlas.calendar',
    {
      key: 'atlas.calendar',
      status: 'INSTALLED',
      enabled: true,
      version: '1.0.0',
      manifest: {
        name: 'Calendario',
        description: 'Calendarios y eventos',
        icon: 'Calendar',
        color: '#7C3AED',
        logoUrl: '/module-logos/runly-calendar-128.svg',
        pwa: {
          shortName: 'Calendario',
          startPath: '/calendar',
        },
      },
    },
  ],
])

function createApp({ loadLogo } = {}) {
  const prisma = {
    runlyModule: {
      findUnique: async ({ where }) => modules.get(where.key) ?? null,
    },
  }
  const app = new Hono()
  app.route('/pwa', createPwaRouter({ prisma, loadLogo }))
  return app
}

test('serves a stable module manifest with module-specific identity', async () => {
  const response = await createApp().request(
    'https://atlas.example.com/pwa/manifest/atlas.inventory.webmanifest',
  )
  const manifest = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/manifest+json')
  assert.equal(manifest.name, 'Inventario — Runly')
  assert.equal(manifest.short_name, 'Inventario')
  assert.equal(manifest.id, '/pwa/apps/atlas.inventory')
  assert.equal(manifest.start_url, '/app/m/atlas.inventory/inventory')
  assert.equal(manifest.scope, '/app/m/atlas.inventory/')
  assert.match(
    manifest.icons[0].src,
    /^\/pwa\/icon\/atlas\.inventory\/192\.png\?v=[a-f0-9]{12}$/,
  )
  assert.match(response.headers.get('etag'), /^".+"$/)
})

test('refreshes a cached Atlas manifest without changing the installed app identity', async () => {
  const moduleRow = modules.get('atlas.inventory')
  const legacyHash = createHash('sha256').update(JSON.stringify({
    key: moduleRow.key,
    version: moduleRow.version,
    name: moduleRow.manifest.name,
    description: moduleRow.manifest.description,
    icon: moduleRow.manifest.icon,
    color: moduleRow.manifest.color,
    logoUrl: moduleRow.manifest.logoUrl,
    logoHash: null,
    pwa: moduleRow.manifest.pwa,
  })).digest('hex')
  const app = createApp()
  const url = 'https://runly.example.com/pwa/manifest/atlas.inventory.webmanifest'
  const response = await app.request(url, {
    headers: { 'if-none-match': `"${legacyHash}"` },
  })
  assert.equal(response.status, 200)
  const manifest = await response.json()
  assert.equal(manifest.name, 'Inventario — Runly')
  assert.equal(manifest.id, '/pwa/apps/atlas.inventory')
  assert.equal(manifest.scope, '/app/m/atlas.inventory/')
  assert.equal(manifest.start_url, '/app/m/atlas.inventory/inventory')
  assert.equal(manifest.icons[0].src, `/pwa/icon/atlas.inventory/192.png?v=${legacyHash.slice(0, 12)}`)
  const revalidated = await app.request(url, {
    headers: { 'if-none-match': response.headers.get('etag') },
  })
  assert.equal(revalidated.status, 304)
})

test('different modules expose different PWA ids and start URLs', async () => {
  const app = createApp()
  const inventory = await (
    await app.request('https://atlas.example.com/pwa/manifest/atlas.inventory.webmanifest')
  ).json()
  const projects = await (
    await app.request('https://atlas.example.com/pwa/manifest/atlas.projects.webmanifest')
  ).json()

  assert.notEqual(inventory.id, projects.id)
  assert.notEqual(inventory.start_url, projects.start_url)
  assert.equal(projects.start_url, '/app/m/atlas.projects/')
  assert.equal(projects.scope, '/app/m/atlas.projects/')
})

test('serves generated PNG icons at the requested size', async () => {
  const response = await createApp().request(
    'https://atlas.example.com/pwa/icon/atlas.inventory/192.png',
  )
  const buffer = Buffer.from(await response.arrayBuffer())
  const metadata = await sharp(buffer).metadata()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(metadata.width, 192)
  assert.equal(metadata.height, 192)
  assert.match(response.headers.get('etag'), /^".+"$/)
})

test('renders configured module logos instead of the Lucide fallback', async () => {
  const response = await createApp({
    loadLogo: createLogoLoader(CALENDAR_LOGO_SVG),
  }).request('https://atlas.example.com/pwa/icon/atlas.calendar/192.png')
  const buffer = Buffer.from(await response.arrayBuffer())
  const expected = await sharp(CALENDAR_LOGO_SVG)
    .resize(192, 192)
    .png()
    .toBuffer()

  assert.equal(response.status, 200)
  assert.deepEqual(buffer, expected)
})

test('changes the manifest icon version when logo contents change', async () => {
  const firstManifest = await (
    await createApp({
      loadLogo: createLogoLoader('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    }).request(
      'https://atlas.example.com/pwa/manifest/atlas.calendar.webmanifest',
    )
  ).json()
  const secondManifest = await (
    await createApp({
      loadLogo: createLogoLoader(
        '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
      ),
    }).request(
      'https://atlas.example.com/pwa/manifest/atlas.calendar.webmanifest',
    )
  ).json()

  assert.notEqual(firstManifest.icons[0].src, secondManifest.icons[0].src)
})

test('revalidates ETags and only marks versioned icon URLs immutable', async () => {
  const app = createApp()
  const manifestResponse = await app.request(
    'https://atlas.example.com/pwa/manifest/atlas.inventory.webmanifest',
  )
  const manifestEtag = manifestResponse.headers.get('etag')
  const revalidatedManifest = await app.request(
    'https://atlas.example.com/pwa/manifest/atlas.inventory.webmanifest',
    { headers: { 'if-none-match': manifestEtag } },
  )
  const unversionedIcon = await app.request(
    'https://atlas.example.com/pwa/icon/atlas.inventory/192.png',
  )
  const versionedIcon = await app.request(
    'https://atlas.example.com/pwa/icon/atlas.inventory/192.png?v=abc123',
  )

  assert.equal(revalidatedManifest.status, 304)
  assert.match(unversionedIcon.headers.get('cache-control'), /must-revalidate/)
  assert.match(versionedIcon.headers.get('cache-control'), /immutable/)
})

test('returns 404 for disabled or invalid module PWA identities', async () => {
  modules.set('custom.disabled', {
    key: 'custom.disabled',
    status: 'INSTALLED',
    enabled: false,
    version: '0.1.0',
    manifest: {
      name: 'Disabled',
      icon: 'Box',
      color: '#6366f1',
      pwa: { shortName: 'Disabled', startPath: '/' },
    },
  })
  modules.set('custom.invalid', {
    key: 'custom.invalid',
    status: 'INSTALLED',
    enabled: true,
    version: '0.1.0',
    manifest: {
      name: 'Invalid',
      icon: 'UnknownIcon',
      color: '#6366f1',
      pwa: { shortName: 'Invalid', startPath: '/' },
    },
  })
  modules.set('custom.external-logo', {
    key: 'custom.external-logo',
    status: 'INSTALLED',
    enabled: true,
    version: '0.1.0',
    manifest: {
      name: 'External logo',
      icon: 'Box',
      color: '#6366f1',
      logoUrl: 'https://example.com/logo.svg',
      pwa: { shortName: 'External', startPath: '/' },
    },
  })
  modules.set('custom.traversal-logo', {
    key: 'custom.traversal-logo',
    status: 'INSTALLED',
    enabled: true,
    version: '0.1.0',
    manifest: {
      name: 'Traversal logo',
      icon: 'Box',
      color: '#6366f1',
      logoUrl: '/module-logos/../secret.svg',
      pwa: { shortName: 'Traversal', startPath: '/' },
    },
  })

  const app = createApp()
  const disabled = await app.request(
    'https://atlas.example.com/pwa/manifest/custom.disabled.webmanifest',
  )
  const invalid = await app.request(
    'https://atlas.example.com/pwa/manifest/custom.invalid.webmanifest',
  )
  const externalLogo = await app.request(
    'https://atlas.example.com/pwa/manifest/custom.external-logo.webmanifest',
  )
  const traversalLogo = await app.request(
    'https://atlas.example.com/pwa/manifest/custom.traversal-logo.webmanifest',
  )

  assert.equal(disabled.status, 404)
  assert.equal(invalid.status, 404)
  assert.equal(externalLogo.status, 404)
  assert.equal(traversalLogo.status, 404)
})
