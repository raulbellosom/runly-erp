export const TEXT_LINE_HEIGHT = 1.3

export function textFont(style = {}, family = 'system-ui, sans-serif') {
  return `${style.fontWeight === 'bold' ? 700 : 500} ${Number(style.fontSize ?? 18)}px ${family}`
}

// Greedy word wrap honoring explicit line breaks; words longer than the box
// are kept whole rather than split mid-word.
export function wrapLines(ctx, text, maxWidth) {
  const lines = []
  for (const paragraph of String(text ?? '').split('\n')) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word
      if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word } else line = candidate
    }
    lines.push(line)
  }
  return lines
}

let measureContext = null
// Height a text object needs for its current width, used after editing so the
// selection box and hit area match what is drawn.
export function measureTextHeight(text, style, width) {
  if (typeof document === 'undefined') return Number(style?.fontSize ?? 18) * TEXT_LINE_HEIGHT
  measureContext ??= document.createElement('canvas').getContext('2d')
  measureContext.font = textFont(style)
  return Math.ceil(wrapLines(measureContext, text, width).length * Number(style?.fontSize ?? 18) * TEXT_LINE_HEIGHT)
}
