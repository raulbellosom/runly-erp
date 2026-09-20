import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  SectionCard,
  SelectField,
  Skeleton,
  TextField,
  TextareaField,
} from '@runly/ui'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, History, Pencil, Printer, X } from 'lucide-react'
import { cancelTicket, getTicket, listWeighings, printTicket, updateTicket } from '../lib/dispatch-api.js'
import { PAYMENT_METHODS, TICKET_EVENT_LABEL, TICKET_STATUS_LABEL, TICKET_STATUS_VARIANT, VOUCHER_LABEL } from '../lib/catalog-config.js'

const READING_LABEL = { TARE: 'Tara', GROSS: 'Bruto', AUXILIARY_EXIT_GROSS: 'Bruto auxiliar de salida' }
const EDITABLE_STATUSES = new Set(['CREATED', 'READY_FOR_EXIT', 'CORRECTION_REQUIRED'])

function effectiveReadings(weighings = []) {
  const supersededIds = new Set(weighings.filter((w) => w.supersedes_id).map((w) => w.supersedes_id))
  const byType = {}
  for (const w of weighings) {
    if (supersededIds.has(w.id)) continue
    byType[w.reading_type] = w
  }
  return byType
}

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground">{value ?? '—'}</p>
    </div>
  )
}

function editFormFromTicket(ticket) {
  return {
    customer_name: ticket?.customer_name ?? '',
    buyer_email: ticket?.buyer_email ?? '',
    external_voucher_reference: ticket?.external_voucher_reference ?? '',
    vehicle_plate: ticket?.vehicle_plate ?? '',
    driver_name: ticket?.driver_name ?? '',
    payment_method: ticket?.payment_method ?? '',
    payment_reference: ticket?.payment_reference ?? '',
  }
}

