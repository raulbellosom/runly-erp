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
    let imageBase64 = null
    if (text.length < 10) {
      const pdfPage = await pdf.getPage(page)
      const opList = await pdfPage.getOperatorList()
      const { OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
      const imgIndex = opList.fnArray.findIndex((fn) => fn === OPS.paintImageXObject)
      if (imgIndex !== -1) {
        const objId = opList.argsArray[imgIndex][0]
        const img = await new Promise((resolve) => pdfPage.objs.get(objId, resolve))
        if (img?.data && img.width && img.height) {
          // img.data is raw RGB(A); re-encode as JPEG so it's a normal image
          // buffer the same vision call path (which expects a mime type +
          // base64) can use without special-casing raw pixel buffers.
          const { default: sharp } = await import('sharp')
          const channels = img.data.length / (img.width * img.height)
          const jpeg = await sharp(Buffer.from(img.data), {
            raw: { width: img.width, height: img.height, channels: Math.round(channels) },
          }).jpeg({ quality: 80 }).toBuffer()
          imageBase64 = jpeg.toString('base64')
        }
      }
    }
    pages.push({ page, text, empty: text.length < 10, imageBase64 })
  }
  parentPort.postMessage({ pages, truncated, totalPages: pdf.numPages })
} catch {
  parentPort.postMessage({ error: true })
} finally {
  await task.destroy()
}
