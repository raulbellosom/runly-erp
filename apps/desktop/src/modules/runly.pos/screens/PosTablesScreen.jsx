import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelectField, EmptyState, Label, Button, Sheet, SheetContent, SheetTitle, Dialog, DialogContent, DialogHeader, DialogTitle } from '@runly/ui'
import { toast } from 'sonner'
import { LayoutGrid, List, Maximize2, Minimize2, CalendarCheck, CalendarX, Sparkles, UtensilsCrossed, UserCheck } from 'lucide-react'
import { usePosFloors, usePosFloorDetail, useUpdateTableStatus, useUpdateTableWaiter } from '../hooks/usePosFloor'
import { useCreatePosReservation, useUpdatePosReservation, useSeatPosReservation } from '../hooks/usePosReservation'
import { ReservationFormDialog } from '../components/ReservationFormDialog'
import { usePosOutlets } from '../hooks/usePosSettings'
import { useCreatePosOrder, usePosOrders, useClaimOrder } from '../hooks/usePosOrder'
import { useIsDesktop } from '../../../hooks/useIsDesktop'
import { useAuth } from '../../../auth/AuthProvider'
import FloorOperationalStage from '../components/FloorOperationalStage'
import TableMap from '../components/TableMap'

// ─── Table action panel ───────────────────────────────────────────────────────
// Bottom sheet on mobile, centered Dialog on desktop.
// isSheet=true → stacked full-width buttons + close button at bottom (thumb-reach)
// isSheet=false → compact footer with right-aligned buttons, no redundant close

function ReservationCard({ r }) {
  const start = new Date(r.scheduledAt)
  const end   = new Date(start.getTime() + r.durationMinutes * 60000)
  const fmt   = (d) => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/30 px-4 py-3 space-y-1">
      <p className="font-semibold text-sm text-foreground">{r.guestName}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        {r.guestPhone && <span>{r.guestPhone}</span>}
        <span>{r.partySize} {r.partySize === 1 ? 'comensal' : 'comensales'}</span>
        <span>{fmt(start)} – {fmt(end)}</span>
      </div>
      {r.notes && <p className="text-xs text-muted-foreground italic">{r.notes}</p>}
    </div>
  )
}

