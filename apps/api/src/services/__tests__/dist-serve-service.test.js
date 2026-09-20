import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  isAssetPath,
  resolveHtmlCandidates,
  injectSeoTags,
  rewriteDistHtml,
  injectRunlyConfig,
  normalizeHost,
  createDistServeService,
  invalidatePrimaryCache,
} from '../dist-serve-service.js'

describe('normalizeHost', () => {
  it('returns null for null/undefined/empty input', () => {
    assert.equal(normalizeHost(null), null)
    assert.equal(normalizeHost(undefined), null)
    assert.equal(normalizeHost(''), null)
  })

  it('strips protocol, path, port, and a leading www.', () => {
    assert.equal(normalizeHost('https://www.Example.com/some/path'), 'example.com')
    assert.equal(normalizeHost('http://example.com:8080'), 'example.com')
    assert.equal(normalizeHost('example.com'), 'example.com')
  })

  it('lowercases the hostname', () => {
    assert.equal(normalizeHost('Example.COM'), 'example.com')
  })

  it('a bare domain and its stored https:// form normalize identically', () => {
    // The exact shapes seen in practice: Host header is bare, website_site.domain is a full URL.
    assert.equal(normalizeHost('storefront.example.com'), normalizeHost('https://storefront.example.com'))
  })
})

function makeContextMock(headers) {
  return {
    req: { header: (name) => headers[name.toLowerCase()] ?? headers[name] ?? undefined },
    json: (body, status) => ({ __kind: 'json', body, status }),
    text: (body, status) => ({ __kind: 'text', body, status }),
    html: (body) => ({ __kind: 'html', body }),
    header: () => {},
  }
}

function makeSiteRow(overrides = {}) {
  return {
    id: 'site-1',
    source_type: 'dist',
    seo_defaults: null,
    company_id: 'company-1',
    site_name: 'Test Site',
    domain: null,
    analytics_mode: 'off',
    turnstile_site_key: null,
    stripe_publishable_key: null,
    stripe_currency: null,
    company_slug: 'testco',
    ...overrides,
  }
}

// Discriminator convention used across these tests: the site that SHOULD be
// selected is given source_type 'none' (serve() returns a distinguishable
// { __kind: 'json', status: 404 }); the site that should NOT be selected is
// given source_type 'builder' (serve() returns bare `null`). Since only one
// of the two candidates can ever produce each shape, observing which one
// came back unambiguously proves which site actually won.
describe('createDistServeService — domain-based resolution (serve)', () => {
  beforeEach(() => invalidatePrimaryCache())

  it('resolves by matching Host header against a registered website_site.domain, even when a different primary company is configured', async () => {
    const domainSite = makeSiteRow({ id: 'site-domain', company_slug: 'domainco', domain: 'https://example.com', source_type: 'none' })
    const primarySite = makeSiteRow({ id: 'site-primary', company_slug: 'primaryco', source_type: 'builder' })
    const prisma = {
      instanceConfig: { findUnique: async () => ({ value: 'company-primary' }) },
      $queryRaw: async (strings) => {
        const sql = strings.join('?')
        return sql.includes('ws.domain IS NOT NULL') ? [domainSite] : [primarySite]
      },
    }
    const svc = createDistServeService({ prisma, supabaseAdmin: {} })
    const c = makeContextMock({ host: 'www.example.com' })
    const result = await svc.serve(c, '/')
    assert.equal(result?.__kind, 'json', 'expected the domain-matched site (source_type none) to win, not the primary one')
    assert.equal(result.status, 404)
  })

  it('falls back to the primary-company lookup when the Host header matches no registered domain', async () => {
    const primarySite = makeSiteRow({ id: 'site-primary', company_slug: 'primaryco', source_type: 'none' })
    const prisma = {
      instanceConfig: { findUnique: async () => ({ value: 'company-primary' }) },
      $queryRaw: async (strings) => {
        const sql = strings.join('?')
        return sql.includes('ws.domain IS NOT NULL') ? [] : [primarySite] // no domains registered at all
      },
    }
    const svc = createDistServeService({ prisma, supabaseAdmin: {} })
    const c = makeContextMock({ host: 'localhost:5173' })
    const result = await svc.serve(c, '/')
    assert.equal(result?.__kind, 'json')
    assert.equal(result.status, 404)
  })

  it('a malformed/empty domain row never matches a real request (fails safe, falls back to primary)', async () => {
    const badRow = makeSiteRow({ domain: '', company_slug: 'bad', source_type: 'none' })
    const primarySite = makeSiteRow({ id: 'site-primary', company_slug: 'primaryco', source_type: 'builder' })
    const prisma = {
      instanceConfig: { findUnique: async () => ({ value: 'company-primary' }) },
      $queryRaw: async (strings) => {
        const sql = strings.join('?')
        // Real Postgres would already exclude this via `domain <> ''`, but
        // guard defensively in the JS map-building step too, in case a
        // NULL/'' slipped through some other path.
        return sql.includes('ws.domain IS NOT NULL') ? [badRow] : [primarySite]
      },
    }
    const svc = createDistServeService({ prisma, supabaseAdmin: {} })
    const c = makeContextMock({ host: 'anything.example' })
    const result = await svc.serve(c, '/')
    assert.equal(result, null, 'expected the malformed row to be skipped and the primary (builder) site to win')
  })

  it('an unrelated Host header (e.g. the ERP app itself) never matches and falls back to primary', async () => {
    const domainSite = makeSiteRow({ domain: 'https://storefront.example.com', company_slug: 'storefront', source_type: 'none' })
    const primarySite = makeSiteRow({ id: 'site-primary', company_slug: 'primaryco', source_type: 'builder' })
    const prisma = {
      instanceConfig: { findUnique: async () => ({ value: 'company-primary' }) },
      $queryRaw: async (strings) => {
        const sql = strings.join('?')
        return sql.includes('ws.domain IS NOT NULL') ? [domainSite] : [primarySite]
      },
    }
    const svc = createDistServeService({ prisma, supabaseAdmin: {} })
    const c = makeContextMock({ host: 'atlas-admin.internal.example.com' })
    const result = await svc.serve(c, '/')
    assert.equal(result, null, 'an unrelated hostname must not accidentally match a registered storefront domain')
  })
})

