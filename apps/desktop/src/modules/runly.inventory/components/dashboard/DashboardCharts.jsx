import { Skeleton } from '@runly/ui'
import { Users } from 'lucide-react'
import { Panel, vizColor } from './dashboard-theme.jsx'

const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()

// People: avatar initials with a progress ring of their share of assigned items.
export function HoldersPanel({ rows, assignedTotal }) {
  return (
    <Panel title="Quién tiene más equipos" subtitle={`${assignedTotal} activos asignados`} icon={Users} tone="var(--viz-7)">
      {!rows.length ? <p className="text-xs text-[hsl(var(--muted-foreground))]">Aún no hay equipos asignados.</p> : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {rows.map((r, i) => {
            const pct = assignedTotal ? r.count / assignedTotal : 0
            const color = vizColor(i % 7)
            return (
              <li key={r.id} className="flex items-center gap-3 rounded-xl bg-[hsl(var(--muted))]/35 px-3 py-2" title={`${r.name}: ${r.count}`}>
                <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{ background: `conic-gradient(${color} ${pct * 360}deg, hsl(var(--muted)) 0deg)` }}>
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--card))] text-[hsl(var(--foreground))]">{initials(r.name)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-[hsl(var(--foreground))]">{r.name}</span>
                  <span className="block text-xs text-[hsl(var(--muted-foreground))]">{r.count} {r.count === 1 ? 'equipo' : 'equipos'}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

export function ChartsSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
    </div>
  )
}
