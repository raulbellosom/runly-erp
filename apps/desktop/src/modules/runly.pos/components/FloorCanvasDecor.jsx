const ZONE_COLORS = {
  neutral: 'border-slate-400/60  dark:border-slate-500/60  bg-slate-100/30  dark:bg-slate-800/20  text-slate-600  dark:text-slate-400',
  dining:  'border-blue-400/60   dark:border-blue-600/60   bg-blue-50/30    dark:bg-blue-900/20   text-blue-600   dark:text-blue-400',
  outdoor: 'border-green-400/60  dark:border-green-600/60  bg-green-50/30   dark:bg-green-900/20  text-green-600  dark:text-green-400',
  bar:     'border-amber-400/60  dark:border-amber-600/60  bg-amber-50/30   dark:bg-amber-900/20  text-amber-600  dark:text-amber-400',
  vip:     'border-purple-400/60 dark:border-purple-600/60 bg-purple-50/30  dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  private: 'border-rose-400/60   dark:border-rose-600/60   bg-rose-50/30    dark:bg-rose-900/20   text-rose-600   dark:text-rose-400',
}

export { POLYGON_ZONE_COLORS } from '../lib/zoneColors.js'
import { POLYGON_ZONE_COLORS } from '../lib/zoneColors.js'

export const DRAW_PREVIEW_COLORS = {
  TABLE_SQUARE: 'border-amber-400   bg-amber-100/20   dark:bg-amber-900/20',
  TABLE_ROUND:  'border-amber-400   bg-amber-100/20   dark:bg-amber-900/20',
  BAR:          'border-stone-400   bg-stone-100/20   dark:bg-stone-800/20',
  WALL:         'border-zinc-500    bg-zinc-200/20    dark:bg-zinc-700/20',
  PLANT:        'border-green-500   bg-green-100/20   dark:bg-green-900/20',
  DOOR:         'border-sky-400     bg-sky-50/20      dark:bg-sky-900/20',
  FLOOR_ZONE:   'border-slate-400   bg-slate-100/15   dark:bg-slate-800/15',
  PILLAR:       'border-zinc-500    bg-zinc-200/20    dark:bg-zinc-700/20',
  SOFA:         'border-violet-400  bg-violet-100/20  dark:bg-violet-900/20',
  WINDOW:       'border-sky-300     bg-sky-50/20      dark:bg-sky-900/20',
  STAIRS:       'border-slate-400   bg-slate-200/20   dark:bg-slate-700/20',
}

