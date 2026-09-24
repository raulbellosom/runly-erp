// apps/desktop/src/modules/runly.ledger/components/LedgerStatCard.jsx
// A more colorful, bigger-icon, less-rounded KPI card than @runly/ui's
// generic StatCard/StatStrip — built specifically for runly.ledger after
// feedback that the generic strip read as too small/monochrome/empty. Still
// built from real numbers only (accepts whatever `value`/`hint` the caller
// computed from actual data) — this is a presentation component, not a data source.

const TONE = {
  brand: {
    chip: 'bg-(--brand-soft) text-(--brand-primary)',
    border: 'border-(--brand-primary)/25',
    accent: 'bg-(--brand-primary)',
  },
  success: {
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    border: 'border-emerald-500/20',
    accent: 'bg-emerald-500',
  },
  destructive: {
    chip: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    border: 'border-rose-500/20',
    accent: 'bg-rose-500',
  },
  amber: {
    chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    border: 'border-amber-500/20',
    accent: 'bg-amber-500',
  },
  violet: {
    chip: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    border: 'border-violet-500/20',
    accent: 'bg-violet-500',
  },
  neutral: {
    chip: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
    border: 'border-[hsl(var(--border))]',
    accent: 'bg-[hsl(var(--muted-foreground))]',
  },
}

export function LedgerStatCard({ label, value, icon: Icon, tone = 'neutral', hint, className = '' }) {
  const t = TONE[tone] ?? TONE.neutral
  return (
    <div className={`relative overflow-hidden rounded-xl border ${t.border} bg-[hsl(var(--card))] shadow-sm transition-shadow hover:shadow-md ${className}`}>
      <span className={`absolute inset-y-0 left-0 w-1 ${t.accent}`} />
      <div className="flex items-center gap-3 p-4 pl-5">
        {Icon && (
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${t.chip}`}>
            <Icon size={22} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] truncate">
            {label}
          </div>
          <div className="text-xl font-bold tabular-nums truncate leading-tight">{value}</div>
          {hint && <div className="text-[11px] text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{hint}</div>}
        </div>
      </div>
    </div>
  )
}

// Static per-count column maps — Tailwind needs literal class names in
// source (no runtime string interpolation), so this mirrors the same
// pattern @runly/ui's own StatStrip uses internally.
const SM_COLS = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-2' }
const LG_COLS = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' }

export function LedgerStatStrip({ items, className = '' }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  if (list.length === 0) return null
  const n = Math.max(1, Math.min(list.length, 4))
  return (
    <div className={`grid grid-cols-1 gap-3 ${SM_COLS[n]} ${LG_COLS[n]} ${className}`}>
      {list.map((item) => <LedgerStatCard key={item.key} {...item} />)}
    </div>
  )
}
