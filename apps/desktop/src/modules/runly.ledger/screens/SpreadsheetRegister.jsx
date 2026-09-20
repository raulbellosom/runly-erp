// apps/desktop/src/modules/runly.ledger/screens/SpreadsheetRegister.jsx
import { useRef, useState } from 'react'
import { useOfflineStatus } from '@runly/offline'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { Button, ConfirmDialog, ErrorState } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useAccountTransactions, useLedgerSQLite } from '../hooks/use-ledger-queries.js'
import { useTransactionMutations } from '../hooks/useTransactionMutations.js'
import { EDITABLE_COLS, PAGE_STEP, emptyRow, buildTransactionPayload, toDateValue } from '../lib/spreadsheet-helpers.js'
import MobileTransactionList from '../components/MobileTransactionList.jsx'
import MobileTransactionSheet from '../components/MobileTransactionSheet.jsx'
import DesktopTransactionTable from '../components/DesktopTransactionTable.jsx'

export default function SpreadsheetRegister({ accountId, dateFrom, dateTo, types = [], categories = [], canWrite = true }) {
  const { session } = useAuth()
  const { isOnline } = useOfflineStatus()
  const { isUsingLocalLedger } = useLedgerSQLite()
  const token = session?.access_token ?? null
  const [newRow, setNewRow] = useState(null)
  const [limit, setLimit] = useState(PAGE_STEP)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [mobileSheet, setMobileSheet] = useState(null) // { mode: 'new' | 'edit', draft }
  const tableRef = useRef(null)
  const canEdit = isOnline && !!token && canWrite

  const queryKey = ['ledger-transactions', accountId, dateFrom ?? null, dateTo ?? null, limit, isUsingLocalLedger ? 'local' : 'remote']
  const { data, isLoading, isError, refetch } = useAccountTransactions(accountId, { dateFrom, dateTo, limit })

  const rows = data?.data ?? []
  const total = data?.pagination?.total ?? rows.length
  const hasMore = total > rows.length

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
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(var(--border))]">
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
          {rows.length === total
            ? `${total} movimiento${total !== 1 ? 's' : ''}`
            : `${rows.length} de ${total}`}
        </span>
        <>
          {/* Desktop: inline new row. Mobile: sheet form. */}
          <Button
            variant="ghost"
            size="sm"
            className="hidden sm:inline-flex"
            onClick={() => setNewRow({ ...emptyRow(accountId), numero: String(total + 1) })}
            disabled={!!newRow || !canEdit}
          >
            <Plus size={13} className="mr-1" />
            Agregar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="sm:hidden"
            onClick={openMobileNew}
            disabled={!canEdit}
          >
            <Plus size={13} className="mr-1" />
            Agregar
          </Button>
        </>
      </div>

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
          rows={rows}
          canEdit={canEdit}
          onEdit={openMobileEdit}
          onDelete={setDeleteTarget}
        />

        <DesktopTransactionTable
          tableRef={tableRef}
          rows={rows}
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
