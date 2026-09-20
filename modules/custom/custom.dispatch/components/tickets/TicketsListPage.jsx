import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, DataTable, ErrorState, PageHeader, SelectField } from '@runly/ui'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Eye, Plus } from 'lucide-react'
import { listTickets } from '../lib/dispatch-api.js'
import { TICKET_STATUS_LABEL, TICKET_STATUS_VARIANT, VOUCHER_LABEL } from '../lib/catalog-config.js'

const STATUS_FILTER_OPTIONS = Object.entries(TICKET_STATUS_LABEL).map(([value, label]) => ({ value, label }))
const VOUCHER_FILTER_OPTIONS = Object.entries(VOUCHER_LABEL).map(([value, label]) => ({ value, label }))

function StatusBadge({ status }) {
  return <Badge variant={TICKET_STATUS_VARIANT[status] ?? 'secondary'}>{TICKET_STATUS_LABEL[status] ?? status}</Badge>
}

export default function TicketsListPage({ token }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('')
  const [voucherType, setVoucherType] = useState('')

  const query = useQuery({
    queryKey: ['custom.dispatch', 'tickets', { status, voucherType }],
    queryFn: () => listTickets({ token, filters: { status, voucher_type: voucherType } }),
    enabled: Boolean(token),
  })

  const columns = useMemo(() => [
    { accessorKey: 'folio', header: 'Folio' },
    { accessorKey: 'voucher_type', header: 'Tipo', cell: ({ row }) => VOUCHER_LABEL[row.original.voucher_type] },
    { accessorKey: 'site_name', header: 'Sitio' },
    { accessorKey: 'vehicle_plate', header: 'Placa' },
    { accessorKey: 'material_name', header: 'Material' },
    { accessorKey: 'status', header: 'Estado', cell: ({ row }) => <StatusBadge status={row.original.status} /> },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Ver vale"
            onClick={() => navigate(`/app/m/custom.dispatch/vales/${row.original.id}`)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ], [navigate])

  return (
    <div className="min-h-full p-4 md:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-screen-2xl space-y-6">
        <PageHeader
          eyebrow="Despachos y báscula"
          title="Vales"
          description="Historial de vales por volumen y por báscula."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate('/app/m/custom.dispatch/vales/nueva-bascula')}>
                <Plus className="mr-2 h-4 w-4" />
                Vale con báscula
              </Button>
              <Button onClick={() => navigate('/app/m/custom.dispatch/vales/nueva-volumen')}>
                <Plus className="mr-2 h-4 w-4" />
                Vale por volumen
              </Button>
            </div>
          }
        />

        {query.isError && (
          <ErrorState title="No se pudieron cargar los vales" description={query.error?.message} onRetry={query.refetch} />
        )}

        {!query.isError && (
          <Card variant="bordered" className="overflow-hidden">
            <CardHeader className="gap-4 border-b border-border p-5 sm:p-6">
              <CardTitle>Historial</CardTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField label="Estado" value={status} onChange={setStatus} options={STATUS_FILTER_OPTIONS} placeholder="Todos" />
                <SelectField label="Tipo de vale" value={voucherType} onChange={setVoucherType} options={VOUCHER_FILTER_OPTIONS} placeholder="Todos" />
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              <DataTable
                columns={columns}
                data={query.data ?? []}
                isLoading={query.isLoading}
                searchPlaceholder="Buscar por folio o placa..."
                emptyTitle="No hay vales"
                emptyDescription="Crea un vale por volumen o con báscula para comenzar."
                emptyAction={
                  <Button onClick={() => navigate('/app/m/custom.dispatch/vales/nueva-volumen')}>
                    Crear vale
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                }
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
