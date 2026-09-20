import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createPublicWebsiteRouter } from '../public-website.js'

describe('public website capture config', () => {
  it('returns public company, analytics, and Turnstile settings', async () => {
    const prisma = {
      instanceConfig: {
        findUnique: async ({ where }) => ({ value: where.key === 'initialized' ? 'true' : '01900000-0000-7000-8000-000000000001' }),
      },
      company: {
        findFirst: async () => ({
          id: '01900000-0000-7000-8000-000000000001',
          slug: 'acme',
        }),
      },
      $queryRaw: async (strings) => {
        const sql = strings.join(' ')
        if (sql.includes('FROM website_site')) {
          return [{
            id: '01900000-0000-7000-8000-000000000002',
            company_id: '01900000-0000-7000-8000-000000000001',
            company_slug: 'acme',
            name: 'Acme',
            domain: 'https://shop.example.com',
            status: 'published',
            theme_id: null,
            source_type: 'builder',
            analytics_mode: 'consent_required',
            turnstile_site_key: 'public-key',
          }]
        }
        if (sql.includes('FROM website_page')) return []
        if (sql.includes('FROM website_menu')) return []
        return []
      },
    }
    const app = createPublicWebsiteRouter({
      prisma,
      supabaseAdmin: {},
    })

    const response = await app.request('http://localhost/resolve?path=/')
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.site, {
      id: '01900000-0000-7000-8000-000000000002',
      name: 'Acme',
      domain: 'https://shop.example.com',
      sourceType: 'builder',
      company: 'acme',
      analyticsMode: 'consent_required',
      turnstileSiteKey: 'public-key',
    })
  })
})
