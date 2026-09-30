import { AlertTriangle, Check } from 'lucide-react'
import { cn } from '@runly/ui'
import { stageMeta } from '../lib/purchases-constants.js'

// Signature element of Compras: the company's enabled stages as one connected
// track. Used with pipeline counts (dashboard), document progress (detail),
// preset preview (settings) and, vertical, next to inventory items.
//   stages: [{ type, label?, mode?, state?, count?, refs?: [{ id, number, type }] }]
//   state:  done | current | pending | skipped | blocked (omitted = neutral)
//   surface: 'light' (cards) | 'dark' (on the teal hero)

const MODE_HINT = { CONDITIONAL: 'si aplica', OPTIONAL: 'opcional' }

function nodeClasses(state, dark) {
  switch (state) {
    case 'done': return 'bg-emerald-500 text-white border-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.18)]'
    case 'current': return dark
      ? 'bg-white text-teal-800 border-white shadow-[0_0_0_5px_rgba(255,255,255,0.22)]'
      : 'bg-teal-700 text-white border-teal-700 shadow-[0_0_0_5px_rgba(15,118,110,0.18)]'
    case 'blocked': return 'bg-rose-600 text-white border-rose-600 shadow-[0_0_0_4px_rgba(225,29,72,0.18)]'
    case 'skipped': return dark ? 'border-dashed border-white/40 text-white/50 bg-transparent' : 'border-dashed border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]/70 bg-transparent'
    case 'pending': return dark ? 'bg-white/5 border-white/35 text-white/80' : 'bg-[hsl(var(--card))] border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'
    default: return dark ? 'bg-white/12 border-white/25 text-white backdrop-blur-md' : 'bg-teal-500/10 border-teal-600/25 text-teal-700 dark:text-teal-300'
  }
}

function connectorClass(state, dark) {
  if (state === 'done') return 'bg-emerald-500'
  return dark ? 'bg-[linear-gradient(90deg,rgba(255,255,255,.45)_50%,transparent_0)] bg-[length:8px_2px]' : 'bg-[linear-gradient(90deg,hsl(var(--border))_50%,transparent_0)] bg-[length:8px_2px]'
}

function StageIcon({ stage }) {
  if (stage.state === 'done') return <Check className="h-4 w-4" strokeWidth={3} />
  if (stage.state === 'blocked') return <AlertTriangle className="h-4 w-4" />
  const Icon = stageMeta(stage.type).icon
  return <Icon className="h-4 w-4" />
}

function Refs({ refs, dark, onOpenRef }) {
  if (!refs?.length) return null
  return (
    <span className="mt-1 flex flex-wrap justify-center gap-1">
      {refs.slice(0, 2).map((ref) => (
        <button key={ref.id} type="button" onClick={() => onOpenRef?.(ref)}
          className={cn('rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2',
            dark ? 'bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/60' : 'bg-[hsl(var(--muted))] text-[hsl(var(--foreground))] hover:bg-teal-500/15 focus-visible:ring-teal-500/40')}>
          {ref.number ?? 'Ver'}
        </button>
      ))}
      {refs.length > 2 ? <span className={cn('text-[11px]', dark ? 'text-white/60' : 'text-[hsl(var(--muted-foreground))]')}>+{refs.length - 2}</span> : null}
    </span>
  )
}

export function PurchaseFlowRibbon({ stages = [], surface = 'light', orientation = 'horizontal', onSelect, onOpenRef, className }) {
  const dark = surface === 'dark'
  if (!stages.length) return null

  if (orientation === 'vertical') {
    return (
      <ol className={cn('relative', className)}>
        {stages.map((stage, index) => {
          const last = index === stages.length - 1
          return (
            <li key={stage.type + index} className="relative flex gap-3 pb-4 last:pb-0">
              {!last ? <span aria-hidden className={cn('absolute left-[17px] top-9 bottom-0 w-0.5', stage.state === 'done' ? 'bg-emerald-500' : 'bg-[linear-gradient(180deg,hsl(var(--border))_50%,transparent_0)] bg-[length:2px_8px]')} /> : null}
              <span className={cn('relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2', nodeClasses(stage.state, false))}>
                <StageIcon stage={stage} />
              </span>
              <div className="min-w-0 flex-1 pt-1">{stage.content ?? <p className="text-sm font-medium">{stage.label ?? stageMeta(stage.type).label}</p>}</div>
            </li>
          )
        })}
      </ol>
    )
  }

  return (
    <div className={cn('-mx-1 overflow-x-auto px-1 pb-1', className)}>
      <ol className="grid min-w-max gap-0" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(5.75rem, 1fr))` }}>
        {stages.map((stage, index) => {
          const last = index === stages.length - 1
          const label = stage.label ?? stageMeta(stage.type).label
          const Tag = onSelect ? 'button' : 'div'
          const hasCount = stage.count != null
          return (
            <li key={stage.type + index} className="relative flex flex-col items-center px-1 text-center">
              {!last ? <span aria-hidden className={cn('absolute left-1/2 top-[1.125rem] h-0.5 w-full', connectorClass(stage.state, dark))} /> : null}
              <Tag type={onSelect ? 'button' : undefined} onClick={onSelect ? () => onSelect(stage) : undefined}
                aria-label={onSelect ? `${label}${hasCount ? `: ${stage.count}` : ''}` : undefined}
                className={cn('relative z-10 flex h-9 w-9 items-center justify-center rounded-full border-2 transition-transform',
                  nodeClasses(stage.state, dark), onSelect && 'hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-teal-400')}>
                <StageIcon stage={stage} />
              </Tag>
              {hasCount ? (
                <span className={cn('mt-2 text-2xl font-semibold leading-none tabular-nums', dark ? 'text-white' : 'text-[hsl(var(--foreground))]')}>{stage.count}</span>
              ) : null}
              <span className={cn('mt-1.5 text-xs font-medium', dark ? 'text-white/85' : 'text-[hsl(var(--foreground))]', stage.state === 'skipped' && 'line-through opacity-60')}>{label}</span>
              {stage.mode && MODE_HINT[stage.mode] ? (
                <span className={cn('text-[11px]', dark ? 'text-white/55' : 'text-[hsl(var(--muted-foreground))]')}>{MODE_HINT[stage.mode]}</span>
              ) : null}
              <Refs refs={stage.refs} dark={dark} onOpenRef={onOpenRef} />
            </li>
          )
        })}
      </ol>
    </div>
  )
}
