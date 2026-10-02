// SVG icon import (spec: docs/superpowers/specs/2026-10-02-canvas-libraries-design.md
// §20/§23). `svgSize` is pure regex-based parsing (no DOMParser) so it can
// run anywhere, including this Node test file. `sanitizeSvgText` needs a
// DOMParser/XMLSerializer and therefore only runs in the browser.
const BLOCKED_TAGS = ['script', 'foreignObject', 'iframe', 'object', 'embed']

function svgTagOf(text) {
  return String(text ?? '').match(/<svg[^>]*>/i)?.[0] ?? ''
}

function attr(svgTag, name) {
  const match = svgTag.match(new RegExp(`[\\s'"]${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return match ? match[1] : null
}

// Accepts a plain number or a `px` length; rejects percentages, `em`, etc.
function parseLength(value) {
  if (value == null) return null
  const match = String(value).trim().match(/^(\d*\.?\d+)(px)?$/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function parseViewBox(svgTag) {
  const viewBox = attr(svgTag, 'viewBox')
  if (!viewBox) return null
  const parts = viewBox.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null
  const [, , width, height] = parts
  return width > 0 && height > 0 ? { width, height } : null
}

// Width/height in px or unitless; else the viewBox dimensions; else 64x64
// (edge case 5 in the spec).
export function svgSize(text) {
  const svgTag = svgTagOf(text)
  const width = parseLength(attr(svgTag, 'width'))
  const height = parseLength(attr(svgTag, 'height'))
  if (width && height) return { width, height }
  return parseViewBox(svgTag) ?? { width: 64, height: 64 }
}

// Strips script/foreignObject/iframe/object/embed, every `on*` attribute
// and any `href`/`xlink:href` that is not a same-document fragment or an
// embedded `data:image/...` resource, then returns the serialized SVG.
export function sanitizeSvgText(text, parser = new DOMParser()) {
  let doc
  try {
    doc = parser.parseFromString(String(text ?? ''), 'image/svg+xml')
  } catch {
    throw new Error('El SVG no es válido.')
  }
  if (doc.querySelector('parsererror') || doc.documentElement?.nodeName?.toLowerCase() !== 'svg') {
    throw new Error('El SVG no es válido.')
  }
  for (const tag of BLOCKED_TAGS) {
    for (const node of Array.from(doc.querySelectorAll(tag))) node.remove()
  }
  for (const element of Array.from(doc.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      if (name.startsWith('on')) { element.removeAttribute(attribute.name); continue }
      if (name === 'href' || name === 'xlink:href') {
        const value = attribute.value.trim()
        if (!value.startsWith('#') && !value.startsWith('data:image/')) element.removeAttribute(attribute.name)
      }
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement)
}
