// Client-side export for the public note page's rendered content (the
// `.note-sheet` DOM node — see NoteSheet.jsx). html2canvas is dynamic-
// imported so it never ships in the main bundle; this only runs from the
// public toolbar's Download buttons. Mirrors the raster-then-embed pattern
// already used for canvas notes in canvasExport.js (exportCanvasPdf).

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safeName = (title) => (title?.trim() || 'nota').replace(/[^\w\-. ]+/g, '_')

async function renderNoteSheetToCanvas(el, backgroundColor) {
  const { default: html2canvas } = await import('html2canvas')
  return html2canvas(el, {
    backgroundColor: backgroundColor || '#ffffff',
    useCORS: true,
    scale: Math.min(window.devicePixelRatio || 1, 2),
  })
}

export async function exportNoteSheetAsJpg(el, { title, backgroundColor } = {}) {
  if (!el) throw new Error('Contenido de la nota no disponible')
  const canvas = await renderNoteSheetToCanvas(el, backgroundColor)
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar la imagen'))), 'image/jpeg', 0.92)
  })
  triggerDownload(blob, `${safeName(title)}.jpg`)
}

export async function exportNoteSheetAsPdf(el, { title, backgroundColor } = {}) {
  if (!el) throw new Error('Contenido de la nota no disponible')
  const canvas = await renderNoteSheetToCanvas(el, backgroundColor)
  const dataURL = canvas.toDataURL('image/jpeg', 0.92)
  const { jsPDF } = await import('jspdf')
  const w = canvas.width || 1
  const h = canvas.height || 1
  const pdf = new jsPDF({
    orientation: w >= h ? 'landscape' : 'portrait',
    unit: 'px',
    format: [w, h],
    compress: true,
  })
  pdf.addImage(dataURL, 'JPEG', 0, 0, w, h)
  pdf.save(`${safeName(title)}.pdf`)
}
