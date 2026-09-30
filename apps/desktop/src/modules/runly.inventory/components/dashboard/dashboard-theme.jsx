import { cn } from '@runly/ui'

// Categorical palette (validated reference order: blue, orange, aqua, yellow,
// magenta, green, violet, red), stepped per theme. Slices/series take slots in
// this fixed order; anything past the 7th folds into "Otros" (slot 8 is kept
// for it as a neutral).
export const VIZ_VARS = [
  '[--viz-1:#2a78d6] [--viz-2:#eb6834] [--viz-3:#1baf7a] [--viz-4:#eda100]',
  '[--viz-5:#e87ba4] [--viz-6:#008300] [--viz-7:#4a3aa7] [--viz-other:#9ca3af]',
  'dark:[--viz-1:#3987e5] dark:[--viz-2:#d95926] dark:[--viz-3:#199e70] dark:[--viz-4:#c98500]',
  'dark:[--viz-5:#d55181] dark:[--viz-6:#008300] dark:[--viz-7:#9085e9] dark:[--viz-other:#6b7280]',
].join(' ')
export const vizColor = (index) => (index < 7 ? `var(--viz-${index + 1})` : 'var(--viz-other)')

// Up to 7 named slices plus an "Otros" remainder so the shares add up.
export function withOthers(rows, total) {
  const named = rows.slice(0, 7)
  const rest = total - named.reduce((sum, r) => sum + r.count, 0)
  return rest > 0 ? [...named, { key: 'others', label: 'Otros', count: rest, others: true }] : named
}

// Card with an accent icon badge; `tone` tints the badge and the top glow.
export function Panel({ title, subtitle, icon: Icon, tone = 'var(--brand-primary)', action = null, className, children }) {
  return (
    <section
      className={cn('relative min-w-0 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 p-5 shadow-sm backdrop-blur-sm', className)}
      style={{ backgroundImage: `radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, ${tone} 14%, transparent), transparent 60%)` }}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: tone }}>
              <Icon className="h-4.5 w-4.5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h3>
            {subtitle ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

export function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--popover))] px-3 py-2 text-xs shadow-lg">
      {label ? <p className="mb-1 font-medium text-[hsl(var(--foreground))]">{label}</p> : null}
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color ?? p.payload?.fill }} />
          {p.name}: <span className="tabular-nums font-medium text-[hsl(var(--foreground))]">{formatter ? formatter(p.value, p) : p.value}</span>
        </p>
      ))}
    </div>
  )
}

export function LegendList({ rows, total, onSelect, onHover = null, activeIndex = null }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((row, i) => {
        const pct = total ? Math.round((row.count / total) * 100) : 0
        const clickable = onSelect && !row.others && row.id
        const Tag = clickable ? 'button' : 'div'
        return (
          <li key={row.key} onMouseEnter={onHover ? () => onHover(i) : undefined}>
            <Tag type={clickable ? 'button' : undefined} onClick={clickable ? () => onSelect(row) : undefined}
              className={cn('flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm', clickable && 'hover:bg-[hsl(var(--muted))]/50',
                activeIndex !== null && activeIndex !== i && 'opacity-45', activeIndex === i && 'bg-[hsl(var(--muted))]/50')}>
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: row.color ?? vizColor(row.others ? 7 : i) }} />
              <span className="min-w-0 flex-1 truncate text-[hsl(var(--foreground))]">{row.label}</span>
              <span className="tabular-nums text-[hsl(var(--muted-foreground))]">{row.count}</span>
              <span className="w-9 text-right tabular-nums text-[hsl(var(--muted-foreground))]">{pct}%</span>
            </Tag>
          </li>
        )
      })}
    </ul>
  )
}
