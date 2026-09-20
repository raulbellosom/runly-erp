import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

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
