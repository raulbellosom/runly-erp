// Chair layout math for POS table shapes. Shared by the planner
// (FloorCanvasHelpers.jsx, which re-exports these) and the Canvas-engine
// operational drawer (floorDrawers.js).
export const CHAIR_PAD = 18

export function squareChairPositions(width, height, capacity, style = 'auto') {
  if (style === 'none' || !capacity) return []
  const n = Math.min(capacity, 20)
  const CW_H  = Math.min(18, Math.max(8, (width  - 8) / 4))
  const CW_V  = Math.min(18, Math.max(8, (height - 8) / 4))
  const DEPTH = 9
  const GAP   = 5
  const ox = CHAIR_PAD
  const oy = CHAIR_PAD

  if (style === 'one_side') {
    const sp = width / (n + 1)
    return Array.from({ length: n }, (_, i) => ({
      x: ox + sp * (i + 1) - CW_H / 2, y: oy + height + GAP, w: CW_H, h: DEPTH, rx: 3,
    }))
  }

  let topN = 0, botN = 0, leftN = 0, rightN = 0

  if (style === 'two_sides') {
    topN = Math.ceil(n / 2)
    botN = Math.floor(n / 2)
  } else {
    for (let i = 0; i < n; i++) {
      const side = i % 4
      if (side === 0) topN++
      else if (side === 1) botN++
      else if (side === 2) leftN++
      else rightN++
    }
  }

  const chairs = []
  if (topN > 0) {
    const sp = width / (topN + 1)
    for (let i = 0; i < topN; i++)
      chairs.push({ x: ox + sp * (i + 1) - CW_H / 2, y: oy - DEPTH - GAP, w: CW_H, h: DEPTH, rx: 3 })
  }
  if (botN > 0) {
    const sp = width / (botN + 1)
    for (let i = 0; i < botN; i++)
      chairs.push({ x: ox + sp * (i + 1) - CW_H / 2, y: oy + height + GAP, w: CW_H, h: DEPTH, rx: 3 })
  }
  if (leftN > 0) {
    const sp = height / (leftN + 1)
    for (let i = 0; i < leftN; i++)
      chairs.push({ x: ox - DEPTH - GAP, y: oy + sp * (i + 1) - CW_V / 2, w: DEPTH, h: CW_V, rx: 3 })
  }
  if (rightN > 0) {
    const sp = height / (rightN + 1)
    for (let i = 0; i < rightN; i++)
      chairs.push({ x: ox + width + GAP, y: oy + sp * (i + 1) - CW_V / 2, w: DEPTH, h: CW_V, rx: 3 })
  }
  return chairs
}

export function roundChairPositions(width, height, capacity, style = 'auto') {
  if (style === 'none' || !capacity) return []
  const n = Math.min(capacity, 12)
  const tableR = Math.min(width, height) / 2
  const cx = CHAIR_PAD + width / 2
  const cy = CHAIR_PAD + height / 2
  const CR = 7
  const dist = tableR + CR + 4

  if (style === 'one_side') {
    return Array.from({ length: n }, (_, i) => {
      const angle = (i / (n - 1 || 1)) * Math.PI * 0.9 + Math.PI * 0.05
      return { cx: cx + Math.cos(angle) * dist, cy: cy + Math.sin(angle) * dist, r: CR }
    })
  }
  if (style === 'two_sides') {
    const half = Math.ceil(n / 2)
    const top = Array.from({ length: half }, (_, i) => {
      const a = -Math.PI + (i / (half - 1 || 1)) * Math.PI
      return { cx: cx + Math.cos(a) * dist, cy: cy + Math.sin(a) * dist, r: CR }
    })
    const bot = Array.from({ length: n - half }, (_, i) => {
      const a = (i / (n - half - 1 || 1)) * Math.PI
      return { cx: cx + Math.cos(a) * dist, cy: cy + Math.sin(a) * dist, r: CR }
    })
    return [...top, ...bot]
  }
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return { cx: cx + Math.cos(a) * dist, cy: cy + Math.sin(a) * dist, r: CR }
  })
}
