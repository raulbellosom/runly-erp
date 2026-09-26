// pdfjs-dist's browser build runs DOM-only code (e.g. `new DOMMatrix()`) at
// module-eval time, which crashes under plain Node. Loaded lazily, only by
// the PDF-specific functions below, so the pure helpers in this file
// (dpiToScale, computeFitDimensions, readImageFullRes) stay unit-testable
// and every other caller of this module doesn't pay for pdfjs upfront.
let pdfjsPromise = null
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((pdfjsLib) => {
      // Same worker file PDFViewer.jsx already serves — copied to public/ by
      // the app's postinstall script from this same pdfjs-dist dependency.
      // Resolve against Vite's BASE_URL, not a root-absolute path: production
      // serves the SPA under /app/ (VITE_BASE_PATH), where "/pdf.worker.min.mjs"
      // 404s (nginx has no rule for a root-level path) — same bug already
      // fixed once for call sounds, see callSounds.js.
      pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env?.BASE_URL || '/'}pdf.worker.min.mjs`
      return pdfjsLib
    })
  }
  return pdfjsPromise
}

// PDF "user space" is fixed at 72 units per inch by the PDF spec, so a
// render `scale` of N produces N * 72 DPI.
const PDF_USER_SPACE_DPI = 72

// ~450 DPI is print-shop-grade detail — enough for a construction
// blueprint's fine linework to stay legible at deep canvas zoom, without
// rendering every page at a size that would dominate the 30MB upload cap.
export const PDF_RENDER_DPI = 450
export const PDF_THUMBNAIL_DPI = 72

export function dpiToScale(dpi) {
  return dpi / PDF_USER_SPACE_DPI
}

// The on-canvas *display box* a freshly inserted element starts at. This is
// independent of the source image's actual pixel resolution — Excalidraw
// always samples from the full dataURL behind fileId when rendering at any
// zoom level, so keeping this modest just keeps the first paint sane; it
// never limits how much detail survives a later zoom-in.
export function computeFitDimensions(naturalWidth, naturalHeight, maxDim = 1200) {
  if (!naturalWidth || !naturalHeight) return { width: maxDim, height: maxDim }
  if (naturalWidth <= maxDim && naturalHeight <= maxDim) {
    return { width: naturalWidth, height: naturalHeight }
  }
  const scale = Math.min(maxDim / naturalWidth, maxDim / naturalHeight)
  return { width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale) }
}

// Reads an image file straight to a dataURL at its original resolution —
// deliberately no resize step, unlike Excalidraw's own insert path (see the
// design doc: it silently downscales any newly inserted image to 1440px).
export function readImageFullRes(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'))
    reader.onload = async () => {
      try {
        const dataURL = reader.result
        const { naturalWidth, naturalHeight } = await loadImageDimensions(dataURL)
        resolve({ dataURL, mimeType: file.type || 'image/png', naturalWidth, naturalHeight })
      } catch (err) {
        reject(err)
      }
    }
    reader.readAsDataURL(file)
  })
}

function loadImageDimensions(dataURL) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
    img.onerror = () => reject(new Error('No se pudo leer las dimensiones de la imagen'))
    img.src = dataURL
  })
}

async function loadPdfDocument(file) {
  const pdfjsLib = await getPdfjs()
  const buffer = await file.arrayBuffer()
  return pdfjsLib.getDocument({ data: buffer }).promise
}

export async function getPdfPageCount(file) {
  const doc = await loadPdfDocument(file)
  try {
    return doc.numPages
  } finally {
    await doc.destroy()
  }
}

async function renderPdfPage(file, pageNumber, dpi) {
  const doc = await loadPdfDocument(file)
  try {
    const page = await doc.getPage(pageNumber)
    const viewport = page.getViewport({ scale: dpiToScale(dpi) })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    return {
      dataURL: canvas.toDataURL('image/png'),
      mimeType: 'image/png',
      naturalWidth: canvas.width,
      naturalHeight: canvas.height,
    }
  } finally {
    await doc.destroy()
  }
}

// Cheap ~72 DPI render for the page-picker thumbnail grid.
export function renderPdfPageThumbnail(file, pageNumber) {
  return renderPdfPage(file, pageNumber, PDF_THUMBNAIL_DPI)
}

// Full ~450 DPI render for the page the user actually picked.
export function renderPdfPageFullRes(file, pageNumber) {
  return renderPdfPage(file, pageNumber, PDF_RENDER_DPI)
}
