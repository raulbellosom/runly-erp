import { Skeleton, cn } from '@runly/ui'
import { Boxes, Clock, CheckCircle2, AlertTriangle, Ban } from 'lucide-react'
import { ADMIN_STATUSES } from '../lib/admin-status.js'

const STATUS_ICONS = {
  registration_pending: Clock,
  registered: CheckCircle2,
  deregistration_proposed: AlertTriangle,
  deregistered: Ban,
}

// KPI strip: total plus one tile per administrative status with its share of
// the total. `onSelect(adminStatus | 'all')` lets the list filter by a tile;
// `active` highlights the current filter. Each tile is tinted with its status
// color (icon badge, soft background, share bar).
export function InventoryAdminKpis({ summary, isLoading, active = null, onSelect = null }) {
  const total = summary?.total ?? 0
  const tiles = [
    { value: 'all', label: 'Total', count: total, color: 'var(--brand-primary)', Icon: Boxes },
    ...ADMIN_STATUSES.map((s) => ({
      value: s.value,
      label: s.label,
      count: summary?.byAdminStatus?.[s.value] ?? 0,
      color: s.color,
      Icon: STATUS_ICONS[s.value] ?? Boxes,
    })),
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => {
        const pct = total && tile.value !== 'all' ? Math.round((tile.count / total) * 100) : null
        const Tag = onSelect ? 'button' : 'div'
        const isActive = active === tile.value
        return (
          <Tag
            key={tile.value}
            type={onSelect ? 'button' : undefined}
            onClick={onSelect ? () => onSelect(tile.value) : undefined}
            className={cn(
              'relative overflow-hidden rounded-2xl border px-4 py-3 text-left transition-all',
              onSelect && 'hover:-translate-y-0.5 hover:shadow-md',
              isActive ? 'shadow-md ring-2' : 'border-[hsl(var(--border))]',
            )}
            style={{
              backgroundImage: `linear-gradient(135deg, color-mix(in srgb, ${tile.color} 14%, transparent), color-mix(in srgb, ${tile.color} 3%, transparent))`,
              ...(isActive ? { borderColor: tile.color, '--tw-ring-color': `color-mix(in srgb, ${tile.color} 30%, transparent)` } : null),
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-[hsl(var(--muted-foreground))]">{tile.label}</p>
                {isLoading ? <Skeleton className="mt-1.5 h-7 w-12" /> : (
                  <p className="mt-0.5 flex items-baseline gap-1.5">
                    <span className="text-2xl font-bold tabular-nums text-[hsl(var(--foreground))]">{tile.count}</span>
                    {pct !== null ? <span className="text-xs font-medium tabular-nums" style={{ color: tile.color }}>{pct}%</span> : null}
                  </p>
                )}
              </div>
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
                style={{ backgroundColor: tile.color }}
              >
                <tile.Icon className="h-4.5 w-4.5" />
              </span>
            </div>
            {pct !== null ? (
              <div className="mt-2.5 h-1 overflow-hidden rounded-full" style={{ backgroundColor: `color-mix(in srgb, ${tile.color} 15%, transparent)` }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: tile.color }} />
              </div>
            ) : <div className="mt-2.5 h-1" />}
          </Tag>
        )
      })}
    </div>
  )
}
