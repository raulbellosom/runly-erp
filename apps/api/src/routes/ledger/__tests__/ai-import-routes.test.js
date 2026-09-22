// apps/api/src/routes/ledger/__tests__/ai-import-routes.test.js
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import sharp from 'sharp'
import { createAiImportRouter } from '../ai-import-routes.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const ACTOR_ID = '01900000-0000-7000-8000-000000000002'

function buildApp() {
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set('companyId', COMPANY_ID)
    c.set('userContext', { profile: { id: ACTOR_ID } })
    await next()
  })
  const passthrough = () => async (c, next) => next()
  app.route('/', createAiImportRouter({
    prisma: { $queryRaw: async () => [], auditLog: { findFirst: async () => null } },
    requirePermission: passthrough,
  }))
  return app
}

describe('ai-import-routes POST /ledger/imports/recognize (image)', () => {
  let savedGroqKey

  before(() => { savedGroqKey = process.env.GROQ_API_KEY; delete process.env.GROQ_API_KEY })
  after(() => { if (savedGroqKey !== undefined) process.env.GROQ_API_KEY = savedGroqKey })

  it('surfaces the vision service error status/message instead of an opaque 500', async () => {
    const app = buildApp()
    const jpeg = await sharp({
      create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 255, b: 255 } },
    }).jpeg().toBuffer()

    const form = new FormData()
    form.set('file', new File([jpeg], 'estado.jpg', { type: 'image/jpeg' }))
    const res = await app.request('/ledger/imports/recognize', { method: 'POST', body: form })

    // Previously this fell through handleError's generic branch (only
    // AiImportServiceError/ImportTokenError/ExtractionError were matched)
    // and always came back as a 500 "No se pudo analizar el archivo.",
    // hiding the real reason from both the client and (in production,
    // where the console.error is suppressed) the server logs.
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.match(body.error, /OCR no configurado/)
  })
})
