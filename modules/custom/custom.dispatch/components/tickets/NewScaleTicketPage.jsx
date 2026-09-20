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
  PageHeader,
  Skeleton,
  TextField,
} from '@runly/ui'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, FileText, Printer } from 'lucide-react'
import { createScaleTicket, getDispatchSetup, printTicket } from '../lib/dispatch-api.js'

const QUERY_KEY = ['custom.dispatch', 'setup']

function initialForm() {
  return {
    site_id: '',
    origin_station_id: '',
    material_profile_id: '',
    customer_name: '',
    external_voucher_reference: '',
    vehicle_plate: '',
    driver_name: '',
  }
}

export default function NewScaleTicketPage({ token }) {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [created, setCreated] = useState(null)

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getDispatchSetup(token),
    enabled: Boolean(token),
  })

  const mutation = useMutation({
    mutationFn: (payload) => createScaleTicket({ token, data: payload }),
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
      .filter((s) => s.enabled && s.station_type === 'SCALE' && s.site_id === form.site_id)
      .map((s) => ({ value: s.id, label: s.name })),
    [query.data, form.site_id],
  )
  const materials = useMemo(
    () => (query.data?.materials ?? [])
      .filter((m) => m.enabled && m.site_id === form.site_id && m.allowed_modes?.includes('TONS'))
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
      sold_to_type: 'CUSTOMER',
      customer_name: form.customer_name,
      external_voucher_reference: form.external_voucher_reference.trim() || null,
      vehicle_plate: form.vehicle_plate,
      driver_name: form.driver_name.trim() || null,
    })
  }

  if (created) {
    return (
      <div className="min-h-full p-4 md:p-6 xl:p-8">
        <div className="mx-auto w-full max-w-xl space-y-6">
          <PageHeader eyebrow="Báscula" title="Vale creado" description="El siguiente paso es capturar la tara cuando el camión pase a báscula." />
          <Card variant="bordered">
            <CardHeader className="items-center text-center">
              <FileText className="h-8 w-8 text-primary" />
              <CardTitle className="text-2xl tracking-tight">{created.folio}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-sm text-muted-foreground">
                Imprime las 3 copias del vale. La tara se captura cuando el camión pase a báscula.
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
        <PageHeader eyebrow="Báscula" title="Nuevo vale con báscula" description="Vale de cliente de contrato, medido en la báscula." />

        {query.isLoading && <Skeleton className="h-96 w-full rounded-2xl" />}
        {query.isError && (
          <ErrorState title="No se pudo cargar el catálogo" description={query.error?.message} onRetry={query.refetch} />
        )}

        {query.data && (
          <Card variant="bordered">
            <CardContent className="p-5 sm:p-6">
              <form onSubmit={submit} className="space-y-4">
                <ComboboxField label="Sitio" value={form.site_id} onChange={setSite} options={sites} placeholder="Buscar sitio..." searchPlaceholder="Buscar sitio..." required />
                <ComboboxField label="Estación de báscula" value={form.origin_station_id} onChange={(v) => setValue('origin_station_id', v)} options={stations} placeholder="Buscar estación..." searchPlaceholder="Buscar..." required disabled={!form.site_id} />
                <ComboboxField label="Material" value={form.material_profile_id} onChange={(v) => setValue('material_profile_id', v)} options={materials} placeholder="Buscar material..." searchPlaceholder="Buscar..." required disabled={!form.site_id} />

                <TextField label="Cliente" value={form.customer_name} onChange={(e) => setValue('customer_name', e.target.value)} placeholder="Razón social o nombre" required />
                <TextField label="Referencia de vale externo" value={form.external_voucher_reference} onChange={(e) => setValue('external_voucher_reference', e.target.value)} placeholder="Folio del vale del cliente" />

                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField label="Placa" value={form.vehicle_plate} onChange={(e) => setValue('vehicle_plate', e.target.value)} placeholder="ABC-1234" required />
                  <TextField label="Chofer" value={form.driver_name} onChange={(e) => setValue('driver_name', e.target.value)} placeholder="Opcional" />
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
