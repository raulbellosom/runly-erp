// Mini illustrations for the "Nuevo Board" cards: SVG primitives in a
// 120×68 box. Tones: 'line' (outline), 'accent' (primary), 'soft' (muted fill).
export const TEMPLATE_PREVIEWS = {
  blank: [{ kind: 'rect', x: 28, y: 14, w: 64, h: 40, r: 6, tone: 'line', dash: true }],
  plan: [
    { kind: 'rect', x: 14, y: 8, w: 92, h: 52, tone: 'line' },
    { kind: 'line', x1: 60, y1: 8, x2: 60, y2: 36, tone: 'line' },
    { kind: 'line', x1: 14, y1: 34, x2: 44, y2: 34, tone: 'line' },
    { kind: 'rect', x: 70, y: 42, w: 26, h: 12, r: 2, tone: 'soft' },
    { kind: 'circle', cx: 82, cy: 22, r: 4, tone: 'accent' },
    { kind: 'circle', cx: 30, cy: 48, r: 4, tone: 'accent' },
  ],
  'technical-map': [
    { kind: 'path', d: 'M10 50 H50 V20 H110', tone: 'line' },
    { kind: 'path', d: 'M50 50 V60', tone: 'line' },
    { kind: 'circle', cx: 50, cy: 20, r: 4.5, tone: 'accent' },
    { kind: 'circle', cx: 82, cy: 20, r: 4.5, tone: 'accent' },
    { kind: 'circle', cx: 26, cy: 50, r: 4.5, tone: 'accent' },
  ],
  diagram: [
    { kind: 'rect', x: 8, y: 24, w: 28, h: 18, r: 3, tone: 'line' },
    { kind: 'path', d: 'M60 20 L73 33 L60 46 L47 33 Z', tone: 'line' },
    { kind: 'rect', x: 84, y: 24, w: 28, h: 18, r: 3, tone: 'line' },
    { kind: 'line', x1: 36, y1: 33, x2: 47, y2: 33, tone: 'accent' },
    { kind: 'line', x1: 73, y1: 33, x2: 84, y2: 33, tone: 'accent' },
  ],
  layout: [
    { kind: 'rect', x: 8, y: 6, w: 104, h: 56, r: 3, tone: 'line' },
    { kind: 'circle', cx: 30, cy: 24, r: 8, tone: 'soft' },
    { kind: 'circle', cx: 60, cy: 24, r: 8, tone: 'soft' },
    { kind: 'circle', cx: 90, cy: 24, r: 8, tone: 'soft' },
    { kind: 'rect', x: 18, y: 42, w: 24, h: 10, r: 2, tone: 'soft' },
    { kind: 'rect', x: 48, y: 42, w: 24, h: 10, r: 2, tone: 'soft' },
    { kind: 'rect', x: 78, y: 42, w: 24, h: 10, r: 2, tone: 'soft' },
  ],
  'pdf-review': [
    { kind: 'rect', x: 34, y: 6, w: 52, h: 58, r: 2, tone: 'line' },
    { kind: 'line', x1: 42, y1: 16, x2: 78, y2: 16, tone: 'soft' },
    { kind: 'line', x1: 42, y1: 24, x2: 74, y2: 24, tone: 'soft' },
    { kind: 'line', x1: 42, y1: 32, x2: 78, y2: 32, tone: 'soft' },
    { kind: 'line', x1: 42, y1: 40, x2: 64, y2: 40, tone: 'soft' },
    { kind: 'rect', x: 40, y: 28, w: 40, h: 8, r: 2, tone: 'accent', dash: true },
    { kind: 'circle', cx: 82, cy: 50, r: 5, tone: 'accent' },
  ],
}

export const previewFor = (key) => TEMPLATE_PREVIEWS[key] ?? TEMPLATE_PREVIEWS.blank
