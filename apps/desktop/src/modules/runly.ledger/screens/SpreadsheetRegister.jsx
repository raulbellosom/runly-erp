// apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOfflineStatus } from '@runly/offline'
import { toast } from 'sonner'
import { Plus, Wallet, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Button, ConfirmDialog, ErrorState, SearchInput, FilterBar, DatePickerField } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useAccountTransactions, useAccountSummary, useLedgerSQLite } from '../hooks/use-ledger-queries.js'
import { useTransactionMutations } from '../hooks/useTransactionMutations.js'
import { EDITABLE_COLS, PAGE_STEP, emptyRow, buildTransactionPayload, toDateValue } from '../lib/spreadsheet-helpers.js'
import MobileTransactionList from '../components/MobileTransactionList.jsx'
import MobileTransactionSheet from '../components/MobileTransactionSheet.jsx'
import DesktopTransactionTable from '../components/DesktopTransactionTable.jsx'
import { LedgerStatStrip } from '../components/LedgerStatCard.jsx'

function fmtCurrency(amount, currency = 'MXN') {
  return Number(amount ?? 0).toLocaleString('es-MX', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  })
}

export default function SpreadsheetRegister({
  accountId,
  dateFrom,
  dateTo,
  onDateFromChange,
  onDateToChange,
  onRowCountChange,
  types = [],
  categories = [],
  canWrite = true,
  currency = 'MXN',
}) {
  const { session } = useAuth()
  const { isOnline } = useOfflineStatus()
  const { isUsingLocalLedger } = useLedgerSQLite()
  const token = session?.access_token ?? null
  const [newRow, setNewRow] = useState(null)
  const [limit, setLimit] = useState(PAGE_STEP)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [mobileSheet, setMobileSheet] = useState(null) // { mode: 'new' | 'edit', draft }
  const [search, setSearch] = useState('')
  const [filterValue, setFilterValue] = useState({ tipo: '', categoria: '' })
  const tableRef = useRef(null)
  const canEdit = isOnline && !!token && canWrite

  const queryKey = ['ledger-transactions', accountId, dateFrom ?? null, dateTo ?? null, limit, isUsingLocalLedger ? 'local' : 'remote']
  const { data, isLoading, isError, refetch } = useAccountTransactions(accountId, { dateFrom, dateTo, limit })
  // Reused by the account's "Resumen" tab too (useAccountSummary) — React Query
  // dedupes the identical queryKey, so switching tabs is a cache hit, not a
  // second network call.
  const { data: summaryData } = useAccountSummary(accountId, { dateFrom, dateTo })

  const rows = data?.data ?? []
  const total = data?.pagination?.total ?? rows.length
  const hasMore = total > rows.length

  useEffect(() => {
    onRowCountChange?.(total)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total])

  const normalizedSearch = search.trim().toLowerCase()
  const filtersActive = Boolean(normalizedSearch || filterValue.tipo || filterValue.categoria)

  function rowMatchesFilters(row) {
    if (filterValue.tipo && String(row.tipo_id ?? '') !== String(filterValue.tipo)) return false
    if (filterValue.categoria && String(row.category_id ?? '') !== String(filterValue.categoria)) return false
    if (normalizedSearch) {
      const haystack = [row.nombre, row.concepto, row.referencia, row.numero]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(normalizedSearch)) return false
    }
    return true
  }

  // Filtering hides rows via CSS (visibleRowIds), it never removes them from
  // `rows` — DesktopTransactionTable's keyboard navigation (ArrowUp/Down,
  // data-row indices) depends on `rows`' original indices staying stable.
  const visibleRowIds = useMemo(
    () => new Set(rows.filter(rowMatchesFilters).map((row) => row.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, normalizedSearch, filterValue.tipo, filterValue.categoria],
  )
  const visibleRows = useMemo(() => rows.filter((row) => visibleRowIds.has(row.id)), [rows, visibleRowIds])
  const noFilterMatches = filtersActive && rows.length > 0 && visibleRowIds.size === 0

  const kpis = summaryData?.kpis
  const statItems = kpis
    ? [
        { key: 'balance', label: 'Saldo actual', value: fmtCurrency(kpis.current_balance, currency), icon: Wallet, tone: 'brand' },
        { key: 'income', label: 'Ingresos', value: fmtCurrency(kpis.total_deposito, currency), icon: ArrowDownLeft, tone: 'success' },
        { key: 'expense', label: 'Egresos', value: fmtCurrency(kpis.total_retiro, currency), icon: ArrowUpRight, tone: 'destructive' },
      ]
    : []

  const filterBarFilters = [
    { key: 'tipo', label: 'Tipo', options: types.map((t) => ({ value: t.id, label: t.code })) },
    { key: 'categoria', label: 'Categoría', options: categories.map((c) => ({ value: c.id, label: c.name })) },
  ].filter((f) => f.options.length > 0)

  const { saveMutation, deleteMutation, getDraft, setDraft, clearDraft, saveRow } = useTransactionMutations({
    accountId,
    token,
    queryKey,
    canEdit,
    onNewRowSaved: () => setNewRow(null),
  })

  function focusCell(selector) {
    const el = tableRef.current?.querySelector(selector)
    if (!el) return
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    el.focus()
  }

  function handleKeyDown(event, row, rowIdx, colName) {
    if (event.key === 'Escape') {
      event.preventDefault()
      clearDraft(row, rowIdx)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.ctrlKey) { saveRow(row, rowIdx); return }
      const colIdx = EDITABLE_COLS.indexOf(colName)
      if (colIdx < EDITABLE_COLS.length - 1) {
        focusCell(`[data-row="${rowIdx}"][data-col="${EDITABLE_COLS[colIdx + 1]}"]`)
      } else {
        saveRow(row, rowIdx)
      }
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      const direction = event.key === 'ArrowUp' ? -1 : 1
      const nextIdx = rowIdx + direction
      if (nextIdx < 0 || nextIdx >= rows.length) return
      const colIdx = EDITABLE_COLS.indexOf(colName)
      focusCell(`[data-row="${nextIdx}"][data-col="${EDITABLE_COLS[colIdx]}"]`)
    }
  }

  function handleRowBlur(event, row, rowIdx) {
    const nextFocused = event.relatedTarget
    const rowEl = event.currentTarget
    if (rowEl.contains(nextFocused)) return
    saveRow(row, rowIdx)
  }

  // ── Mobile sheet handlers ──────────────────────────────────────────────────
  function openMobileNew() {
    setMobileSheet({ mode: 'new', draft: { ...emptyRow(accountId), numero: String(total + 1) } })
  }
  function openMobileEdit(row) {
    setMobileSheet({ mode: 'edit', draft: { ...row } })
  }
  function setSheetField(field, value) {
    setMobileSheet((s) => (s ? { ...s, draft: { ...s.draft, [field]: value } } : s))
  }
  function submitMobileSheet(e) {
    e?.preventDefault?.()
    if (!mobileSheet) return
    const payload = buildTransactionPayload(mobileSheet.draft, { onError: (msg) => toast.error(msg) })
    if (!payload) return
    saveMutation.mutate({ isNew: mobileSheet.mode === 'new', id: mobileSheet.draft.id, payload })
    setMobileSheet(null)
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
          <div className="h-3.5 w-24 rounded bg-[hsl(var(--muted))] animate-pulse" />
          <div className="h-7 w-20 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
        </div>
        <div className="flex-1 overflow-hidden p-3 space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="h-9 rounded bg-[hsl(var(--muted)/0.4)] animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-4">
        <ErrorState description="No se pudieron cargar los movimientos." onRetry={refetch} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {statItems.length > 0 && (
        <div className="px-3 pt-3">
          <LedgerStatStrip items={statItems} />
        </div>
      )}

      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))] gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0 whitespace-nowrap">
            {rows.length === total
              ? `${total} movimiento${total !== 1 ? 's' : ''}`
              : `${rows.length} de ${total}`}
          </span>
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, concepto, referencia..."
            className="flex-1 max-w-md"
          />
          {(onDateFromChange || onDateToChange) && (
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <DatePickerField
                compact
                placeholder="Desde"
                aria-label="Filtrar desde"
                value={dateFrom || undefined}
                onChange={(val) => onDateFromChange?.(val ?? "")}
              />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
              <DatePickerField
                compact
                placeholder="Hasta"
                aria-label="Filtrar hasta"
                value={dateTo || undefined}
                onChange={(val) => onDateToChange?.(val ?? "")}
              />
              {(dateFrom || dateTo) && (
                <button
                  type="button"
                  onClick={() => {
                    onDateFromChange?.("")
                    onDateToChange?.("")
                  }}
                  className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
                  title="Limpiar filtro"
                >
                  ×
                </button>
              )}
            </div>
          )}
        </div>
        <>
          {/* Desktop: inline new row. Mobile: sheet form. */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex shrink-0"
            onClick={() => setNewRow({ ...emptyRow(accountId), numero: String(total + 1) })}
            disabled={!!newRow || !canEdit}
          >
            <Plus size={13} className="mr-1" />
            Agregar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="sm:hidden shrink-0"
            onClick={openMobileNew}
            disabled={!canEdit}
          >
            <Plus size={13} className="mr-1" />
            Agregar
          </Button>
        </>
      </div>

      {/* Date filters — mobile only, own row below search/toolbar */}
      {(onDateFromChange || onDateToChange) && (
        <div className="sm:hidden flex items-center gap-2 px-3 py-2 border-b border-[hsl(var(--border))]">
          <DatePickerField
            compact
            placeholder="Desde"
            aria-label="Filtrar desde"
            value={dateFrom || undefined}
            onChange={(val) => onDateFromChange?.(val ?? "")}
          />
          <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
          <DatePickerField
            compact
            placeholder="Hasta"
            aria-label="Filtrar hasta"
            value={dateTo || undefined}
            onChange={(val) => onDateToChange?.(val ?? "")}
          />
          {(dateFrom || dateTo) && (
            <button
              type="button"
              onClick={() => {
                onDateFromChange?.("")
                onDateToChange?.("")
              }}
              className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
              title="Limpiar filtro"
            >
              ×
            </button>
          )}
        </div>
      )}

      {filterBarFilters.length > 0 && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[hsl(var(--border))] flex-wrap">
          <FilterBar filters={filterBarFilters} value={filterValue} onChange={setFilterValue} />
          {noFilterMatches && (
            <span className="text-xs text-[hsl(var(--muted-foreground))]">
              Sin movimientos que coincidan con los filtros.
            </span>
          )}
        </div>
      )}

      {!canEdit && (
        <div className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.2)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          {!isOnline
            ? 'Viendo movimientos en modo solo lectura offline. Para agregar, editar o eliminar reconecta la app.'
            : 'Tienes acceso de solo lectura a esta cuenta. Pide al propietario permisos de edicion para registrar movimientos.'}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {hasMore && (
          <div className="flex justify-center py-2 border-b border-[hsl(var(--border)/0.6)]">
            <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE_STEP)}>
              Cargar movimientos anteriores
            </Button>
          </div>
        )}

        <MobileTransactionList
          rows={visibleRows}
          canEdit={canEdit}
          onEdit={openMobileEdit}
          onDelete={setDeleteTarget}
        />

        <DesktopTransactionTable
          tableRef={tableRef}
          rows={rows}
          visibleRowIds={visibleRowIds}
          types={types}
          categories={categories}
          canEdit={canEdit}
          getDraft={getDraft}
          setDraft={setDraft}
          handleKeyDown={handleKeyDown}
          handleRowBlur={handleRowBlur}
          saveRow={saveRow}
          newRow={newRow}
          setNewRow={setNewRow}
          onDelete={setDeleteTarget}
        />
      </div>

      <MobileTransactionSheet
        mobileSheet={mobileSheet}
        onOpenChange={(open) => { if (!open) setMobileSheet(null) }}
        onFieldChange={setSheetField}
        onSubmit={submitMobileSheet}
        types={types}
        categories={categories}
        isSaving={saveMutation.isPending}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Eliminar movimiento"
        description={
          deleteTarget
            ? `¿Eliminar el movimiento "${deleteTarget.nombre ?? ''}" del ${toDateValue(deleteTarget.fecha)}? El saldo se recalculara.`
            : ''
        }
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          setDeleteTarget(null)
        }}
      />
    </div>
  )
}
