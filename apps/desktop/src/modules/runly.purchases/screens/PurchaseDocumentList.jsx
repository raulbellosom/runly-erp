import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button, DataTable, EmptyState, ErrorState, FilterBar, MobileFiltersSheet, PageHeader, SearchInput } from '@runly/ui'
import { useCapabilities, useDocumentList, usePurchasesCan } from '../hooks/usePurchases.js'
import { usePurchaseRoute } from '../hooks/usePurchaseRoute.js'
import { LIST_SECTIONS } from '../lib/list-config.js'
import { KINDS, ROOT } from '../lib/purchases-constants.js'
import { buildColumns } from '../components/DocumentColumns.jsx'
import { SupplierField } from '../components/SupplierField.jsx'
import { CaseCreateDialog } from '../components/CaseCreateDialog.jsx'

const PAGE_SIZE = 25

function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

// One screen for every document list (orders, invoices, requests, receipts,
// cases, payments), driven by lib/list-config.js.
export default function PurchaseDocumentList() {
  const navigate = useNavigate()
  const { section } = usePurchaseRoute()
  const config = LIST_SECTIONS[section] ?? LIST_SECTIONS.orders
  const kindMeta = KINDS[config.kind]
  const caps = useCapabilities()
  const can = usePurchasesCan()

  const [status, setStatus] = useState(config.defaultStatus ?? 'ALL')
  const [search, setSearch] = useState('')
  const [supplierId, setSupplierId] = useState(null)
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounced(search)
  useEffect(() => { setStatus(config.defaultStatus ?? 'ALL'); setSearch(''); setSupplierId(null); setPage(1) }, [section, config.defaultStatus])
  useEffect(() => { setPage(1) }, [status, debouncedSearch, supplierId])

  // Status lives in a FilterBar chip (desktop) or the mobile filters sheet,
  // the same toolbar grammar as the inventory list.
  const defaultStatus = config.defaultStatus ?? 'ALL'
  const statusFilters = useMemo(() => [{
    key: 'status', label: 'Estado', type: 'select',
    options: config.chips.filter((c) => c.value !== defaultStatus),
  }], [config, defaultStatus])
  const filterValue = { status: status === defaultStatus ? '' : status }
  const onFilterChange = (next) => setStatus(next.status || defaultStatus)
  const activeFilters = (status !== defaultStatus ? 1 : 0) + (supplierId ? 1 : 0)
  const clearFilters = () => { setStatus(defaultStatus); setSupplierId(null) }

  const enabled = !config.capability || caps.has(config.capability) || (section === 'cases' && ['requests', 'quotes', 'approvals'].some(caps.has))
  const params = {
    page, pageSize: PAGE_SIZE,
    ...(config.chips.find((c) => c.value === status)?.params ?? (status !== 'ALL' ? { status } : {})),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(supplierId ? { supplierId } : {}),
  }
  const list = useDocumentList(config.kind, params, { enabled: enabled && !caps.isLoading })
  const rows = list.data?.data ?? []
  const total = list.data?.total ?? list.data?.pagination?.total ?? rows.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const columns = useMemo(
    () => buildColumns(config.columns, { kind: config.kind, open: (id) => navigate(`${ROOT}/${config.kind}/${id}`) }),
    [config, navigate],
  )

  const [caseOpen, setCaseOpen] = useState(false)
  const canCreate = kindMeta?.newLabel && can(kindMeta.create) && section !== 'payments'
  const onCreate = () => (section === 'cases' ? setCaseOpen(true) : navigate(`${ROOT}/${config.kind}/new`))

  if (!caps.isLoading && !enabled) {
    return (
      <div className="min-h-dvh p-4 md:p-6">
        <EmptyState icon={kindMeta?.icon} title="Esta sección no está activa"
          description="Tu flujo de compras no usa esta etapa. Puedes activarla en Configuración."
          action={can('purchases.settings.manage') ? { label: 'Ir a Configuración', onClick: () => navigate(`${ROOT}/settings`) } : null} />
      </div>
    )
  }

  return (
    <div className="min-h-dvh space-y-5 p-4 md:p-6">
      <PageHeader eyebrow="Compras" title={config.title} description={config.description}
        actions={canCreate ? <Button onClick={onCreate}><Plus className="h-4 w-4" />{kindMeta.newLabel}</Button> : null} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')}
            placeholder="Buscar por folio, título o referencia" className="min-w-48 flex-1" />
          <div className="hidden items-center gap-2 md:flex">
            {config.supplierFilter ? (
              <SupplierField label={null} value={supplierId} onChange={(id) => setSupplierId(id)} placeholder="Todos los proveedores" className="w-60" />
            ) : null}
            <FilterBar filters={statusFilters} value={filterValue} onChange={onFilterChange} />
          </div>
          <MobileFiltersSheet activeCount={activeFilters} onClear={clearFilters}>
            <div className="space-y-4">
              {config.supplierFilter ? (
                <SupplierField label="Proveedor" value={supplierId} onChange={(id) => setSupplierId(id)} placeholder="Todos los proveedores" />
              ) : null}
              <FilterBar filters={statusFilters} value={filterValue} onChange={onFilterChange} />
            </div>
          </MobileFiltersSheet>
        </div>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {list.isLoading ? 'Cargando...' : `${total} ${total === 1 ? 'documento' : 'documentos'}`}
        </p>
      </div>

      {list.isError ? (
        <ErrorState title="No se pudo cargar la lista" description={list.error?.message} onRetry={() => list.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          isLoading={list.isLoading}
          manualPagination
          showToolbar={false}
          showPagination={false}
          pageSize={PAGE_SIZE}
          getRowId={(row) => row.id}
          emptyIcon={kindMeta?.icon}
          emptyTitle={debouncedSearch || status !== (config.defaultStatus ?? 'ALL') || supplierId ? 'Sin resultados con estos filtros' : config.emptyTitle}
          emptyDescription={config.emptyDescription}
          emptyAction={canCreate && !debouncedSearch ? { label: kindMeta.newLabel, onClick: onCreate } : null}
        />
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-between gap-3 text-sm text-[hsl(var(--muted-foreground))]">
          <span>{(page - 1) * PAGE_SIZE + 1} a {Math.min(page * PAGE_SIZE, total)} de {total}</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
            <span className="px-2 tabular-nums">{page} / {pageCount}</span>
            <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      ) : null}

      {section === 'cases' ? <CaseCreateDialog open={caseOpen} onOpenChange={setCaseOpen} /> : null}
    </div>
  )
}
