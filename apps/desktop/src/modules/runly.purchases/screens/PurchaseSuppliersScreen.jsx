import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ChevronLeft, ChevronRight, UserPlus } from 'lucide-react'
import { Button, DataTable, EmptyState, ErrorState, FilterBar, MobileFiltersSheet, PageHeader, SearchInput, Skeleton, ViewModeSwitch } from '@runly/ui'
import { useSuppliers } from '../hooks/usePurchases.js'
import { ROOT } from '../lib/purchases-constants.js'
import { formatMoneyCompact, initials, toNumber } from '../lib/format.js'

const PAGE_SIZE = 24
const SCOPE_FILTERS = [{ key: 'scope', label: 'Mostrar', type: 'select', options: [{ value: 'all', label: 'Todo el directorio' }] }]
const VIEW_KEY = 'runly.purchases.suppliers.view'
const readView = () => { try { return localStorage.getItem(VIEW_KEY) || 'cards' } catch { return 'cards' } }

function SupplierCard({ s, maxSpend, onOpen }) {
  const share = maxSpend ? toNumber(s.spend) / maxSpend : 0
  return (
    <button type="button" onClick={onOpen}
      className="flex min-w-0 flex-col rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 text-left shadow-sm transition-colors hover:border-teal-600/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40">
      <div className="flex items-center gap-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(#0f766e ${share * 360}deg, hsl(var(--muted)) 0deg)` }}>
          {s.avatarUrl
            ? <img src={s.avatarUrl} alt="" className="h-9 w-9 rounded-full object-cover ring-2 ring-[hsl(var(--card))]" />
            : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--card))] text-xs font-semibold">{initials(s.name)}</span>}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-semibold">{s.name}</span>
          <span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{[s.profile?.supplierCode, s.taxId].filter(Boolean).join(', ') || s.email || 'Sin datos fiscales'}</span>
        </span>
      </div>
      <div className="mt-4 flex items-end justify-between gap-2">
        <span>
          <span className="block text-xl font-semibold tabular-nums">{formatMoneyCompact(s.spend)}</span>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">comprado en 12 meses</span>
        </span>
        <span className="text-right text-xs text-[hsl(var(--muted-foreground))]">
          <span className="block text-sm font-medium tabular-nums text-[hsl(var(--foreground))]">{s.documents ?? 0}</span>documentos
        </span>
      </div>
      {s.profile?.paymentTerms ? <p className="mt-3 truncate rounded-lg bg-[hsl(var(--muted))]/50 px-2 py-1 text-xs">{s.profile.paymentTerms}</p> : null}
    </button>
  )
}

// Suppliers are directory contacts; Compras adds a profile, spend and history.
export default function PurchaseSuppliersScreen() {
  const navigate = useNavigate()
  const [view, setView] = useState(readView)
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  useEffect(() => { const t = setTimeout(() => { setDebounced(search); setPage(1) }, 300); return () => clearTimeout(t) }, [search])
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* per-viewer convenience only */ } }, [view])

  const [scope, setScope] = useState('suppliers')
  const scopeValue = { scope: scope === 'all' ? 'all' : '' }
  const onScopeChange = (next) => { setScope(next.scope === 'all' ? 'all' : 'suppliers'); setPage(1) }
  const query = useSuppliers({ search: debounced || undefined, page, pageSize: PAGE_SIZE, ...(scope === 'suppliers' ? { scope } : {}) })
  const rows = useMemo(() => query.data?.data ?? [], [query.data?.data])
  const total = query.data?.total ?? rows.length
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const maxSpend = Math.max(0, ...rows.map((r) => toNumber(r.spend)))
  const open = (id) => navigate(`${ROOT}/suppliers/${id}`)

  const columns = useMemo(() => [
    { id: 'name', header: 'Proveedor', cell: ({ row: { original: s } }) => (
      <button type="button" onClick={() => open(s.id)} className="flex items-center gap-2.5 text-left font-semibold hover:text-teal-700 hover:underline dark:hover:text-teal-300">
        {s.avatarUrl
          ? <img src={s.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />
          : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-500/15 text-[10px] font-semibold text-teal-700 dark:text-teal-300">{initials(s.name)}</span>}
        {s.name}
      </button>
    ) },
    { id: 'code', header: 'Código', cell: ({ row: { original: s } }) => s.profile?.supplierCode ?? 'Sin código' },
    { accessorKey: 'taxId', header: 'RFC', cell: ({ getValue }) => getValue() || 'Sin RFC' },
    { id: 'terms', header: 'Condiciones', cell: ({ row: { original: s } }) => s.profile?.paymentTerms ?? 'Sin definir' },
    { accessorKey: 'documents', header: () => <div className="text-right">Documentos</div>, cell: ({ getValue }) => <div className="text-right tabular-nums">{getValue() ?? 0}</div> },
    { accessorKey: 'spend', header: () => <div className="text-right">Compra 12 meses</div>, cell: ({ getValue }) => <div className="text-right font-medium tabular-nums">{formatMoneyCompact(getValue())}</div> },
  ], []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-dvh space-y-5 p-4 md:p-6">
      <PageHeader eyebrow="Compras" title="Proveedores" description="Tus proveedores vienen del directorio de contactos; aquí ves cuánto les compras y en qué condiciones."
        actions={<Button variant="outline" onClick={() => navigate('/app/m/runly.contacts/contacts/new')}><UserPlus className="h-4 w-4" />Nuevo contacto</Button>} />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch('')} placeholder="Nombre, RFC o código" className="min-w-48 flex-1" />
        <div className="hidden md:flex">
          <FilterBar filters={SCOPE_FILTERS} value={scopeValue} onChange={onScopeChange} />
        </div>
        <MobileFiltersSheet activeCount={scope === 'all' ? 1 : 0} onClear={() => onScopeChange({})}>
          <FilterBar filters={SCOPE_FILTERS} value={scopeValue} onChange={onScopeChange} />
        </MobileFiltersSheet>
        <ViewModeSwitch modes={['cards', 'table']} value={view} onChange={setView} />
      </div>

      {query.isError ? <ErrorState title="No se pudieron cargar los proveedores" onRetry={() => query.refetch()} /> : view === 'table' ? (
        <DataTable columns={columns} data={rows} isLoading={query.isLoading} manualPagination showToolbar={false} showPagination={false} pageSize={PAGE_SIZE}
          emptyIcon={Building2} emptyTitle="Sin proveedores" emptyDescription="Agrega contactos en el directorio para comprarles." />
      ) : query.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      ) : !rows.length ? (
        <EmptyState icon={Building2} title="Sin proveedores" description={debounced ? 'Nadie coincide con la búsqueda.' : 'Agrega contactos en el directorio para comprarles.'} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((s) => <SupplierCard key={s.id} s={s} maxSpend={maxSpend} onOpen={() => open(s.id)} />)}
        </div>
      )}

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-1 text-sm text-[hsl(var(--muted-foreground))]">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
          <span className="px-2 tabular-nums">{page} / {pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      ) : null}
    </div>
  )
}
