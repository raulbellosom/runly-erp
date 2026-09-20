import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { isReasoningModel } from '../../services/groq-model-helpers.js'
import { isValidRow } from './ai-import-dedup.js'

const WORKER_PATH = fileURLToPath(new URL('../../services/ledger-import-pdf-worker.js', import.meta.url))
const WORKER_TIMEOUT_MS = 15000

export class ExtractionError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.name = 'ExtractionError'
    this.status = status
  }
}

// Runs the PDF text-extraction worker and resolves with per-page text.
export function extractPdfPages(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: buffer })
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new ExtractionError('El PDF tardo demasiado en procesarse.'))
    }, WORKER_TIMEOUT_MS)
    worker.once('message', (msg) => {
      clearTimeout(timer)
      worker.terminate()
      if (msg.error) return reject(new ExtractionError('No se pudo leer el PDF.'))
      resolve(msg)
    })
    worker.once('error', (err) => {
      clearTimeout(timer)
      reject(new ExtractionError(`No se pudo leer el PDF: ${err.message}`))
    })
  })
}

// Combines rows extracted from multiple text chunks (or multiple vision
// pages) into one ordered list. Validity filtering (isValidRow, from
// ai-import-dedup.js) is applied again here as a first pass close to the
// model output, but ALSO happens uniformly for every ingestion path (PDF,
// image, CSV/XLSX) inside dedupeIntraFile — see that function's docstring.
export function mergeChunkedRows(chunks) {
  const merged = []
  for (const chunk of chunks) {
    for (const row of chunk) {
      if (!isValidRow(row)) continue
      merged.push(row)
    }
  }
  return merged
}

const STATEMENT_SYSTEM_PROMPT = [
  'Eres un extractor de movimientos bancarios en español (México). Recibes el texto plano de un estado de cuenta (puede venir de varias paginas y de mas de un formato de reporte del mismo banco).',
  'Devuelve UNICAMENTE un objeto JSON: {"rows": [{"fecha": "YYYY-MM-DD", "nombre": string, "referencia": string|null, "concepto": string|null, "numero": string|null, "deposito": number|null, "retiro": number|null}]}.',
  'El texto extraido de PDF pierde la alineacion de columnas, y el nombre de un encabezado como "IMPORTE DEPOSITO" cerca de un monto NO garantiza que ese monto sea realmente un deposito si el texto esta desalineado. Por eso, cuando el saldo corriente (columna SALDO/SALDO ACTUAL) este presente en filas consecutivas, tiene PRIORIDAD sobre cualquier encabezado de columna: calcula saldo_fila_actual MENOS saldo_fila_anterior — si el resultado es POSITIVO (el saldo subio), es deposito; si es NEGATIVO (el saldo bajo), es retiro. Aplica este calculo fila por fila en el orden en que aparecen, para TODAS las filas donde haya saldo disponible, incluso si el encabezado de columna parece indicar lo contrario.',
  'Un mismo movimiento puede aparecer representado dos veces en el documento (p. ej. una tabla oficial y despues un detalle o captura de la misma cuenta). Si detectas con alta confianza que dos filas son el mismo movimiento (misma fecha, mismo monto, mismo tercero), devuelve una sola fila.',
  'exactamente un valor de deposito o retiro debe ser no-nulo por fila (nunca ambos, nunca ninguno si el monto es legible). fecha siempre en formato ISO. Si no puedes leer un campo, usa null. No inventes movimientos que no esten en el texto.',
].join(' ')

function extractJsonObject(text) {
  if (typeof text !== 'string') return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
}

