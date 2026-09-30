import { Skeleton, cn } from '@runly/ui'
import { ADMIN_STATUSES } from '../lib/admin-status.js'

// KPI strip: total plus one tile per administrative status with its share of
// the total. `onSelect(adminStatus | 'all')` lets the list filter by a tile;
// `active` highlights the current filter.
export function InventoryAdminKpis({ summary, isLoading, active = null, onSelect = null }) {
  const total = summary?.total ?? 0
  const tiles = [
    { value: 'all', label: 'Total', count: total, color: null },
    ...ADMIN_STATUSES.map((s) => ({ value: s.value, label: s.label, count: summary?.byAdminStatus?.[s.value] ?? 0, color: s.color })),
  ]
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const pct = total && tile.value !== 'all' ? Math.round((tile.count / total) * 100) : null
        const Tag = onSelect ? 'button' : 'div'
        return (
          <Tag
            key={tile.value}
            type={onSelect ? 'button' : undefined}
            onClick={onSelect ? () => onSelect(tile.value) : undefined}
            className={cn(
              'rounded-2xl border px-4 py-3 text-left transition-colors',
              active === tile.value ? 'border-(--brand-primary) bg-(--brand-soft)' : 'border-[hsl(var(--border))]',
              onSelect && 'hover:bg-[hsl(var(--muted))]/40',
            )}
          >
            <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              {tile.color ? <span className="h-2 w-2 rounded-full" style={{ backgroundColor: tile.color }} /> : null}
              {tile.label}
            </p>
            {isLoading ? <Skeleton className="mt-1.5 h-6 w-12" /> : (
              <p className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-xl font-semibold tabular-nums text-[hsl(var(--foreground))]">{tile.count}</span>
                {pct !== null ? <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{pct}%</span> : null}
              </p>
            )}
          </Tag>
        )
      })}
    </div>
  )
}