export function DecorVisual({ el, isSelected }) {
  const sel = isSelected ? 'ring-2 ring-primary ring-offset-1' : ''
  const { kind } = el

  if (kind === 'FLOOR_ZONE') {
    const zc = ZONE_COLORS[el.color] ?? ZONE_COLORS.neutral
    return (
      <div className={['w-full h-full rounded border-2 border-dashed flex items-start justify-start p-2', zc, sel].join(' ')}>
        <span className="text-xs font-semibold opacity-80 leading-tight pointer-events-none select-none">{el.label || 'Zona'}</span>
      </div>
    )
  }
  if (kind === 'WALL') {
    return (
      <div className={['w-full h-full rounded-sm flex items-center justify-center bg-zinc-400 dark:bg-zinc-500 border-2', isSelected ? 'border-primary' : 'border-zinc-500 dark:border-zinc-400', sel].join(' ')}>
        {el.label && <span className="text-white text-xs font-medium truncate px-1">{el.label}</span>}
      </div>
    )
  }
  if (kind === 'BAR') {
    const stoolCount = el.capacity > 0 ? Math.min(el.capacity, Math.floor(el.width / 18)) : 0
    return (
      <div className={['w-full h-full rounded-lg flex items-center justify-center relative overflow-hidden bg-stone-200 dark:bg-stone-700 border-2', isSelected ? 'border-primary' : 'border-stone-400 dark:border-stone-500', sel].join(' ')}>
        {stoolCount > 0 && (
          <div className="absolute bottom-0 left-0 right-0 flex justify-around px-2">
            {Array.from({ length: stoolCount }).map((_, i) => (
              <div key={i} className="h-1.5 w-3 rounded-t-full bg-stone-400 dark:bg-stone-500" />
            ))}
          </div>
        )}
        <span className="text-stone-700 dark:text-stone-200 text-xs font-semibold uppercase tracking-wide">{el.label || 'Barra'}</span>
      </div>
    )
  }
  if (kind === 'PLANT') {
    return (
      <div className={['w-full h-full rounded-full flex items-center justify-center bg-green-100 dark:bg-green-900/50 border-2', isSelected ? 'border-primary' : 'border-green-500 dark:border-green-600', sel].join(' ')}>
        <svg viewBox="0 0 24 24" fill="none" className="w-1/2 h-1/2 text-green-600 dark:text-green-400">
          <path d="M12 22V12M12 12C12 12 7 9 7 4a5 5 0 0 1 10 0c0 5-5 8-5 8Z" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        </svg>
      </div>
    )
  }
  if (kind === 'DOOR') {
    return (
      <div className={['w-full h-full rounded-sm relative overflow-hidden bg-sky-50 dark:bg-sky-900/30 border-2', isSelected ? 'border-primary' : 'border-sky-400 dark:border-sky-600', sel].join(' ')}>
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 60 24" preserveAspectRatio="none">
          <rect x="1" y="1" width="14" height="22" rx="1" className="fill-sky-200 dark:fill-sky-800 stroke-sky-400 dark:stroke-sky-600" strokeWidth="1.5" />
          <path d="M 15 23 A 14 14 0 0 0 29 9" className="stroke-sky-400 dark:stroke-sky-600" fill="none" strokeWidth="1" strokeDasharray="2 1" />
        </svg>
      </div>
    )
  }
  if (kind === 'PILLAR') {
    return (
      <div className={['w-full h-full rounded-full flex items-center justify-center bg-zinc-300 dark:bg-zinc-600 border-4', isSelected ? 'border-primary' : 'border-zinc-500 dark:border-zinc-400', sel].join(' ')}>
        <div className="w-1/3 h-1/3 rounded-full bg-zinc-400 dark:bg-zinc-500" />
      </div>
    )
  }
  if (kind === 'SOFA') {
    return (
      <div className={['w-full h-full rounded-xl relative overflow-hidden bg-violet-100 dark:bg-violet-900/40 border-2', isSelected ? 'border-primary' : 'border-violet-400 dark:border-violet-600', sel].join(' ')}>
        <div className="absolute top-0 left-0 right-0 h-1/3 bg-violet-200 dark:bg-violet-800/60 border-b border-violet-300 dark:border-violet-700 rounded-t-xl" />
        <div className="absolute bottom-0 left-0 right-0 h-2/3 flex gap-1 px-1 pb-1 pt-0.5">
          {Array.from({ length: Math.max(2, Math.floor(el.width / 50)) }).map((_, i) => (
            <div key={i} className="flex-1 rounded-md bg-violet-200 dark:bg-violet-800/40 border border-violet-300 dark:border-violet-700" />
          ))}
        </div>
        {el.label && <span className="absolute inset-0 flex items-center justify-center text-xs font-medium text-violet-700 dark:text-violet-300 pointer-events-none">{el.label}</span>}
      </div>
    )
  }
  if (kind === 'WINDOW') {
    const panes = Math.max(2, Math.floor(el.width / 25))
    return (
      <div className={['w-full h-full relative overflow-hidden bg-sky-100 dark:bg-sky-900/30 border-2', isSelected ? 'border-primary' : 'border-sky-300 dark:border-sky-600', sel].join(' ')}>
        <div className="absolute inset-0 flex">
          {Array.from({ length: panes }).map((_, i) => (
            <div key={i} className="flex-1 border-r last:border-r-0 border-sky-300 dark:border-sky-600" />
          ))}
        </div>
        <div className="absolute top-0.5 left-1 w-1/4 h-0.5 bg-white/60 rounded" />
      </div>
    )
  }
  if (kind === 'STAIRS') {
    const steps = Math.max(3, Math.floor(el.height / 18))
    return (
      <div className={['w-full h-full relative overflow-hidden bg-slate-200 dark:bg-slate-700 border-2', isSelected ? 'border-primary' : 'border-slate-400 dark:border-slate-500', sel].join(' ')}>
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${el.width} ${el.height}`} preserveAspectRatio="none">
          {Array.from({ length: steps }).map((_, i) => {
            const y = (i / steps) * el.height
            const x = (i / steps) * el.width
            return (
              <g key={i}>
                <line x1={x} y1={y} x2={el.width} y2={y} className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1.5" />
                <line x1={x} y1={y} x2={x} y2={el.height} className="stroke-slate-400 dark:stroke-slate-500" strokeWidth="1.5" />
              </g>
            )
          })}
        </svg>
        {el.label && <span className="absolute top-1 left-1 text-[9px] text-slate-600 dark:text-slate-300 font-medium pointer-events-none">{el.label}</span>}
      </div>
    )
  }
  return (
    <div className={['w-full h-full rounded-md border-2 flex items-center justify-center bg-muted border-border', sel].join(' ')}>
      <span className="text-xs text-muted-foreground">{el.label}</span>
    </div>
  )
}

export function PolygonVisual({ el, isSelected }) {
  if (!el.points?.length) {
    return <div className="w-full h-full rounded border-2 border-dashed border-border bg-muted/20" />
  }
  const pts = el.points.map((p) => `${p.x - el.x},${p.y - el.y}`).join(' ')
  const zoneColors = POLYGON_ZONE_COLORS[el.color ?? 'neutral'] ?? POLYGON_ZONE_COLORS.neutral
  return (
    <div className="absolute inset-0" style={{ overflow: 'visible' }}>
      <svg
        width={el.width} height={el.height}
        style={{ overflow: 'visible', position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
      >
        <polygon
          points={pts}
          fill={zoneColors.fill}
          stroke={isSelected ? 'var(--primary)' : zoneColors.stroke}
          strokeWidth={isSelected ? 2.5 : 1.5}
          strokeDasharray="6 3"
        />
        {el.label && (
          <text x={el.width / 2} y={el.height / 2}
            textAnchor="middle" dominantBaseline="middle"
            fontSize={11} fontWeight={600} fontFamily="inherit"
            className="fill-slate-600 dark:fill-slate-300"
          >{el.label}</text>
        )}
      </svg>
    </div>
  )
}

export function DrawingPreview({ preview }) {
  const w = Math.abs(preview.width)
  const h = Math.abs(preview.height)
  if (w < 4 || h < 4) return null
  const colors = DRAW_PREVIEW_COLORS[preview.kind] ?? 'border-primary bg-primary/10'
  return (
    <div
      className={['absolute pointer-events-none border-2 border-dashed rounded-sm flex items-end justify-end p-1', colors].join(' ')}
      style={{ left: preview.x, top: preview.y, width: w, height: h }}
    >
      <span className="text-[9px] text-muted-foreground bg-card/90 px-1 rounded leading-none py-0.5">
        {Math.round(w)} × {Math.round(h)}
      </span>
    </div>
  )
}
