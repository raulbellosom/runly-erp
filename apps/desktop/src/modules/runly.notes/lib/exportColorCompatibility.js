// html2canvas 1.x cannot parse CSS Color 4 functions, including those nested
// inside gradients/shadows. Keep the surrounding CSS and resolve each color
// through the browser before html2canvas sees the cloned document.
export function replaceModernColors(value, resolveColor) {
  const pattern = /\b(?:oklch|oklab|lch|lab|color|color-mix)\(/gi
  let result = ''
  let offset = 0
  let match
  while ((match = pattern.exec(value))) {
    let depth = 1
    let end = pattern.lastIndex
    while (end < value.length && depth > 0) {
      if (value[end] === '(') depth++
      if (value[end] === ')') depth--
      end++
    }
    if (depth !== 0) break
    result += value.slice(offset, match.index) + resolveColor(value.slice(match.index, end))
    offset = end
    pattern.lastIndex = end
  }
  return result + value.slice(offset)
}

const COLOR_PROPERTIES = [
  'color', 'background-color', 'background-image', 'box-shadow', 'text-shadow',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', '-webkit-text-stroke-color', 'fill', 'stroke',
]

export function normalizeExportColors(document, sheet) {
  const pixel = document.createElement('canvas')
  pixel.width = pixel.height = 1
  const context = pixel.getContext('2d', { willReadFrequently: true })
  const cache = new Map()
  function resolveColor(color) {
    if (cache.has(color)) return cache.get(color)
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
    const resolved = `rgba(${r}, ${g}, ${b}, ${a / 255})`
    cache.set(color, resolved)
    return resolved
  }
  const rules = []
  const elements = [sheet, ...sheet.querySelectorAll('*')]
  // html2canvas also reads page backgrounds outside the requested element.
  for (let parent = sheet.parentElement; parent; parent = parent.parentElement) elements.push(parent)
  elements.forEach((element, index) => {
    for (const pseudo of [null, '::before', '::after']) {
      const computed = document.defaultView.getComputedStyle(element, pseudo)
      if (pseudo && (!computed.content || computed.content === 'none')) continue
      const declarations = []
      for (const property of COLOR_PROPERTIES) {
        const original = computed.getPropertyValue(property)
        const normalized = replaceModernColors(original, resolveColor)
        if (normalized === original) continue
        if (pseudo) declarations.push(`${property}: ${normalized} !important`)
        else element.style.setProperty(property, normalized, 'important')
      }
      if (declarations.length) {
        element.setAttribute('data-note-export-color', String(index))
        rules.push(`[data-note-export-color="${index}"]${pseudo} { ${declarations.join(';')} }`)
      }
    }
  })
  if (rules.length) {
    const style = document.createElement('style')
    style.textContent = rules.join('\n')
    document.head.appendChild(style)
  }
}
