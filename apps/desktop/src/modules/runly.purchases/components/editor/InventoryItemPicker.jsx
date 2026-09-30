import { useEffect, useState } from 'react'
import { Boxes, ChevronLeft, ChevronRight, PackageSearch } from 'lucide-react'
import {
  Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, ErrorState, SearchInput, Skeleton, cn,
} from '@runly/ui'
import { useInventoryCandidates } from '../../hooks/usePurchases.js'

const PAGE_SIZE = 20

// Multi-select over GET /purchases/inventory/candidates. Selection survives
// searches and pages; confirming returns the chosen item objects.
export function InventoryItemPicker({ open, onOpenChange, selected = [], onConfirm, title = 'Elegir activos de Inventario', confirmLabel = 'Relacionar' }) {
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [picked, setPicked] = useState(new Map())
  useEffect(() => { if (open) { setPicked(new Map(selected.map((item) => [item.id, item]))); setSearch(''); setPage(1) } }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1) }, 250); return () => clearTimeout(t) }, [search])

  const query = useInventoryCandidates({ search: debounced || undefined, page, pageSize: PAGE_SIZE }, open)
  const rows = query.data?.data ?? []
  const unavailable = query.data?.available === false
  const total = query.data?.total ?? rows.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const toggle = (item) => setPicked((current) => {
    const next = new Map(current)
    if (next.has(item.id)) next.delete(item.id)
    else next.set(item.id, item)
    return next
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="2xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Busca por nombre, etiqueta o número de serie. Puedes elegir varios.</DialogDescription>
        </DialogHeader>
        <div className="mt-3 shrink-0">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')} placeholder="Laptop, INV-0042, número de serie" autoFocus />
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-0.5">
          {unavailable ? (
            <EmptyState icon={Boxes} title="Inventario no está activo" description="Instala o activa el módulo Inventario para relacionar activos con tus compras." />
          ) : query.isError ? (
            <ErrorState title="No se pudieron cargar los activos" onRetry={() => query.refetch()} />
          ) : query.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
          ) : !rows.length ? (
            <EmptyState icon={PackageSearch} title="Sin coincidencias" description="Prueba con otra búsqueda." />
          ) : (
            <ul className="space-y-1.5">
              {rows.map((item) => {
                const checked = picked.has(item.id)
                return (
                  <li key={item.id}>
                    <div role="button" tabIndex={0} onClick={() => toggle(item)} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(item) } }}
                      className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
                        checked ? 'border-teal-600/50 bg-teal-500/10' : 'border-transparent bg-[hsl(var(--muted))]/35 hover:bg-[hsl(var(--muted))]/70')}>
                      <Checkbox checked={checked} onCheckedChange={() => toggle(item)} onClick={(e) => e.stopPropagation()} aria-label={`Elegir ${item.name}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{item.name}</span>
                        <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{[item.assetTag, item.categoryName, item.serialNumber].filter(Boolean).join(', ')}</span>
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="shrink-0 items-center gap-2 sm:justify-between">
          <div className="flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))]">
            {pageCount > 1 ? (
              <>
                <Button variant="ghost" size="icon-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
                <span className="tabular-nums">{page} / {pageCount}</span>
                <Button variant="ghost" size="icon-sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></Button>
              </>
            ) : null}
            <span className="ml-2">{picked.size} {picked.size === 1 ? 'elegido' : 'elegidos'}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button disabled={unavailable} onClick={() => { onConfirm([...picked.values()]); onOpenChange(false) }}>{confirmLabel}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
