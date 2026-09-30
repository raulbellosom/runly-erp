import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, FileSearch } from 'lucide-react'
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  EmptyState, ErrorState, SearchInput, SegmentedControl, Skeleton, cn,
} from '@runly/ui'
import { toast } from 'sonner'
import { runly } from '../../../lib/runly.js'
import { formatDay, formatMoney, statusMeta } from './InventoryPurchaseMeta.js'

const PAGE_SIZE = 8
const TYPES = {
  order: { label: 'Orden de compra', sourceType: 'purchase_order', relationType: 'PURCHASED_IN' },
  invoice: { label: 'Factura', sourceType: 'purchase_invoice', relationType: 'INVOICED_ITEM' },
}

// "Relacionar existente": pick one order or invoice of the company and link
// it to the inventory item (origin MANUAL).
export function InventoryPurchaseLinkDialog({ open, onOpenChange, inventoryId, token, types, linkedIds, onLinked }) {
  const client = useQueryClient()
  const [type, setType] = useState(types[0] ?? 'order')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    const timer = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])
  useEffect(() => {
    if (!open) { setSearch(''); setDebounced(''); setPage(1); setSelected(null) }
  }, [open])
  useEffect(() => {
    if (!types.includes(type) && types[0]) setType(types[0])
  }, [types, type])

  const results = useQuery({
    queryKey: ['purchases', 'documents-search', type, debounced, page],
    queryFn: () => runly.purchases.searchDocuments({ type, search: debounced || undefined, page, pageSize: PAGE_SIZE }, token),
    enabled: Boolean(open && token && type),
    placeholderData: keepPreviousData,
  })
  const rows = results.data?.data ?? []
  const total = Number(results.data?.total ?? rows.length)
  const pageCount = Math.max(1, Math.ceil(total / (results.data?.pageSize || PAGE_SIZE)))

  const link = useMutation({
    mutationFn: (doc) => runly.purchases.createRelation({
      sourceModule: 'runly.purchases',
      sourceType: TYPES[type].sourceType,
      sourceId: doc.id,
      targetModule: 'runly.inventory',
      targetType: 'inventory_item',
      targetId: inventoryId,
      relationType: TYPES[type].relationType,
      origin: 'MANUAL',
    }, token),
    onSuccess: (_, doc) => {
      client.invalidateQueries({ queryKey: ['purchases', 'relations'] })
      onLinked?.()
      toast.success(`${TYPES[type].label} ${doc.number ?? ''} relacionada`.replace(/\s+/g, ' ').trim())
      onOpenChange(false)
    },
    onError: (error) => toast.error(error?.message ?? 'No se pudo crear la relación'),
  })

  const typeOptions = useMemo(() => types.map((value) => ({ value, label: value === 'order' ? 'Órdenes' : 'Facturas' })), [types])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" scrollable>
        <DialogHeader className="shrink-0">
          <DialogTitle>Relacionar documento existente</DialogTitle>
          <DialogDescription>Busca la orden o factura con la que se adquirió este activo.</DialogDescription>
        </DialogHeader>
        <div className="shrink-0 space-y-3 pt-4">
          {typeOptions.length > 1 ? (
            <SegmentedControl ariaLabel="Tipo de documento" options={typeOptions} value={type} onChange={(value) => { setType(value); setPage(1); setSelected(null) }} />
          ) : null}
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Buscar por folio o proveedor"
            aria-label="Buscar documentos"
          />
        </div>
        <div className="min-h-[220px] flex-1 overflow-y-auto overscroll-contain py-3">
          {results.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}</div>
          ) : results.isError ? (
            <ErrorState title="No se pudo buscar" description={results.error?.message} onRetry={() => results.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState icon={FileSearch} title="Sin resultados" description={debounced ? 'Prueba con otro folio o proveedor.' : 'Todavía no hay documentos de este tipo.'} />
          ) : (
            <ul className={cn('space-y-2', results.isFetching && 'opacity-70')} role="listbox" aria-label="Documentos">
              {rows.map((doc) => {
                const linked = linkedIds.has(doc.id)
                const active = selected?.id === doc.id
                const status = statusMeta(doc.status)
                return (
                  <li key={doc.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      disabled={linked}
                      onClick={() => setSelected(doc)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
                        active ? 'border-teal-500 bg-teal-500/5' : 'border-[hsl(var(--border))] hover:border-teal-500/40',
                        linked && 'cursor-not-allowed opacity-60',
                      )}
                    >
                      <span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border', active ? 'border-teal-600 bg-teal-600 text-white' : 'border-[hsl(var(--border))]')}>
                        {active ? <Check className="h-3 w-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[13px] font-semibold">{doc.number || 'Sin folio'}</span>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', status.className)}>{status.label}</span>
                          {linked ? <span className="text-[10px] font-medium text-[hsl(var(--muted-foreground))]">Ya relacionado</span> : null}
                        </span>
                        <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">
                          {[doc.supplierName, formatDay(doc.date ?? doc.issueDate ?? doc.createdAt)].filter(Boolean).join(' · ') || 'Sin proveedor'}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(doc.total, doc.currency)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="shrink-0 flex-row items-center justify-between gap-2 border-t border-[hsl(var(--border))] pt-4 sm:justify-between">
          <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
            {pageCount > 1 ? (
              <>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
                <span className="tabular-nums">{page} / {pageCount}</span>
                <Button type="button" size="icon" variant="ghost" className="h-8 w-8" disabled={page >= pageCount} onClick={() => setPage(page + 1)} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></Button>
              </>
            ) : <span>{total ? `${total} ${total === 1 ? 'documento' : 'documentos'}` : ''}</span>}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" className="bg-teal-600 text-white hover:bg-teal-700" disabled={!selected || link.isPending} onClick={() => link.mutate(selected)}>
              {link.isPending ? 'Relacionando…' : 'Relacionar'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
