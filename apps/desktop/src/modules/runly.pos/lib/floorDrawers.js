// Canvas-engine drawers for the POS operational floor view (see
// floorObjects.js). Each drawer renders inside the renderer's already
// translated/rotated box-local frame: (x, y) is the box top-left
// (-w/2, -h/2 of the object's own box) and (0, 0) is the box center.
import { CHAIR_PAD, roundChairPositions, squareChairPositions } from './chairs.js'
import { TABLE_STATUS_STYLE, DEFAULT_STATUS } from './tableStatus.js'
import { POLYGON_ZONE_COLORS } from './zoneColors.js'

const DECOR_COLORS = {
  WALL:   { fill: '#a1a1aa' },
  BAR:    { fill: '#d6d3d1', stroke: '#a8a29e' },
  PLANT:  { fill: '#dcfce7', stroke: '#22c55e', leaf: '#16a34a' },
  DOOR:   { fill: '#e0f2fe', stroke: '#38bdf8' },
  PILLAR: { fill: '#d4d4d8', stroke: '#71717a' },
  SOFA:   { fill: '#ede9fe', stroke: '#a78bfa', back: '#ddd6fe' },
  WINDOW: { stroke: '#7dd3fc' },
  STAIRS: { fill: '#e2e8f0', stroke: '#94a3b8' },
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2))
}

export function drawSurface(ctx, object, { x, y, w, h, theme }) {
  roundRect(ctx, x, y, w, h, 8)
  ctx.fillStyle = theme.surface
  ctx.fill()
  ctx.lineWidth = 1
  ctx.globalAlpha *= 0.6
  ctx.strokeStyle = theme.muted
  ctx.stroke()
  ctx.setLineDash([6, 4])
  ctx.globalAlpha *= 0.5
  ctx.strokeRect(x + 12, y + 12, w - 24, h - 24)
  ctx.setLineDash([])
}

export function drawZone(ctx, object, { x, y, w, h, zoom, theme }) {
  const colors = POLYGON_ZONE_COLORS[object.properties?.color] ?? POLYGON_ZONE_COLORS.neutral
  roundRect(ctx, x, y, w, h, 6)
  ctx.fillStyle = colors.fill
  ctx.fill()
  ctx.setLineDash([6, 3])
  ctx.lineWidth = 1.5
  ctx.strokeStyle = colors.stroke
  ctx.stroke()
  ctx.setLineDash([])
  const label = object.properties?.label
  if (label) {
    ctx.font = `600 ${12 / zoom}px ${theme?.font ?? 'sans-serif'}`
    ctx.fillStyle = colors.stroke
    ctx.globalAlpha *= 0.8
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'
    ctx.fillText(label, x + 8 / zoom, y + 6 / zoom)
  }
}

export function drawDecor(ctx, object, { x, y, w, h, theme }) {
  const kind = object.properties?.kind
  const label = object.properties?.label
  const cx = x + w / 2, cy = y + h / 2
  if (kind === 'WALL') {
    ctx.fillStyle = DECOR_COLORS.WALL.fill
    roundRect(ctx, x, y, w, h, 2); ctx.fill()
  } else if (kind === 'BAR') {
    ctx.fillStyle = DECOR_COLORS.BAR.fill
    ctx.strokeStyle = DECOR_COLORS.BAR.stroke
    ctx.lineWidth = 1.5
    roundRect(ctx, x, y, w, h, 10); ctx.fill(); ctx.stroke()
  } else if (kind === 'PLANT') {
    const r = Math.min(w, h) / 2
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = DECOR_COLORS.PLANT.fill; ctx.fill()
    ctx.strokeStyle = DECOR_COLORS.PLANT.stroke; ctx.lineWidth = 2; ctx.stroke()
    ctx.strokeStyle = DECOR_COLORS.PLANT.leaf; ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(cx, cy + r * 0.5); ctx.lineTo(cx, cy - r * 0.1)
    ctx.moveTo(cx, cy - r * 0.1); ctx.bezierCurveTo(cx - r * 0.5, cy - r * 0.5, cx - r * 0.3, cy - r * 0.9, cx, cy - r * 0.6)
    ctx.stroke()
  } else if (kind === 'DOOR') {
    ctx.fillStyle = DECOR_COLORS.DOOR.fill
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = DECOR_COLORS.DOOR.stroke; ctx.lineWidth = 1.5
    ctx.strokeRect(x, y, w, h)
    const r = Math.min(w, h)
    ctx.setLineDash([3, 2])
    ctx.beginPath(); ctx.arc(x, y + h, r, -Math.PI / 2, 0); ctx.stroke()
    ctx.setLineDash([])
  } else if (kind === 'PILLAR') {
    const side = Math.min(w, h)
    ctx.fillStyle = DECOR_COLORS.PILLAR.fill
    ctx.fillRect(cx - side / 2, cy - side / 2, side, side)
    ctx.strokeStyle = DECOR_COLORS.PILLAR.stroke; ctx.lineWidth = 2
    ctx.strokeRect(cx - side / 2, cy - side / 2, side, side)
  } else if (kind === 'SOFA') {
    roundRect(ctx, x, y, w, h, 10)
    ctx.fillStyle = DECOR_COLORS.SOFA.fill; ctx.fill()
    ctx.strokeStyle = DECOR_COLORS.SOFA.stroke; ctx.lineWidth = 1.5; ctx.stroke()
    ctx.fillStyle = DECOR_COLORS.SOFA.back
    ctx.fillRect(x, y, w, h / 3)
  } else if (kind === 'WINDOW') {
    ctx.strokeStyle = DECOR_COLORS.WINDOW.stroke; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(x, y + h / 3); ctx.lineTo(x + w, y + h / 3)
    ctx.moveTo(x, y + (h * 2) / 3); ctx.lineTo(x + w, y + (h * 2) / 3)
    ctx.stroke()
  } else if (kind === 'STAIRS') {
    ctx.fillStyle = DECOR_COLORS.STAIRS.fill
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = DECOR_COLORS.STAIRS.stroke; ctx.lineWidth = 1
    const steps = Math.max(3, Math.floor(h / 18))
    for (let i = 0; i <= steps; i++) {
      const sy = y + (i / steps) * h, sx = x + (i / steps) * w
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(x + w, sy); ctx.moveTo(sx, sy); ctx.lineTo(sx, y + h); ctx.stroke()
    }
  } else {
    ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1
    ctx.strokeRect(x, y, w, h)
  }
  if (label) {
    ctx.font = `500 10px ${theme?.font ?? 'sans-serif'}`
    ctx.fillStyle = kind === 'WALL' ? '#ffffff' : '#334155'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, cx, cy)
  }
}

