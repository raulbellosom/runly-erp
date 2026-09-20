import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { isReasoningModel } from '../../services/groq-model-helpers.js'

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
// pages) into one ordered list, dropping rows the model returned with no
// usable identity (no date and no name — extraction noise, not a real row).
export function mergeChunkedRows(chunks) {
  const merged = []
  for (const chunk of chunks) {
    for (const row of chunk) {
      if (!row.fecha && !row.nombre) continue
      merged.push(row)
    }
  }
  return merged
}

const STATEMENT_SYSTEM_PROMPT = [
  'Eres un extractor de movimientos bancarios en español (México). Recibes el texto plano de un estado de cuenta (puede venir de varias paginas y de mas de un formato de reporte del mismo banco).',
  'Devuelve UNICAMENTE un objeto JSON: {"rows": [{"fecha": "YYYY-MM-DD", "nombre": string, "referencia": string|null, "concepto": string|null, "numero": string|null, "deposito": number|null, "retiro": number|null}]}.',
  'El texto extraido de PDF pierde la alineacion de columnas: cuando no sea obvio si un monto fue deposito o retiro, usa el SALDO (columna de saldo corriente) para inferirlo — si el saldo sube, es deposito; si baja, es retiro.',
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

// Text-only sibling of vision-service.js's Groq adapter — same transport,
// retries and reasoning-model handling, but no image content block.
export async function extractRowsFromText({ text, env = process.env, fetchImpl }) {
  const apiKey = env.GROQ_API_KEY
  if (!apiKey) {
    const err = new ExtractionError('Importacion con IA no configurada (falta GROQ_API_KEY).', 503)
    throw err
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
      { role: 'system', content: STATEMENT_SYSTEM_PROMPT },
      { role: 'user', content: text.slice(0, 60000) },
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
    if (!obj?.rows) throw new ExtractionError('El servicio de IA no devolvio un JSON legible.')
    return { rows: obj.rows, model: payload.model ?? model }
  }
  throw lastErr
}
