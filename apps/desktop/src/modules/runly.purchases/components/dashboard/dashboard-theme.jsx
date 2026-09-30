import { cn } from '@runly/ui'

// Same grammar as the inventory dashboard (Panel with a tinted icon badge and
// a soft corner glow), copied rather than imported: modules never import each
// other. Tones default to the Compras teal.
export function Panel({ title, subtitle, icon: Icon, tone = '#0f766e', action = null, className, children }) {
  return (
    <section
      className={cn('relative min-w-0 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/60 p-5 shadow-sm backdrop-blur-sm', className)}
      style={{ backgroundImage: `radial-gradient(120% 80% at 100% 0%, color-mix(in oklab, ${tone} 12%, transparent), transparent 60%)` }}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {Icon ? (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm" style={{ backgroundColor: tone }}>
              <Icon className="h-4 w-4" />
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
          {p.name}: <span className="font-medium tabular-nums text-[hsl(var(--foreground))]">{formatter ? formatter(p.value, p) : p.value}</span>
        </p>
      ))}
    </div>
  )
}

export const AXIS = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 }