describe('isAssetPath', () => {
  it('returns true for .js files', () => assert.equal(isAssetPath('/assets/main.js'), true))
  it('returns true for .css files', () => assert.equal(isAssetPath('/assets/style.css'), true))
  it('returns true for .png files', () => assert.equal(isAssetPath('/logo.png'), true))
  it('returns true for .woff2 files', () => assert.equal(isAssetPath('/font.woff2'), true))
  it('returns false for root path', () => assert.equal(isAssetPath('/'), false))
  it('returns false for clean routes', () => assert.equal(isAssetPath('/productos'), false))
  it('returns false for nested routes', () => assert.equal(isAssetPath('/bandas/rock-band'), false))
})

describe('resolveHtmlCandidates', () => {
  it('returns three candidates for a clean route', () => {
    const result = resolveHtmlCandidates('myco', '/productos/zapatos')
    assert.deepEqual(result, [
      'dist/myco/productos/zapatos/index.html',
      'dist/myco/productos/zapatos.html',
      'dist/myco/index.html',
    ])
  })

  it('returns only fallback for root path', () => {
    const result = resolveHtmlCandidates('myco', '/')
    assert.deepEqual(result, [
      'dist/myco/index.html',
      'dist/myco/index.html',
      'dist/myco/index.html',
    ])
  })
})

describe('rewriteDistHtml', () => {
  const base = 'https://cdn.example.com/dist/myco'

  it('replaces localhost:PORT with siteOrigin in href attributes', () => {
    const html = '<html><head></head><body><a href="http://localhost:4321/about">Link</a></body></html>'
    const result = rewriteDistHtml(html, base, '', 'https://mysite.com')
    assert.ok(result.includes('href="https://mysite.com/about"'))
    assert.ok(!result.includes('localhost'))
  })

  it('replaces localhost:PORT in meta og:url content', () => {
    const html = '<html><head><meta property="og:url" content="http://localhost:4321/" /></head><body></body></html>'
    const result = rewriteDistHtml(html, base, '', 'https://mysite.com')
    assert.ok(result.includes('https://mysite.com/'))
    assert.ok(!result.includes('localhost'))
  })

  it('replaces localhost in inline script strings (e.g. Astro router config)', () => {
    const html = '<html><head><script>var base="http://localhost:4321";</script></head><body></body></html>'
    const result = rewriteDistHtml(html, base, '', 'https://mysite.com')
    assert.ok(result.includes('"https://mysite.com"'))
    assert.ok(!result.includes('localhost'))
  })

  it('leaves html unchanged when siteOrigin is empty', () => {
    const html = '<html><head></head><body><a href="http://localhost:4321/">x</a></body></html>'
    const result = rewriteDistHtml(html, base, '', '')
    assert.ok(result.includes('localhost:4321'))
  })
})