function TableActionPanel({ actionTable, onClose, onNavigateToOrder, onMarkClean, onCancelReserve, onClaimTable, busy }) {
  const isDesktop = useIsDesktop()
  const name = actionTable?.name || 'Mesa'
  const action = actionTable?.action
  const res = actionTable?.activeReservation ?? null

  // ── Dialog (desktop) ──────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <Dialog open={!!actionTable} onOpenChange={(open) => !open && onClose()}>
        <DialogContent size="sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            {action === 'claim' && (
              <>
                <p className="text-sm text-muted-foreground">
                  {actionTable?.waiterName
                    ? `Asignada actualmente a ${actionTable.waiterName}.`
                    : 'Esta mesa no tiene mesero asignado.'}
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={onNavigateToOrder}>
                    Abrir orden
                  </Button>
                  <Button size="sm" onClick={onClaimTable} disabled={busy} className="gap-1.5">
                    <UserCheck size={14} />
                    {busy ? 'Asignando...' : 'Asignar mesa a mí'}
                  </Button>
                </div>
              </>
            )}

            {action === 'dirty' && (
              <>
                <p className="text-sm text-muted-foreground">
                  La mesa todavía no ha sido limpiada.
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={onNavigateToOrder}>
                    Abrir igual
                  </Button>
                  <Button size="sm" onClick={onMarkClean} disabled={busy}>
                    <Sparkles size={14} className="mr-1.5" />
                    {busy ? 'Actualizando...' : 'Marcar como lista'}
                  </Button>
                </div>
              </>
            )}

            {action === 'reserved' && (
              <>
                {res && <ReservationCard r={res} />}
                {!res && (
                  <p className="text-sm text-muted-foreground">Mesa reservada sin detalles adicionales.</p>
                )}
                <div className="flex justify-between items-center gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/8 gap-1.5"
                    onClick={onCancelReserve}
                    disabled={busy}
                  >
                    <CalendarX size={14} />
                    Cancelar reserva
                  </Button>
                  <Button size="sm" onClick={onNavigateToOrder} disabled={busy} className="gap-1.5">
                    <UtensilsCrossed size={14} />
                    Iniciar orden
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // ── Sheet (mobile) ────────────────────────────────────────────────────────
  return (
    <Sheet open={!!actionTable} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" aria-describedby={undefined} className="pb-8 max-h-[80dvh]">
        <SheetTitle className="text-base mb-4">{name}</SheetTitle>

        <div className="space-y-3">
          {action === 'claim' && (
            <>
              <p className="text-sm text-muted-foreground mb-2">
                {actionTable?.waiterName
                  ? `Asignada actualmente a ${actionTable.waiterName}.`
                  : 'Esta mesa no tiene mesero asignado.'}
              </p>
              <Button className="w-full h-12" onClick={onClaimTable} disabled={busy}>
                <UserCheck size={15} className="mr-2" />
                {busy ? 'Asignando...' : 'Asignar mesa a mí'}
              </Button>
              <Button variant="outline" className="w-full h-12" onClick={onNavigateToOrder}>
                Abrir orden
              </Button>
            </>
          )}

          {action === 'dirty' && (
            <>
              <p className="text-sm text-muted-foreground mb-2">La mesa todavía no ha sido limpiada.</p>
              <Button className="w-full h-12" onClick={onMarkClean} disabled={busy}>
                <Sparkles size={15} className="mr-2" />
                {busy ? 'Actualizando...' : 'Marcar como lista'}
              </Button>
              <Button variant="outline" className="w-full h-12" onClick={onNavigateToOrder}>
                <UtensilsCrossed size={15} className="mr-2" />
                Abrir de todas formas
              </Button>
            </>
          )}

          {action === 'reserved' && (
            <>
              {res && <ReservationCard r={res} />}
              <Button className="w-full h-12 mt-2" onClick={onNavigateToOrder} disabled={busy}>
                <UtensilsCrossed size={15} className="mr-2" />
                Iniciar orden
              </Button>
              <Button
                variant="outline"
                className="w-full h-12 text-destructive border-destructive/30 hover:bg-destructive/5"
                onClick={onCancelReserve}
                disabled={busy}
              >
                <CalendarX size={15} className="mr-2" />
                {busy ? 'Actualizando...' : 'Cancelar reserva'}
              </Button>
            </>
          )}

          <Button variant="ghost" className="w-full text-muted-foreground" size="sm" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function PosTablesScreen({ comanderoMode = false }) {
  const navigate = useNavigate()
  const containerRef = useRef(null)
  const { data: outlets = [] } = usePosOutlets()
  const [outletId, setOutletId] = useState('')
  const [selectedFloorId, setSelectedFloorId] = useState('')
  const [viewMode, setViewMode] = useState('canvas') // 'canvas' | 'grid'
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [reserveMode, setReserveMode] = useState(false)
  const [actionTable, setActionTable] = useState(null) // { id, name, status, action }
  const [myTablesOnly, setMyTablesOnly] = useState(false)
  const { userProfile } = useAuth()
  const updateTableWaiter = useUpdateTableWaiter()

  const updateTableStatus = useUpdateTableStatus()
  const [reserveFormTable, setReserveFormTable] = useState(null)
  const createReservation = useCreatePosReservation()
  const updateReservation = useUpdatePosReservation()
  const seatReservation = useSeatPosReservation()

  useEffect(() => {
    function onFsChange() { setIsFullscreen(Boolean(document.fullscreenElement)) }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen()
    else document.exitFullscreen()
  }, [])

  const effectiveOutletId = outletId || outlets[0]?.id || ''

  const { data: floors = [], isLoading: floorsLoading } = usePosFloors(
    effectiveOutletId ? { outletId: effectiveOutletId } : {},
  )

  const defaultFloor = floors.find((f) => f.isActive) ?? floors[0]
  const effectiveFloorId = selectedFloorId || defaultFloor?.id || ''

  const { data: floorDetail, isLoading: tablesLoading } = usePosFloorDetail(effectiveFloorId, {
    refetch: true,
    myTablesOnly,
  })

  const tables = floorDetail?.tables ?? []
  const elements = floorDetail?.elements ?? []
  const hasCanvasElements = elements.some((el) => el.kind === 'TABLE_SQUARE' || el.kind === 'TABLE_ROUND')

  const tableStates = useMemo(() => {
    const map = {}
    for (const t of tables) map[t.id] = t
    return map
  }, [tables])

  const { data: openOrders = [] } = usePosOrders({ status: 'OPEN' })
  const { data: sentOrders = [] } = usePosOrders({ status: 'SENT' })
  const { data: partialOrders = [] } = usePosOrders({ status: 'PARTIALLY_SERVED' })
  const { data: servedOrders = [] } = usePosOrders({ status: 'SERVED' })
  const activeOrders = useMemo(
    () => [...openOrders, ...sentOrders, ...partialOrders, ...servedOrders],
    [openOrders, sentOrders, partialOrders, servedOrders],
  )
  const createOrder = useCreatePosOrder()
  const claimOrder = useClaimOrder()

  function handleOutletChange(id) {
    setOutletId(id)
    setSelectedFloorId('')
  }

  function navigateToOrder(table) {
    if (comanderoMode) {
      navigate(`/app/m/runly.pos/pos/comandero/mesa/${table.id}`)
      return
    }
    const existingOrder = activeOrders.find((o) => o.tableId === table.id)
    if (existingOrder) {
      // Re-assert OCCUPIED + waiterId on the table — resuming an order used to
      // leave a table stuck on a stale AVAILABLE status if it had ever drifted.
      claimOrder.mutate(existingOrder.id)
      navigate(`/app/m/runly.pos/pos/terminal?order=${existingOrder.id}`)
      return
    }
    createOrder.mutate(
      { outletId: effectiveOutletId, tableId: table.id, fulfillmentType: 'DINE_IN' },
      { onSuccess: (res) => navigate(`/app/m/runly.pos/pos/terminal?order=${(res?.data ?? res).id}`) },
    )
  }

  function handleTableClick(table) {
    if (!table?.id) return
    // Always use the live DB status from tableStates when available
    const liveTable = tableStates[table.id] ?? table
    const status = liveTable.status ?? 'AVAILABLE'
    const name = liveTable.name || table.name || 'Mesa'

    if (status === 'DIRTY') {
      setActionTable({ id: table.id, name, status, action: 'dirty' })
      return
    }
    if (status === 'RESERVED') {
      setActionTable({ id: table.id, name, status, action: 'reserved', activeReservation: liveTable.activeReservation ?? null })
      return
    }
    if (reserveMode && status === 'AVAILABLE') {
      setReserveFormTable({ id: table.id, name, outletId: effectiveOutletId })
      return
    }
    if (liveTable.waiterId && liveTable.waiterId !== userProfile?.id) {
      setActionTable({ id: table.id, name, status, action: 'claim', waiterName: liveTable.waiterName ?? null })
      return
    }
    navigateToOrder(liveTable)
  }

  function handleMarkClean() {
    if (!actionTable) return
    updateTableStatus.mutate({ tableId: actionTable.id, status: 'AVAILABLE' }, {
      onSuccess: () => setActionTable(null),
    })
  }

  function handleClaimTable() {
    if (!actionTable || !userProfile?.id) return
    updateTableWaiter.mutate(
      { tableId: actionTable.id, waiterId: userProfile.id },
      { onSuccess: () => setActionTable(null) },
    )
  }

  function handleReservationSubmit(data) {
    createReservation.mutate(data, {
      onSuccess: () => {
        setReserveFormTable(null)
        setReserveMode(false)
      },
    })
  }

  function handleCancelReserve() {
    if (!actionTable) return
    const reservationId = actionTable.activeReservation?.id
    if (reservationId) {
      updateReservation.mutate(
        { id: reservationId, status: 'CANCELLED' },
        { onSuccess: () => setActionTable(null) }
      )
    } else {
      updateTableStatus.mutate({ tableId: actionTable.id, status: 'AVAILABLE' }, {
        onSuccess: () => setActionTable(null),
      })
    }
  }

  function handleActionNavigate() {
    const table = actionTable
    setActionTable(null)
    if (!table) return

    const reservationId = table.activeReservation?.id
    if (reservationId) {
      seatReservation.mutate(
        { id: reservationId },
        {
          onSuccess: (res) => {
            if (comanderoMode) {
              navigate(`/app/m/runly.pos/pos/comandero/mesa/${table.id}`)
              return
            }
            const orderId = (res?.data ?? res)?.id
            if (!orderId) { toast.error('No se pudo obtener la orden'); return }
            navigate(`/app/m/runly.pos/pos/terminal?order=${orderId}`)
          },
        }
      )
    } else {
      navigateToOrder(table)
    }
  }

  const isLoading = floorsLoading || tablesLoading
  const activeMode = hasCanvasElements ? viewMode : 'grid'

  return (
    <div ref={containerRef} className="flex h-full flex-col bg-background overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-3 border-b border-border shrink-0 bg-card/60 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-base leading-tight">
            Mesas{reserveMode && <span className="ml-2 text-xs font-normal text-blue-500">Modo reserva</span>}
          </h1>
          <p className="text-xs text-muted-foreground">
            {reserveMode ? 'Toca una mesa disponible para reservarla' : 'Toca una mesa para abrir o continuar una orden'}
          </p>
        </div>

        {outlets.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Sucursal</Label>
            <SelectField
              value={outletId}
              onChange={handleOutletChange}
              options={outlets.map((o) => ({ value: o.id, label: o.name }))}
              placeholder="Todas las sucursales"
            />
          </div>
        )}

        {/* View toggle */}
        {hasCanvasElements && (
          <div className="flex rounded-md border border-border overflow-hidden shrink-0">
            <Button
              variant="ghost" size="sm"
              className={`rounded-none px-2.5 ${viewMode === 'canvas' ? 'bg-muted' : ''}`}
              onClick={() => setViewMode('canvas')} title="Vista de plano"
            >
              <LayoutGrid size={15} />
            </Button>
            <Button
              variant="ghost" size="sm"
              className={`rounded-none px-2.5 border-l border-border ${viewMode === 'grid' ? 'bg-muted' : ''}`}
              onClick={() => setViewMode('grid')} title="Vista de grilla"
            >
              <List size={15} />
            </Button>
          </div>
        )}

        {/* Mis mesas toggle */}
        <Button
          variant={myTablesOnly ? 'default' : 'ghost'}
          size="sm"
          className={`shrink-0 px-2.5 gap-1.5 ${myTablesOnly ? 'bg-foreground hover:bg-foreground/90 text-background' : ''}`}
          onClick={() => setMyTablesOnly((v) => !v)}
          title="Mostrar solo mis mesas asignadas"
        >
          <UserCheck size={15} />
          <span className="hidden sm:inline text-xs">Mis mesas</span>
        </Button>

        {/* Reserve mode toggle */}
        <Button
          variant={reserveMode ? 'default' : 'ghost'}
          size="sm"
          className={`shrink-0 px-2.5 gap-1.5 ${reserveMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : ''}`}
          onClick={() => setReserveMode((v) => !v)}
          title="Modo reserva: toca una mesa disponible para reservarla"
        >
          <CalendarCheck size={15} />
          <span className="hidden sm:inline text-xs">Reservar</span>
        </Button>

        {/* Fullscreen toggle */}
        <Button
          variant="ghost" size="sm"
          className="shrink-0 px-2.5"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </Button>
      </div>

      {/* Floor tabs */}
      {floors.length > 0 && (
        <div className="flex gap-1 px-4 py-1.5 border-b border-border bg-card/40 shrink-0 overflow-x-auto">
          {floors.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSelectedFloorId(f.id)}
              className={[
                'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                effectiveFloorId === f.id
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted',
              ].join(' ')}
            >
              {f.name}
              {f.isActive && <span className="h-1.5 w-1.5 rounded-full bg-green-400 shrink-0" />}
            </button>
          ))}
        </div>
      )}

      {/* Status legend with live counts */}
      <div className="shrink-0 px-4 py-1.5 border-b border-border/60 bg-card/30 flex flex-wrap items-center gap-x-4 gap-y-1">
        {[
          { color: 'bg-green-500',  label: 'Disponible',   status: 'AVAILABLE' },
          { color: 'bg-amber-500',  label: 'Ocupada',      status: 'OCCUPIED' },
          { color: 'bg-orange-500', label: 'Cuenta',       status: 'BILL_REQUESTED' },
          { color: 'bg-slate-400',  label: 'Sucia',        status: 'DIRTY' },
          { color: 'bg-blue-500',   label: 'Reservada',    status: 'RESERVED' },
        ].map(({ color, label, status }) => {
          const count = tables.filter((t) => t.status === status).length
          return (
            <div key={label} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full shrink-0 ${color}`} />
              <span className="text-xs text-muted-foreground">
                {label}
                {count > 0 && (
                  <span className="ml-1 font-semibold tabular-nums text-foreground">{count}</span>
                )}
              </span>
            </div>
          )
        })}
        {tables.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {tables.filter((t) => t.status === 'AVAILABLE').length}
            <span className="text-muted-foreground/60">/{tables.length}</span>
            <span className="ml-1">libres</span>
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isLoading ? (
          <p className="p-4 md:p-6 text-center text-sm text-muted-foreground">Cargando mesas...</p>
        ) : floors.length === 0 ? (
          <EmptyState
            title="Sin planos"
            description="Crea un plano en el diseñador de plantas y publícalo para ver las mesas."
          />
        ) : activeMode === 'canvas' && hasCanvasElements ? (
          <FloorOperationalStage
            floor={floorDetail}
            elements={elements}
            tableStates={tableStates}
            onTableClick={handleTableClick}
          />
        ) : (
          <TableMap tables={tables} onTableClick={handleTableClick} />
        )}
      </div>

      {/* Table action panel (Sheet on mobile, Dialog on desktop) */}
      <TableActionPanel
        actionTable={actionTable}
        onClose={() => setActionTable(null)}
        onNavigateToOrder={handleActionNavigate}
        onMarkClean={handleMarkClean}
        onCancelReserve={handleCancelReserve}
        onClaimTable={handleClaimTable}
        busy={updateTableStatus.isPending || updateReservation.isPending || seatReservation.isPending || updateTableWaiter.isPending}
      />

      <ReservationFormDialog
        open={Boolean(reserveFormTable)}
        onOpenChange={(v) => !v && setReserveFormTable(null)}
        tableName={reserveFormTable?.name ?? ''}
        tableId={reserveFormTable?.id}
        outletId={reserveFormTable?.outletId ?? ''}
        onSubmit={handleReservationSubmit}
        loading={createReservation.isPending}
      />
    </div>
  )
}
