// Image / PDF helpers for inserting files onto a board. PDF pages are
// rasterized client-side (pdfjs, lazily loaded) and stored as PNG FileAssets,
// so the renderer only ever draws images.
export const PDF_DPI = 300
export const MAX_RASTER_SIDE = 7200

export const isPdf = (file) => file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name ?? '')
export const isImage = (file) => /^image\//.test(file?.type ?? '')
export const isDxf = (file) => /\.dxf$/i.test(file?.name ?? '')

let pdfjsPromise = null
function getPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjsLib) => {
    // Worker copied to public/ by the desktop postinstall script; resolved
    // against BASE_URL because production serves the SPA under /app/.
    pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env?.BASE_URL || '/'}pdf.worker.min.mjs`
    return pdfjsLib
  })
  return pdfjsPromise
}

export async function openPdf(file) {
  const pdfjs = await getPdfjs()
  return pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
}

// Loads a PDF from a (signed, CORS-enabled) URL.
export async function openPdfFromUrl(url) {
  const pdfjs = await getPdfjs()
  const response = await fetch(url, { mode: 'cors' })
  if (!response.ok) throw new Error('No se pudo cargar el PDF')
  return pdfjs.getDocument({ data: await response.arrayBuffer() }).promise
}

// Renders a PDF page to a canvas whose longest side is `targetSide` px.
export async function renderPdfPageCanvas(doc, pageNumber, targetSide) {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: targetSide / Math.max(base.width, base.height) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  // The renderer checks image.complete/naturalWidth.
  return Object.assign(canvas, { complete: true, naturalWidth: canvas.width, naturalHeight: canvas.height })
}

export function pdfRenderScale(width, height, dpi = PDF_DPI) {
  return Math.min(dpi / 72, MAX_RASTER_SIDE / Math.max(width, height))
}

function canvasToBlob(canvas, type = 'image/png') {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo generar la imagen')), type))
}

export async function renderPdfPage(doc, pageNumber, dpi = PDF_DPI) {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = pdfRenderScale(base.width, base.height, dpi)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  return { blob: await canvasToBlob(canvas), width: canvas.width, height: canvas.height, pointWidth: base.width, pointHeight: base.height }
}

export async function renderPdfThumbnail(doc, pageNumber) {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: 220 / Math.max(base.width, base.height) })
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  return canvas.toDataURL('image/png')
}

export function readImageSize(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), image = new Image()
    image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url) }
    image.onerror = () => { reject(new Error('No se pudo leer la imagen')); URL.revokeObjectURL(url) }
    image.src = url
  })
}

// World-space size for a newly inserted image: as large as possible inside
// `maxSide` while keeping its aspect ratio.
export function fitSize(width, height, maxSide = 800) {
  if (!width || !height) return { width: maxSide, height: maxSide }
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

// Caps a newly inserted image/library item to a reasonable fraction of the
// current viewport, in world units, so it never appears gigantic (zoomed
// out) or imperceptibly tiny (zoomed in). Shared by useMediaInsert and
// library item insertion (useBoardEditorActions).
export function maxInsertSide(size, viewport) {
  return Math.max(200, Math.min(900, (Math.min(size.width, size.height) * 0.7) / viewport.zoom))
}