export default function TicketDetailPage({ token }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState(editFormFromTicket(null))
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')

  const query = useQuery({
    queryKey: ['custom.dispatch', 'ticket', id],
    queryFn: () => getTicket({ token, id }),
    enabled: Boolean(token && id),
  })

  useEffect(() => {
    if (query.data) setEditForm(editFormFromTicket(query.data))
  }, [query.data])

  const weighingsQuery = useQuery({
    queryKey: ['custom.dispatch', 'weighings', id],
    queryFn: () => listWeighings({ token, ticketId: id }),
    enabled: Boolean(token && id && query.data?.voucher_type === 'SCALE'),
  })

  const readings = effectiveReadings(weighingsQuery.data ?? [])

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['custom.dispatch', 'ticket', id] })
    queryClient.invalidateQueries({ queryKey: ['custom.dispatch', 'tickets'] })
  }

  const updateMutation = useMutation({
    mutationFn: (data) => updateTicket({ token, id, data }),
    onSuccess: () => { toast.success('Vale actualizado.'); setEditOpen(false); invalidate() },
    onError: (error) => toast.error(error.message || 'No fue posible actualizar el vale.'),
  })

  const cancelMutation = useMutation({
    mutationFn: (reason) => cancelTicket({ token, id, reason }),
    onSuccess: () => { toast.success('Vale cancelado.'); setCancelOpen(false); setCancelReason(''); invalidate() },
    onError: (error) => toast.error(error.message || 'No fue posible cancelar el vale.'),
  })

  const printMutation = useMutation({
    mutationFn: () => printTicket({ token, id }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
      toast.success('Vale impreso. El código QR anterior ya no es válido.')
      invalidate()
    },
    onError: (error) => toast.error(error.message || 'No fue posible generar el PDF del vale.'),
  })

  function submitEdit(event) {
    event.preventDefault()
    const payload = Object.fromEntries(
      Object.entries(editForm).map(([key, value]) => [key, value === '' ? null : value]),
    )
    updateMutation.mutate(payload)
  }

  const isEditable = query.data && EDITABLE_STATUSES.has(query.data.status)

  return (
    <div className="min-h-full p-4 md:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-screen-xl space-y-6">
        <PageHeader
          eyebrow="Despachos y báscula"
          title={query.data ? query.data.folio : 'Detalle de vale'}
          description={query.data ? `${VOUCHER_LABEL[query.data.voucher_type]} · ${query.data.site_name}` : undefined}
          actions={query.data && (
            <div className="flex flex-wrap gap-2">
              {query.data.voucher_type === 'SCALE' && query.data.status === 'CREATED' && (
                <Button onClick={() => navigate(`/app/m/custom.dispatch/pesajes?ticket=${id}`)}>
                  Capturar pesaje
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )}
              {isEditable && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => printMutation.mutate()}
                    loading={printMutation.isPending}
                    disabled={printMutation.isPending}
                  >
                    <Printer className="mr-2 h-4 w-4" />
                    Imprimir vale
                  </Button>
                  <Button variant="outline" onClick={() => setEditOpen(true)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar
                  </Button>
                  <Button variant="outline" onClick={() => setCancelOpen(true)}>
                    <X className="mr-2 h-4 w-4" />
                    Cancelar vale
                  </Button>
                </>
              )}
            </div>
          )}
        />

        {query.isLoading && <Skeleton className="h-96 w-full rounded-2xl" />}
        {query.isError && (
          <ErrorState title="No se pudo cargar el vale" description={query.error?.message} onRetry={query.refetch} />
        )}

        {query.data && (
          <div className="grid gap-6 xl:grid-cols-3">
            <div className="space-y-6 xl:col-span-2">
              <Card variant="bordered">
                <CardHeader className="flex-row items-center justify-between gap-3">
                  <CardTitle>Datos del vale</CardTitle>
                  <Badge variant={TICKET_STATUS_VARIANT[query.data.status] ?? 'secondary'}>
                    {TICKET_STATUS_LABEL[query.data.status] ?? query.data.status}
                  </Badge>
                </CardHeader>
                <CardContent className="grid gap-4 sm:grid-cols-2">
                  <Field label="Sitio" value={query.data.site_name} />
                  <Field label="Estación de origen" value={query.data.origin_station_name} />
                  <Field label="Material" value={query.data.material_name} />
                  <Field label="Placa" value={query.data.vehicle_plate} />
                  <Field label="Chofer" value={query.data.driver_name} />
                  <Field label="Cliente" value={query.data.customer_name} />
                  <Field label="Referencia de vale externo" value={query.data.external_voucher_reference} />
                  {query.data.voucher_type === 'VOLUME' && (
                    <Field label="Volumen vendido" value={query.data.sold_volume_m3 ? `${query.data.sold_volume_m3} m³` : null} />
                  )}
                  <Field label="Método de pago" value={query.data.payment_method} />
                  <Field label="Referencia de pago" value={query.data.payment_reference} />
                  {query.data.status === 'CANCELLED' && (
                    <Field label="Motivo de cancelación" value={query.data.cancel_reason} />
                  )}
                </CardContent>
              </Card>

              {query.data.voucher_type === 'SCALE' && (
                <Card variant="bordered">
                  <CardHeader>
                    <CardTitle className="text-base">Pesajes</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 sm:grid-cols-3">
                    {['TARE', 'GROSS'].map((type) => (
                      <div key={type} className="rounded-xl border border-border px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{READING_LABEL[type]}</p>
                        <p className="text-lg font-semibold tabular-nums">
                          {readings[type] ? `${Number(readings[type].weight_kg).toLocaleString('es-MX')} kg` : '—'}
                        </p>
                      </div>
                    ))}
                    <div className="rounded-xl border border-border px-4 py-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Neto</p>
                      <p className="text-lg font-semibold tabular-nums">
                        {readings.TARE && readings.GROSS
                          ? `${(Number(readings.GROSS.weight_kg) - Number(readings.TARE.weight_kg)).toLocaleString('es-MX')} kg`
                          : '—'}
                      </p>
                    </div>
                    {query.data.weighing_exception && (
                      <p className="sm:col-span-3 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">
                        Excepción de pesaje autorizada: {query.data.weighing_exception_reason}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}

              <SectionCard title="Historial" description="Eventos registrados para este vale.">
                {query.data.events?.length ? (
                  <div className="space-y-4">
                    {query.data.events.map((event) => (
                      <div key={event.id} className="flex items-start gap-3">
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                          <History className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {TICKET_EVENT_LABEL[event.event_type] ?? event.event_type}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(event.occurred_at).toLocaleString('es-MX')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Sin eventos" description="Este vale todavía no tiene eventos registrados." />
                )}
              </SectionCard>
            </div>

            <Card variant="bordered">
              <CardHeader>
                <CardTitle className="text-base">Código QR</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="break-all rounded-xl bg-muted/60 px-4 py-3 font-mono text-xs text-muted-foreground">
                  RUNLY-DISPATCH:1:••••••••••••
                </p>
                <p className="text-xs text-muted-foreground">
                  El vale no guarda el código QR en texto plano, solo su huella digital. Usa "Imprimir vale" para
                  generar el PDF con el QR vigente — cada impresión emite un código nuevo e invalida el anterior.
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Corregir vale {query.data?.folio}</DialogTitle>
              <DialogDescription>Solo se pueden corregir datos administrativos, no el material ni la cantidad.</DialogDescription>
            </DialogHeader>
            <form onSubmit={submitEdit} className="space-y-4 py-1">
              <TextField label="Placa" value={editForm.vehicle_plate} onChange={(e) => setEditForm((f) => ({ ...f, vehicle_plate: e.target.value }))} required />
              <TextField label="Cliente" value={editForm.customer_name} onChange={(e) => setEditForm((f) => ({ ...f, customer_name: e.target.value }))} />
              <TextField label="Chofer" value={editForm.driver_name} onChange={(e) => setEditForm((f) => ({ ...f, driver_name: e.target.value }))} />
              <TextField label="Correo del comprador" value={editForm.buyer_email} onChange={(e) => setEditForm((f) => ({ ...f, buyer_email: e.target.value }))} />
              <TextField label="Referencia de vale externo" value={editForm.external_voucher_reference} onChange={(e) => setEditForm((f) => ({ ...f, external_voucher_reference: e.target.value }))} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField label="Método de pago" value={editForm.payment_method} onChange={(v) => setEditForm((f) => ({ ...f, payment_method: v }))} options={PAYMENT_METHODS} placeholder="Sin especificar" />
                <TextField label="Referencia de pago" value={editForm.payment_reference} onChange={(e) => setEditForm((f) => ({ ...f, payment_reference: e.target.value }))} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancelar</Button>
                <Button type="submit" loading={updateMutation.isPending} disabled={updateMutation.isPending}>Guardar</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancelar vale {query.data?.folio}</DialogTitle>
              <DialogDescription>Esta acción es definitiva. El vale ya no podrá usarse para salir.</DialogDescription>
            </DialogHeader>
            <TextareaField label="Motivo de la cancelación" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={3} required />
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>Volver</Button>
              <Button
                variant="destructive"
                onClick={() => cancelMutation.mutate(cancelReason.trim())}
                loading={cancelMutation.isPending}
                disabled={!cancelReason.trim() || cancelMutation.isPending}
              >
                Cancelar vale
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