export function drawTable(ctx, object, { x, y, w, h, theme }) {
  const props = object.properties ?? {}
  const status = props.status ?? 'AVAILABLE'
  const s = TABLE_STATUS_STYLE[status] ?? DEFAULT_STATUS
  const isDisabled = status === 'DISABLED'
  const isRound = Boolean(props.round)
  const capacity = props.capacity ?? 0
  const chairStyle = props.chairStyle ?? 'auto'
  const name = props.name ?? ''

  // Dimming mirrors the old DOM view: disabled tables fade the most, tables
  // hidden by the "mis mesas" filter fade less, everything else is opaque.
  ctx.globalAlpha *= props.orphan ? 0.25 : isDisabled ? 0.4 : props.dimmed ? 0.45 : 1

  const chairs = isRound ? roundChairPositions(w, h, capacity, chairStyle) : squareChairPositions(w, h, capacity, chairStyle)
  ctx.lineWidth = 1.5
  ctx.strokeStyle = s.ring
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  for (const c of chairs) {
    ctx.beginPath()
    if (c.r) ctx.arc(x + (c.cx - CHAIR_PAD), y + (c.cy - CHAIR_PAD), c.r, 0, Math.PI * 2)
    else { roundRect(ctx, x + (c.x - CHAIR_PAD), y + (c.y - CHAIR_PAD), c.w, c.h, c.rx ?? 3) }
    ctx.fill(); ctx.stroke()
  }

  ctx.beginPath()
  if (isRound) ctx.arc(x + w / 2, y + h / 2, Math.min(w, h) / 2 - 1.5, 0, Math.PI * 2)
  else roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 9)
  ctx.fillStyle = s.fill
  ctx.fill()
  ctx.lineWidth = s.ringWidth
  ctx.strokeStyle = s.ring
  ctx.stroke()

  const showStatusLabel = h > 52
  const displayName = name.length > 9 ? `${name.slice(0, 8)}…` : name
  const nameFontSize = Math.min(13, Math.max(9, w / 6))
  if (displayName) {
    ctx.font = `700 ${nameFontSize}px ${theme?.font ?? 'sans-serif'}`
    ctx.fillStyle = s.textColor
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(displayName, x + w / 2, y + h / 2 + (showStatusLabel ? -(nameFontSize * 0.55) : 0))
  }
  if (showStatusLabel) {
    ctx.font = `400 ${Math.max(7.5, nameFontSize * 0.65)}px ${theme?.font ?? 'sans-serif'}`
    ctx.fillStyle = s.ring
    ctx.globalAlpha *= 0.9
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(s.label, x + w / 2, y + h / 2 + (displayName ? nameFontSize * 0.75 : 0))
    ctx.globalAlpha /= 0.9
  }

  ctx.beginPath()
  ctx.arc(x + w - 8, y + 8, 5, 0, Math.PI * 2)
  ctx.fillStyle = s.dot
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
}

export const POS_DRAWERS = {
  'pos.surface': drawSurface,
  'pos.zone': drawZone,
  'pos.decor': drawDecor,
  'pos.table': drawTable,
}
