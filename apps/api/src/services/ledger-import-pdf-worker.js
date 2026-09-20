import { parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// Parse untrusted PDFs away from the API event loop. Unlike
// inventory-chat-pdf-worker.js (which truncates aggressively for chat
// context), a bank statement needs every row, so this only caps page COUNT
// (20) as a hard safety limit — it does not truncate total text length.
const MAX_PAGES = 20

const task = getDocument({
  data: new Uint8Array(workerData), isEvalSupported: false, useSystemFonts: false,
  disableFontFace: true, useWasm: false,
  standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))).replaceAll('\\', '/'),
})

try {
  const pdf = await task.promise
  const truncated = pdf.numPages > MAX_PAGES
  const pages = []
  for (let page = 1; page <= Math.min(pdf.numPages, MAX_PAGES); page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    const text = content.items.map((item) => item.str ?? '').join(' ').trim()
    pages.push({ page, text, empty: text.length < 10 })
  }
  parentPort.postMessage({ pages, truncated, totalPages: pdf.numPages })
} catch {
  parentPort.postMessage({ error: true })
} finally {
  await task.destroy()
}
