// apps/api/src/routes/ledger/ai-import-routes.js
import { Hono } from 'hono'
import { aiImportCommitSchema } from './validators.js'
import { createAiImportService, AiImportServiceError } from './ai-import-service.js'
import { createAiRouter } from '../../services/ai/ai-router.js'
import { recognizeStatementFile } from './ai-import-recognize.js'
import { ImportTokenError } from './ai-import-token.js'
import { getCompanyId, getActorId, getValidationErrorMessage } from './service-helpers.js'
import { VisionServiceError } from '../../services/vision-service.js'

const MAX_FILE_BYTES = 15 * 1024 * 1024

function handleError(c, err, fallback) {
  if (err instanceof AiImportServiceError) return c.json({ error: err.message }, err.status)
  if (err instanceof ImportTokenError) return c.json({ error: err.message }, err.status)
  if (err instanceof VisionServiceError) return c.json({ error: err.message }, err.status || 502)
  if (err?.name === 'ExtractionError') return c.json({ error: err.message }, err.status || 422)
  if (err instanceof SyntaxError) return c.json({ error: 'El cuerpo de la solicitud no es JSON valido.' }, 400)
  if (process.env.NODE_ENV !== 'production') console.error('[runly.ledger/ai-import]', err)
  return c.json({ error: fallback }, 500)
}

export function createAiImportRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const service = createAiImportService({ prisma })
  const aiRouter = createAiRouter({ env: process.env })

  app.post('/ledger/imports/recognize', requirePermission('ledger.import'), async (c) => {
    try {
      const form = await c.req.formData()
      const file = form.get('file')
      if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
        return c.json({ error: 'Adjunta un archivo.' }, 400)
      }
      const buffer = Buffer.from(await file.arrayBuffer())
      if (buffer.length > MAX_FILE_BYTES) {
        return c.json({ error: 'El archivo excede el tamano maximo de 15MB.' }, 400)
      }

      const companyId = getCompanyId(c)
      const actorId = getActorId(c)
      const data = await recognizeStatementFile({
        buffer, filename: file.name, mimeType: file.type, companyId, actorId, service, aiRouter,
      })
      return c.json({ data })
    } catch (err) {
      return handleError(c, err, 'No se pudo analizar el archivo.')
    }
  })

  app.post('/ledger/imports/commit', requirePermission('ledger.import'), async (c) => {
    try {
      const parsed = aiImportCommitSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)

      service.verifyImportProof(parsed.data.proofToken)

      const result = await service.commit({
        companyId: getCompanyId(c),
        actorId: getActorId(c),
        accountId: parsed.data.accountId,
        batchKey: parsed.data.batchKey,
        rows: parsed.data.rows,
      })
      return c.json({ data: result })
    } catch (err) {
      return handleError(c, err, 'No se pudo completar la importacion.')
    }
  })

  return app
}
