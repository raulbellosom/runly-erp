import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ComboboxField,
  EmptyState,
  ErrorState,
  NumberField,
  PageHeader,
  SearchInput,
  Skeleton,
  TextareaField,
} from '@runly/ui'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { CheckCircle2, Scale } from 'lucide-react'
import {
  authorizeWeighingException,
  captureAuxiliaryExit,
  captureGross,
  captureTare,
  correctWeighing,
  getDispatchSetup,
  getTicket,
  listTickets,
  listWeighings,
} from '../lib/dispatch-api.js'
import { TICKET_STATUS_LABEL, TICKET_STATUS_VARIANT, VOUCHER_LABEL } from '../lib/catalog-config.js'

const READING_LABEL = { TARE: 'Tara', GROSS: 'Bruto', AUXILIARY_EXIT_GROSS: 'Bruto auxiliar de salida' }

function effectiveReadings(weighings = []) {
  const supersededIds = new Set(weighings.filter((w) => w.supersedes_id).map((w) => w.supersedes_id))
  const byType = {}
  for (const w of weighings) {
    if (supersededIds.has(w.id)) continue
    byType[w.reading_type] = w
  }
  return byType
}

function TicketPicker({ token, onSelect }) {
  const [query, setQuery] = useState('')
  const search = useQuery({
    queryKey: ['custom.dispatch', 'tickets', 'weighing-search', query],
    queryFn: () => listTickets({ token, filters: { q: query } }),
    enabled: Boolean(token) && query.trim().length > 0,
  })

  return (
    <Card variant="bordered">
      <CardHeader>
        <CardTitle>Buscar vale</CardTitle>
        <CardDescription>Busca por folio o placa para capturar tara, bruto o una excepción.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Folio o placa..." />
        {query.trim() && search.isLoading && <Skeleton className="h-24 w-full rounded-xl" />}
        {query.trim() && search.data && search.data.length === 0 && (
          <EmptyState title="Sin resultados" description="No hay vales que coincidan con la búsqueda." />
        )}
        {search.data?.length > 0 && (
          <div className="divide-y divide-border rounded-xl border border-border">
            {search.data.map((ticket) => (
              <button
                key={ticket.id}
                type="button"
                onClick={() => onSelect(ticket.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50"
              >
                <div>
                  <p className="text-sm font-medium text-foreground">{ticket.folio}</p>
                  <p className="text-xs text-muted-foreground">{ticket.vehicle_plate} · {VOUCHER_LABEL[ticket.voucher_type]}</p>
                </div>
                <Badge variant={TICKET_STATUS_VARIANT[ticket.status] ?? 'secondary'}>
                  {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ReadingRow({ type, reading, onCorrect, canOverride }) {
  const [correcting, setCorrecting] = useState(false)
  const [weight, setWeight] = useState('')
  const [reason, setReason] = useState('')

  if (!reading) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3">
        <span className="text-sm text-muted-foreground">{READING_LABEL[type]}</span>
        <span className="text-sm text-muted-foreground">Sin registrar</span>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">{READING_LABEL[type]}</p>
          <p className="text-lg font-semibold tabular-nums">{Number(reading.weight_kg).toLocaleString('es-MX')} kg</p>
        </div>
        {canOverride && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setCorrecting((v) => !v)}>
            Corregir
          </Button>
        )}
      </div>
      {correcting && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <NumberField label="Peso corregido" suffix="kg" value={weight} onChange={(e) => setWeight(e.target.value)} min="0.01" step="0.01" />
          <TextareaField label="Motivo de la corrección" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required />
          <Button
            size="sm"
            onClick={() => {
              if (!weight || !reason.trim()) return
              onCorrect(reading.id, { weight_kg: Number(weight), correction_reason: reason.trim() })
              setCorrecting(false)
              setWeight('')
              setReason('')
            }}
          >
            Guardar corrección
          </Button>
        </div>
      )}
    </div>
  )
}

export default function WeighingCapturePage({ token }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState(searchParams.get('ticket') ?? null)
  const [tareInput, setTareInput] = useState('')
  const [grossInput, setGrossInput] = useState('')
  const [auxInput, setAuxInput] = useState('')
  const [auxStationId, setAuxStationId] = useState('')
  const [exceptionReason, setExceptionReason] = useState('')

  const ticketQuery = useQuery({
    queryKey: ['custom.dispatch', 'ticket', selectedId],
    queryFn: () => getTicket({ token, id: selectedId }),
    enabled: Boolean(token && selectedId),
  })

  const weighingsQuery = useQuery({
    queryKey: ['custom.dispatch', 'weighings', selectedId],
    queryFn: () => listWeighings({ token, ticketId: selectedId }),
    enabled: Boolean(token && selectedId),
  })

  const setupQuery = useQuery({
    queryKey: ['custom.dispatch', 'setup'],
    queryFn: () => getDispatchSetup(token),
    enabled: Boolean(token),
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['custom.dispatch', 'ticket', selectedId] })
    queryClient.invalidateQueries({ queryKey: ['custom.dispatch', 'weighings', selectedId] })
  }

  const tareMutation = useMutation({
    mutationFn: () => captureTare({ token, ticketId: selectedId, data: { station_id: ticketQuery.data.origin_station_id, weight_kg: Number(tareInput) } }),
    onSuccess: () => { toast.success('Tara registrada.'); setTareInput(''); invalidate() },
    onError: (error) => toast.error(error.message || 'No fue posible registrar la tara.'),
  })

  const grossMutation = useMutation({
    mutationFn: () => captureGross({ token, ticketId: selectedId, data: { station_id: ticketQuery.data.origin_station_id, weight_kg: Number(grossInput) } }),
    onSuccess: () => { toast.success('Bruto registrado. El vale está listo para salida.'); setGrossInput(''); invalidate() },
    onError: (error) => toast.error(error.message || 'No fue posible registrar el peso bruto.'),
  })

  const auxMutation = useMutation({
    mutationFn: () => captureAuxiliaryExit({ token, ticketId: selectedId, data: { station_id: auxStationId, weight_kg: Number(auxInput) } }),
    onSuccess: () => { toast.success('Peso auxiliar registrado.'); setAuxInput(''); invalidate() },
    onError: (error) => toast.error(error.message || 'No fue posible registrar el peso auxiliar.'),
  })

  const exceptionMutation = useMutation({
    mutationFn: () => authorizeWeighingException({ token, ticketId: selectedId, reason: exceptionReason }),
    onSuccess: () => { toast.success('Excepción autorizada. El vale está listo para salida.'); setExceptionReason(''); invalidate() },
    onError: (error) => toast.error(error.message || 'No fue posible autorizar la excepción.'),
  })

  const correctMutation = useMutation({
    mutationFn: ({ weighingId, data }) => correctWeighing({ token, weighingId, data }),
    onSuccess: () => { toast.success('Corrección registrada.'); invalidate() },
    onError: (error) => toast.error(error.message || 'No fue posible corregir el pesaje.'),
  })

  const readings = useMemo(() => effectiveReadings(weighingsQuery.data ?? []), [weighingsQuery.data])
  const scaleStations = useMemo(
    () => (setupQuery.data?.stations ?? [])
      .filter((s) => s.enabled && s.station_type === 'SCALE' && s.site_id === ticketQuery.data?.site_id)
      .map((s) => ({ value: s.id, label: s.name })),
    [setupQuery.data, ticketQuery.data],
  )

  if (!selectedId) {
    return (
      <div className="min-h-full p-4 md:p-6 xl:p-8">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <PageHeader eyebrow="Báscula" title="Captura de pesajes" description="Busca un vale para capturar tara, bruto o una excepción." />
          <TicketPicker token={token} onSelect={setSelectedId} />
        </div>
      </div>
    )
  }

  const ticket = ticketQuery.data

  return (
    <div className="min-h-full p-4 md:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader
          eyebrow="Báscula"
          title={ticket ? `Pesaje · ${ticket.folio}` : 'Captura de pesajes'}
          description={ticket ? `${ticket.vehicle_plate} · ${VOUCHER_LABEL[ticket.voucher_type]}` : undefined}
          actions={<Button variant="outline" onClick={() => setSelectedId(null)}>Cambiar vale</Button>}
        />

        {(ticketQuery.isLoading || weighingsQuery.isLoading) && <Skeleton className="h-96 w-full rounded-2xl" />}
        {ticketQuery.isError && (
          <ErrorState title="No se pudo cargar el vale" description={ticketQuery.error?.message} onRetry={ticketQuery.refetch} />
        )}

        {ticket && ticket.voucher_type === 'SCALE' && (
          <>
            <Card variant="bordered">
              <CardHeader className="flex-row items-center justify-between gap-3">
                <CardTitle>Lecturas de báscula</CardTitle>
                <Badge variant={TICKET_STATUS_VARIANT[ticket.status] ?? 'secondary'}>
                  {TICKET_STATUS_LABEL[ticket.status] ?? ticket.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <ReadingRow type="TARE" reading={readings.TARE} canOverride onCorrect={(id, data) => correctMutation.mutate({ weighingId: id, data })} />
                <ReadingRow type="GROSS" reading={readings.GROSS} canOverride onCorrect={(id, data) => correctMutation.mutate({ weighingId: id, data })} />
                {readings.TARE && readings.GROSS && (
                  <div className="flex items-center gap-2 rounded-xl bg-success/10 px-4 py-3 text-sm font-medium text-success">
                    <CheckCircle2 className="h-4 w-4" />
                    Neto: {(Number(readings.GROSS.weight_kg) - Number(readings.TARE.weight_kg)).toLocaleString('es-MX')} kg
                  </div>
                )}
              </CardContent>
            </Card>

            {ticket.status === 'CREATED' && !readings.TARE && (
              <Card variant="bordered">
                <CardHeader><CardTitle className="text-base">Capturar tara</CardTitle></CardHeader>
                <CardContent className="flex items-end gap-3">
                  <NumberField label="Peso" suffix="kg" value={tareInput} onChange={(e) => setTareInput(e.target.value)} min="0.01" step="0.01" className="flex-1" />
                  <Button onClick={() => tareMutation.mutate()} loading={tareMutation.isPending} disabled={!tareInput}>
                    Guardar tara
                  </Button>
                </CardContent>
              </Card>
            )}

            {ticket.status === 'CREATED' && readings.TARE && !readings.GROSS && (
              <Card variant="bordered">
                <CardHeader><CardTitle className="text-base">Capturar bruto</CardTitle></CardHeader>
                <CardContent className="flex items-end gap-3">
                  <NumberField label="Peso" suffix="kg" value={grossInput} onChange={(e) => setGrossInput(e.target.value)} min="0.01" step="0.01" className="flex-1" />
                  <Button onClick={() => grossMutation.mutate()} loading={grossMutation.isPending} disabled={!grossInput}>
                    Guardar bruto
                  </Button>
                </CardContent>
              </Card>
            )}

            {ticket.status === 'CREATED' && !ticket.weighing_exception && (
              <Card variant="bordered">
                <CardHeader>
                  <CardTitle className="text-base">Excepción de pesaje</CardTitle>
                  <CardDescription>Usa esta opción solo cuando la lectura normal no está disponible.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <TextareaField label="Motivo" value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} rows={2} />
                  <Button
                    variant="outline"
                    onClick={() => exceptionMutation.mutate()}
                    loading={exceptionMutation.isPending}
                    disabled={!exceptionReason.trim()}
                  >
                    Autorizar excepción
                  </Button>
                </CardContent>
              </Card>
            )}

            {ticket.status !== 'CREATED' && (
              <EmptyState
                icon={Scale}
                title="El vale ya no admite captura normal"
                description="Usa la corrección de cada lectura si necesitas ajustar un valor ya registrado."
              />
            )}
          </>
        )}

        {ticket && ticket.voucher_type === 'VOLUME' && (
          <Card variant="bordered">
            <CardHeader><CardTitle className="text-base">Peso bruto auxiliar de salida</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Informativo. No sustituye el volumen vendido registrado en el vale.
              </p>
              <ReadingRow type="AUXILIARY_EXIT_GROSS" reading={readings.AUXILIARY_EXIT_GROSS} canOverride onCorrect={(id, data) => correctMutation.mutate({ weighingId: id, data })} />
              {!readings.AUXILIARY_EXIT_GROSS && (
                <div className="flex items-end gap-3">
                  <ComboboxField
                    label="Estación de báscula"
                    value={auxStationId}
                    onChange={setAuxStationId}
                    options={scaleStations}
                    placeholder="Buscar estación..."
                    searchPlaceholder="Buscar..."
                    className="flex-1"
                  />
                  <NumberField label="Peso" suffix="kg" value={auxInput} onChange={(e) => setAuxInput(e.target.value)} min="0.01" step="0.01" className="flex-1" />
                  <Button onClick={() => auxMutation.mutate()} loading={auxMutation.isPending} disabled={!auxInput || !auxStationId}>
                    Guardar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
