import { Skeleton } from '@runly/ui'

// Loading placeholders for runly.canvas. Each one copies the box model of the
// component it stands in for (padding, aspect ratios, line heights) so nothing
// jumps when the real content arrives.

// Mirrors BoardCard: 16:9 cover with the template pill, title, description
// and the pages / "Editado" footer.
export function BoardCardSkeleton() {
  return (
    <div aria-hidden className="flex w-full flex-col overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm">
      <div className="relative aspect-[16/9] bg-[hsl(var(--muted)/0.5)]">
        <Skeleton className="absolute left-3 top-3 h-5 w-16 rounded-full" />
        <Skeleton className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-xl" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <div className="mt-auto flex items-center gap-3 pt-2">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="ml-auto h-3.5 w-24" />
        </div>
      </div>
    </div>
  )
}

// Mirrors the "Nuevo Board" template card: preview, label, description.
export function TemplateCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col items-start gap-1.5 rounded-xl border border-[hsl(var(--border))] p-2.5">
      <Skeleton className="aspect-120/68 w-full rounded-lg" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-3 w-32" />
    </div>
  )
}

// Mirrors LibraryItemTile: 96 px thumbnail + one-line name.
export function LibraryTileSkeleton() {
  return (
    <div aria-hidden className="flex flex-col items-center gap-1 p-1">
      <Skeleton className="aspect-square w-full rounded-md" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  )
}

// Mirrors VersionRow: title, meta line and the "Restaurar" button.
export function VersionRowSkeleton({ withAction = true }) {
  return (
    <li aria-hidden className="flex items-start justify-between gap-3 p-3">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      {withAction ? <Skeleton className="h-8 w-20 rounded-md" /> : null}
    </li>
  )
}

// Pages header + layer rows of the left panel while the Board loads.
export function LayersPanelSkeleton() {
  return (
    <div aria-hidden className="flex h-full flex-col gap-4 p-3">
      <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
      <div className="space-y-1 rounded-xl border border-[hsl(var(--border))] p-3">
        <Skeleton className="mb-2 h-3 w-14" />
        {[0, 1, 2].map((key) => (
          <div key={key} className="flex items-center gap-2.5 px-1 py-1.5">
            <Skeleton className="h-4 w-4 rounded" />
            <div className="flex-1 space-y-1"><Skeleton className="h-3.5 w-24" /><Skeleton className="h-2.5 w-12" /></div>
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-4 rounded" />
          </div>
        ))}
      </div>
    </div>
  )
}

// Canvas area while the Board/page objects load: a few faint shapes in the
// middle of the dot grid instead of a block covering the whole canvas.
export function CanvasLoadingSkeleton() {
  return (
    <div role="status" aria-label="Cargando Board" className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-6">
      <div className="grid w-full max-w-md grid-cols-3 gap-4 opacity-80">
        <Skeleton className="col-span-2 h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-full" />
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="col-span-2 h-16 rounded-xl" />
      </div>
    </div>
  )
}

// Mirrors the Boards home search row (input + count) and the filter row.
export function HomeToolbarSkeleton() {
  return (
    <div aria-hidden className="mb-5 flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-10 w-full rounded-md sm:max-w-sm" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {[0, 1, 2, 3].map((key) => (
          <div key={key} className="space-y-1.5"><Skeleton className="h-3.5 w-16" /><Skeleton className="h-10 w-40 rounded-md" /></div>
        ))}
      </div>
    </div>
  )
}