// Shared Groq text-completion transport — retries, reasoning-model handling
// and JSON-object parsing — used by both extractRowsFromText (statement row
// extraction) and suggestColumnMapping (CSV/XLSX header mapping) so neither
// duplicates the HTTP/retry plumbing.
async function callGroqText({ systemPrompt, userContent, env = process.env, fetchImpl }) {
  const apiKey = env.GROQ_API_KEY
  if (!apiKey) {
    throw new ExtractionError('Importacion con IA no configurada (falta GROQ_API_KEY).', 503)
  }
  const baseUrl = (env.LEDGER_IMPORT_BASE_URL || env.GROQ_BASE_URL || 'https://api.groq.com').replace(/\/$/, '')
  const model = env.LEDGER_IMPORT_MODEL || 'openai/gpt-oss-120b'
  const fetchFn = fetchImpl ?? globalThis.fetch
  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    max_completion_tokens: 8000,
    ...(isReasoningModel(model) ? { reasoning_format: 'hidden', reasoning_effort: 'low' } : {}),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent.slice(0, 60000) },
    ],
  }

  let lastErr
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500))
    let res
    try {
      res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      })
    } catch (err) {
      lastErr = new ExtractionError(`No se pudo contactar al servicio de IA: ${err.message}`, 502)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new ExtractionError(`El servicio de IA respondio ${res.status}.`, 502)
      continue
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new ExtractionError(`El servicio de IA rechazo la peticion (${res.status}): ${detail.slice(0, 300)}`)
    }
    const payload = await res.json()
    const content = payload?.choices?.[0]?.message?.content
    const obj = extractJsonObject(content)
    if (!obj) throw new ExtractionError('El servicio de IA no devolvio un JSON legible.')
    return { obj, model: payload.model ?? model }
  }
  throw lastErr
}

// Text-only sibling of vision-service.js's Groq adapter — same transport,
// retries and reasoning-model handling, but no image content block.
export async function extractRowsFromText({ text, env = process.env, fetchImpl }) {
  const { obj, model } = await callGroqText({ systemPrompt: STATEMENT_SYSTEM_PROMPT, userContent: text, env, fetchImpl })
  if (!obj.rows) throw new ExtractionError('El servicio de IA no devolvio un JSON legible.')
  return { rows: obj.rows, model }
}

const COLUMN_MAPPING_SYSTEM_PROMPT = [
  'Recibes los encabezados de columna de un archivo CSV/Excel de movimientos bancarios en español (México).',
  'Devuelve UNICAMENTE un JSON con esta forma, usando EXACTAMENTE el texto del encabezado que corresponde a cada campo, o null si no existe: {"fecha": string|null, "nombre": string|null, "deposito": string|null, "retiro": string|null, "referencia": string|null, "concepto": string|null, "numero": string|null}.',
  'fecha es la columna de fecha del movimiento. nombre es la contraparte/descripcion principal. deposito es abono/entrada/ingreso. retiro es cargo/salida/egreso. numero es folio o numero de referencia corto. concepto es una nota o descripcion adicional.',
].join(' ')

// Asks the model to map a CSV/XLSX header row onto the fixed statement-row
// field names, so the caller can feed the result straight into the existing
// validateImportRows(rawRows, mapping) — no separate parsing/transport path.
export async function suggestColumnMapping({ headers, env = process.env, fetchImpl }) {
  const { obj } = await callGroqText({ systemPrompt: COLUMN_MAPPING_SYSTEM_PROMPT, userContent: headers.join(', '), env, fetchImpl })
  return obj
}

// Orchestrates extraction across all pages of a document: text pages go
// through the cheap text extractor, pages with no extractable text (scanned
// or photographed) go through vision, page by page. Dependencies are
// injected so this stays unit-testable without a real Groq call or a real
// PDF renderer.
export async function extractStatementRows({ pages, extractText, extractVisionPage }) {
  const textPages = pages.filter((p) => !p.empty)
  const imagePages = pages.filter((p) => p.empty)

  const chunks = []
  if (textPages.length > 0) {
    const combinedText = textPages.map((p) => `\nPagina ${p.page}:\n${p.text}`).join('\n')
    const { rows } = await extractText({ text: combinedText })
    chunks.push(rows)
  }
  for (const page of imagePages) {
    if (!page.imageBase64) continue // no embedded image found — surfaced as a warning by the caller
    const { parsed } = await extractVisionPage({ imageBase64: page.imageBase64, mimeType: 'image/jpeg' })
    chunks.push(parsed.rows ?? [])
  }

  return { rows: mergeChunkedRows(chunks) }
}
