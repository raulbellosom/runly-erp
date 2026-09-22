// apps/api/src/routes/ledger/ai-import-routes.js
import { Hono } from 'hono'
import { aiImportCommitSchema } from './validators.js'
import { createAiImportService, AiImportServiceError } from './ai-import-service.js'
import {
  ExtractionError, extractPdfPages, extractRowsFromText, extractStatementRows, suggestColumnMapping,
} from './ai-import-extraction.js'
import { dedupeIntraFile, markDbDuplicates } from './ai-import-dedup.js'
import { ImportTokenError } from './ai-import-token.js'
import { getCompanyId, getActorId, getValidationErrorMessage } from './service-helpers.js'
import { prepareVisionImage } from '../../services/vision-image.js'
import { VisionServiceError } from '../../services/vision-service.js'

const MAX_FILE_BYTES = 15 * 1024 * 1024
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function handleError(c, err, fallback) {
  if (err instanceof AiImportServiceError) return c.json({ error: err.message }, err.status)
  if (err instanceof ImportTokenError) return c.json({ error: err.message }, err.status)
  if (err instanceof VisionServiceError) return c.json({ error: err.message }, err.status || 502)
  if (err?.name === 'ExtractionError') return c.json({ error: err.message }, err.status || 422)
  if (err instanceof SyntaxError) return c.json({ error: 'El cuerpo de la solicitud no es JSON valido.' }, 400)
  if (process.env.NODE_ENV !== 'production') console.error('[runly.ledger/ai-import]', err)
  return c.json({ error: fallback }, 500)
}

// account match -> intra-file/DB dedup -> signed proof token -> response shape.
// Shared tail for all three recognize() branches (PDF, image, CSV/XLSX) so the
// account-match/dedup/sign/response logic exists exactly once.
async function finishRecognize({ rawRows, documentText, companyId, actorId, service }) {
  const dedupedRows = dedupeIntraFile(rawRows)
  const { detectedAccount, candidateAccounts, existingTransactions } = await service.recognize({
    companyId,
    documentText,
  })
  const flaggedRows = markDbDuplicates(dedupedRows, existingTransactions)
  const rows = flaggedRows.map((row, index) => ({ tempId: `row-${index}`, ...row }))
  const proofToken = service.signImportProof({
    companyId,
    actorId,
    rowsHash: String(JSON.stringify(rows).length),
  })
  return { proofToken, detectedAccount, candidateAccounts, rows, warnings: [] }
}

export function createAiImportRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const service = createAiImportService({ prisma })

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
      const filename = String(file.name || '').toLowerCase()
      const mimeType = file.type

      if (filename.endsWith('.pdf')) {
        const { pages } = await extractPdfPages(buffer)
        const { rows: rawRows } = await extractStatementRows({
          pages,
          extractText: extractRowsFromText,
          extractVisionPage: service.vision.extractLedgerStatementPage,
        })
        const documentText = pages.map((p) => p.text).join('\n')
        return c.json({ data: await finishRecognize({ rawRows, documentText, companyId, actorId, service }) })
      }

      if (IMAGE_MIME_TYPES.includes(mimeType)) {
        // Photos/screenshots of full statements run far larger than receipt
        // photos (which already go through this same resize before hitting
        // Groq — see receipts-service.js). Skipping it here let raw
        // multi-MB uploads through, which Groq's vision endpoint rejects.
        let visionBuffer
        try {
          visionBuffer = await prepareVisionImage(buffer)
        } catch (err) {
          throw new ExtractionError(err.message, 422)
        }
        const imageBase64 = visionBuffer.toString('base64')
        const { parsed } = await service.vision.extractLedgerStatementPage({ imageBase64, mimeType: 'image/jpeg' })
        const rawRows = parsed.rows ?? []
        return c.json({ data: await finishRecognize({ rawRows, documentText: '', companyId, actorId, service }) })
      }

      if (filename.endsWith('.csv') || filename.endsWith('.xlsx')) {
        // import-service.js uses optional heavy deps (exceljs, csv-parse) — load
        // lazily so tests that only exercise other routers stay light (same
        // convention as accounts-routes.js).
        const { parseImportBuffer, validateImportRows } = await import('./import-service.js')
        const isCsv = filename.endsWith('.csv')
        const rawHeaderRows = await parseImportBuffer(buffer, isCsv ? 'csv' : 'xlsx')
        if (rawHeaderRows.length === 0) return c.json({ error: 'El archivo no tiene datos.' }, 422)
        const headers = Object.keys(rawHeaderRows[0])
        const mapping = await suggestColumnMapping({ headers })
        // nombre is required downstream (validateImportRows rejects rows without
        // it), but many real bank exports have no dedicated counterparty column,
        // only a general "Concepto"/"Descripcion" one — confirmed against a live
        // mapping call during manual testing, where the model correctly left
        // nombre unmapped rather than inventing a column, which would otherwise
        // silently reject every row. Fall back to reusing concepto as nombre
        // rather than relying on prompt wording to always avoid this.
        if (!mapping.nombre && mapping.concepto) mapping.nombre = mapping.concepto
        const { valid: rawRows } = validateImportRows(rawHeaderRows, mapping)
        return c.json({ data: await finishRecognize({ rawRows, documentText: '', companyId, actorId, service }) })
      }

      return c.json({ error: 'Formato no soportado. Usa PDF, imagen, CSV o XLSX.' }, 400)
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