describe('injectSeoTags', () => {
  it('injects title when missing', () => {
    const html = '<html><head></head><body></body></html>'
    const seo = { title: 'Mi Sitio', description: 'Descripcion' }
    const result = injectSeoTags(html, seo)
    assert.ok(result.includes('<title>Mi Sitio</title>'))
    assert.ok(result.includes('<meta name="description"'))
  })

  it('does not overwrite existing title', () => {
    const html = '<html><head><title>Titulo Propio</title></head><body></body></html>'
    const seo = { title: 'Mi Sitio' }
    const result = injectSeoTags(html, seo)
    const titleCount = (result.match(/<title>/g) ?? []).length
    assert.equal(titleCount, 1)
    assert.ok(result.includes('Titulo Propio'))
  })

  it('returns html unchanged when seoDefaults is null', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectSeoTags(html, null)
    assert.equal(result, html)
  })
})

describe('injectRunlyConfig', () => {
  const cfg = {
    supabaseUrl: 'https://supabase.example.com',
    supabaseAnonKey: 'eyJtest',
    apiUrl: 'https://mysite.com',
    company: 'acme',
    siteName: 'Acme Store',
    stripePublishableKey: 'pk_test_123',
    currency: 'usd',
    siteId: 'site-123',
    analyticsMode: 'consent_required',
    turnstileSiteKey: 'turnstile-public',
  }

  it('injects window.RUNLY_CONFIG script into <head>', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectRunlyConfig(html, cfg)
    assert.ok(result.includes('window.RUNLY_CONFIG='))
    assert.ok(result.includes('<script src="/public/site/runly-sdk.js" defer></script>'))
    assert.ok(result.includes('supabase.example.com'))
    assert.ok(result.includes('eyJtest'))
  })

  it('computes storageKey from hostname', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectRunlyConfig(html, cfg)
    assert.ok(result.includes('"storageKey":"sb-supabase-auth-token"'))
  })

  it('injects company and siteName fields', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectRunlyConfig(html, cfg)
    assert.ok(result.includes('"company":"acme"'))
    assert.ok(result.includes('"siteName":"Acme Store"'))
  })

  it('injects public capture settings without a Turnstile secret', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectRunlyConfig(html, {
      ...cfg,
      turnstileSecretKey: 'must-not-leak',
    })
    assert.ok(result.includes('"siteId":"site-123"'))
    assert.ok(result.includes('"analyticsMode":"consent_required"'))
    assert.ok(result.includes('"turnstileSiteKey":"turnstile-public"'))
    assert.ok(!result.includes('must-not-leak'))
    assert.ok(!result.includes('turnstileSecretKey'))
  })

  it('injects stripePublishableKey and currency when provided', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectRunlyConfig(html, cfg)
    assert.ok(result.includes('"stripePublishableKey":"pk_test_123"'))
    assert.ok(result.includes('"currency":"usd"'))
  })

  it('omits stripePublishableKey when not provided', () => {
    const { stripePublishableKey: _, ...rest } = cfg
    const html = '<html><head></head><body></body></html>'
    const result = injectRunlyConfig(html, rest)
    assert.ok(!result.includes('stripePublishableKey'))
  })

  it('places script tag immediately after <head>', () => {
    const html = '<html><head><title>X</title></head><body></body></html>'
    const result = injectRunlyConfig(html, cfg)
    const headIdx   = result.indexOf('<head>')
    const scriptIdx = result.indexOf('<script>window.RUNLY_CONFIG')
    assert.ok(scriptIdx > headIdx && scriptIdx < result.indexOf('<title>'))
  })

  it('escapes </script> sequences in values', () => {
    const tricky = { ...cfg, supabaseAnonKey: 'a</script>b' }
    const html = '<html><head></head><body></body></html>'
    const result = injectRunlyConfig(html, tricky)
    assert.ok(!result.includes('</script>b'))
  })

  it('returns html unchanged when supabaseUrl is missing', () => {
    const html = '<html><head></head><body></body></html>'
    const result = injectRunlyConfig(html, { supabaseUrl: '', supabaseAnonKey: 'k', apiUrl: '/', company: '' })
    assert.equal(result, html)
  })
})
