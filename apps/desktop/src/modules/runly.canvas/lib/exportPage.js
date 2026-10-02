import { jsPDF } from 'jspdf'
import { sceneBounds } from '../engine/Canvas2DRenderer.js'
import { exportSize, renderScene } from './renderScene.js'

const safeName = (value) => String(value || 'board').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80)

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// The exported page always uses the light theme on a white background, at
// 2x the world size (capped at 8000px per side) regardless of the editor's
// current zoom or theme.
async function pageCanvas(objects, options) {
  const bounds = sceneBounds(objects)
  if (!bounds) return null
  const size = exportSize(bounds)
  return renderScene(objects, { ...options, width: size.width, height: size.height, padding: 24 * size.pixelRatio, light: true, background: '#ffffff' })
}

export async function exportPng(objects, { boardName, pageName, imageUrls, bindings }) {
  const canvas = await pageCanvas(objects, { imageUrls, bindings })
  if (!canvas) return false
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  download(blob, `${safeName(boardName)} - ${safeName(pageName)}.png`)
  return true
}

export async function exportPdf(objects, { boardName, pageName, scaleLabel, imageUrls, bindings }) {
  const canvas = await pageCanvas(objects, { imageUrls, bindings })
  if (!canvas) return false
  const landscape = canvas.width >= canvas.height
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight(), margin = 10, header = 12
  pdf.setFontSize(12); pdf.text(`${boardName} — ${pageName}`, margin, margin + 4)
  pdf.setFontSize(8); pdf.text([new Date().toLocaleString('es-MX'), scaleLabel].filter(Boolean).join(' · '), margin, margin + 9)
  const maxW = pageW - margin * 2, maxH = pageH - margin * 2 - header
  const ratio = Math.min(maxW / canvas.width, maxH / canvas.height)
  const w = canvas.width * ratio, h = canvas.height * ratio
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin + (maxW - w) / 2, margin + header, w, h)
  pdf.save(`${safeName(boardName)} - ${safeName(pageName)}.pdf`)
  return true
}
