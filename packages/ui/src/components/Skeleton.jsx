import { cn } from '../lib/utils.js'

function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-xl bg-[hsl(var(--muted))]',
        className
      )}
      {...props}
    />
  )
}

function FormSkeleton({ sections = 2, cols = 2 }) {
  return (
    <div className="space-y-6">
      {Array.from({ length: sections }).map((_, i) => (
        <div key={i} className="space-y-4">
          <div className="pb-3 border-b border-[hsl(var(--border))]">
            <Skeleton className="h-4 w-32" />
          </div>
          <div className={cols === 1 ? 'grid gap-4' : 'grid gap-4 md:grid-cols-2'}>
            {Array.from({ length: cols * 2 }).map((_, j) => (
              <div key={j} className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-10 w-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Page-level placeholder shaped like a record detail (hero + KPI strip +
// two-column cards), so a detail screen never flashes a bare "Cargando...".
function DetailSkeleton({ kpis = 4, mainCards = 3, asideCards = 2 }) {
  const card = (key, rows) => (
    <div key={key} className="space-y-4 rounded-2xl border border-[hsl(var(--border))] p-5">
      <Skeleton className="h-4 w-36" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  )
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando">
      <div className="overflow-hidden rounded-2xl border border-[hsl(var(--border))]">
        <div className="flex flex-col gap-5 p-5 sm:flex-row">
          <Skeleton className="aspect-[4/3] w-full rounded-2xl sm:w-56" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
            <div className="flex flex-wrap gap-2 pt-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-7 w-24 rounded-full" />)}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 border-t border-[hsl(var(--border))] lg:grid-cols-4">
          {Array.from({ length: kpis }).map((_, i) => (
            <div key={i} className="space-y-2 p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="space-y-6">{Array.from({ length: mainCards }).map((_, i) => card(`m${i}`, 4))}</div>
        <div className="space-y-6">{Array.from({ length: asideCards }).map((_, i) => card(`a${i}`, 2))}</div>
      </div>
    </div>
  )
}

export { Skeleton, FormSkeleton, DetailSkeleton }
