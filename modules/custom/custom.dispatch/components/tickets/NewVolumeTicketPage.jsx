import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ComboboxField,
  ErrorState,
  NumberField,
  PageHeader,
  SelectField,
  Skeleton,
  TextField,
} from '@runly/ui'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, Printer, ReceiptText } from 'lucide-react'
import { createVolumeTicket, getDispatchSetup, printTicket } from '../lib/dispatch-api.js'
import { PAYMENT_METHODS } from '../lib/catalog-config.js'

const QUERY_KEY = ['custom.dispatch', 'setup']

function initialForm() {
  return {
    site_id: '',
    origin_station_id: '',
    material_profile_id: '',
    sold_to_type: 'WALK_IN',
    customer_name: '',
    vehicle_plate: '',
    driver_name: '',
    sold_volume_m3: '',
    payment_method: '',
    payment_reference: '',
  }
}

export default function NewVolumeTicketPage({ token }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [created, setCreated] = useState(null)

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getDispatchSetup(token),
    enabled: Boolean(token),
  })

  const mutation = useMutation({
    mutationFn: (payload) => createVolumeTicket({ token, data: payload }),
    onSuccess: (ticket) => {
      toast.success(`Vale ${ticket.folio} creado.`)
      setCreated(ticket)
    },
    onError: (error) => toast.error(error.message || 'No fue posible crear el vale.'),
  })

  const printMutation = useMutation({
    mutationFn: (ticketId) => printTicket({ token, id: ticketId }),
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    },
    onError: (error) => toast.error(error.message || 'No fue posible generar el PDF del vale.'),
  })

  const sites = useMemo(
    () => (query.data?.sites ?? []).filter((s) => s.enabled).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` })),
    [query.data],
  )
  const stations = useMemo(
    () => (query.data?.stations ?? [])
      .filter((s) => s.enabled && s.station_type === 'SALES' && s.site_id === form.site_id)
      .map((s) => ({ value: s.id, label: s.name })),
    [query.data, form.site_id],
  )
  const materials = useMemo(
    () => (query.data?.materials ?? [])
      .filter((m) => m.enabled && m.site_id === form.site_id && m.allowed_modes?.includes('M3'))
      .map((m) => ({ value: m.id, label: `${m.code} · ${m.name}` })),
    [query.data, form.site_id],
  )

  function setValue(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function setSite(value) {
    setForm((current) => ({ ...current, site_id: value, origin_station_id: '', material_profile_id: '' }))
  }

  function submit(event) {
    event.preventDefault()
    mutation.mutate({
      site_id: form.site_id,
      origin_station_id: form.origin_station_id,
      material_profile_id: form.material_profile_id,
      sold_to_type: form.sold_to_type,
      customer_name: form.customer_name.trim() || null,
      vehicle_plate: form.vehicle_plate,
      driver_name: form.driver_name.trim() || null,
      sold_volume_m3: Number(form.sold_volume_m3),
      payment_method: form.payment_method || null,
      payment_reference: form.payment_reference.trim() || null,
    })
  }

  if (created) {
    return (
      <div className="min-h-full p-4 md:p-6 xl:p-8">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <PageHeader eyebrow="Vale por volumen" title="Vale creado" description="Comparte el folio y el código QR con el chofer." />
          <Card variant="bordered">
            <CardHeader className="items-center text-center">
              <ReceiptText className="h-8 w-8 text-primary" />
              <CardTitle className="text-2xl tracking-tight">{created.folio}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Imprime las 3 copias del vale para entregarlas al chofer.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button onClick={() => printMutation.mutate(created.id)} loading={printMutation.isPending} disabled={printMutation.isPending}>
                  <Printer className="mr-2 h-4 w-4" />
                  Imprimir vale
                </Button>
                <Button variant="outline" onClick={() => navigate(`/app/m/custom.dispatch/vales/${created.id}`)}>
                  Ver vale
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => { setCreated(null); setForm(initialForm()) }}>
                  Crear otro vale
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-full p-4 md:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <PageHeader eyebrow="Ventanilla" title="Nuevo vale por volumen" description="Venta de material sin contrato, medida en metros cúbicos." />

        {query.isLoading && <Skeleton className="h-96 w-full rounded-2xl" />}
        {query.isError && (
          <ErrorState title="No se pudo cargar el catálogo" description={query.error?.message} onRetry={query.refetch} />
        )}

        {query.data && (
          <Card variant="bordered">
            <CardContent className="p-5 sm:p-6">
              <form onSubmit={submit} className="space-y-4">
                <ComboboxField label="Sitio" value={form.site_id} onChange={setSite} options={sites} placeholder="Buscar sitio..." searchPlaceholder="Buscar sitio..." required />
                <ComboboxField label="Punto de venta" value={form.origin_station_id} onChange={(v) => setValue('origin_station_id', v)} options={stations} placeholder="Buscar punto de venta..." searchPlaceholder="Buscar..." required disabled={!form.site_id} />
                <ComboboxField label="Material" value={form.material_profile_id} onChange={(v) => setValue('material_profile_id', v)} options={materials} placeholder="Buscar material..." searchPlaceholder="Buscar..." required disabled={!form.site_id} />

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Placa" value={form.vehicle_plate} onChange={(e) => setValue('vehicle_plate', e.target.value)} placeholder="ABC-1234" required />
                  <TextField label="Chofer" value={form.driver_name} onChange={(e) => setValue('driver_name', e.target.value)} placeholder="Opcional" />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField
                    label="Vendido a"
                    value={form.sold_to_type}
                    onChange={(v) => setValue('sold_to_type', v)}
                    options={[{ value: 'WALK_IN', label: 'Comprador ocasional' }, { value: 'CUSTOMER', label: 'Cliente registrado' }]}
                    required
                  />
                  <TextField label="Nombre del comprador" value={form.customer_name} onChange={(e) => setValue('customer_name', e.target.value)} placeholder="Opcional" />
                </div>

                <NumberField label="Volumen vendido" suffix="m³" value={form.sold_volume_m3} onChange={(e) => setValue('sold_volume_m3', e.target.value)} min="0.01" step="0.01" required />

                <div className="grid gap-4 sm:grid-cols-2">
                  <SelectField label="Método de pago" value={form.payment_method} onChange={(v) => setValue('payment_method', v)} options={PAYMENT_METHODS} placeholder="Opcional" />
                  <TextField label="Referencia de pago" value={form.payment_reference} onChange={(e) => setValue('payment_reference', e.target.value)} placeholder="Opcional" />
                </div>

                <Button type="submit" className="w-full" loading={mutation.isPending} disabled={mutation.isPending}>
                  Crear vale
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
