import { useState } from 'react'
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
  Skeleton,
  TextareaField,
} from '@runly/ui'
import { toast } from 'sonner'
import { Check, Clock, Scale, X } from 'lucide-react'
import { approveExit, listPendingExits, rejectExit } from '../lib/dispatch-api.js'
import { VOUCHER_LABEL } from '../lib/catalog-config.js'

function elapsed(scannedAt) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(scannedAt).getTime()) / 60000))
  if (minutes < 1) return 'hace un momento'
  if (minutes === 1) return 'hace 1 minuto'
  return `hace ${minutes} minutos`
}

export default function ExitApprovalQueuePage({ token }) {
  const queryClient = useQueryClient()
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')

  const query = useQuery({
    queryKey: ['custom.dispatch', 'exits', 'pending'],
    queryFn: () => listPendingExits({ token }),
    enabled: Boolean(token),
    refetchInterval: 15000,
  })

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['custom.dispatch', 'exits', 'pending'] })
  }

  const approveMutation = useMutation({
    mutationFn: (id) => approveExit({ token, id }),
    onSuccess: () => { toast.success('Salida aprobada. El vale quedó como usado.'); invalidate() },
    onError: (error) => toast.error(error.message || 'No fue posible aprobar la salida.'),
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => rejectExit({ token, id, reason }),
    onSuccess: () => {
      toast.success('Salida rechazada. El vale puede escanearse de nuevo tras corregir la carga.')
      setRejectTarget(null)
      setRejectReason('')
      invalidate()
    },
    onError: (error) => toast.error(error.message || 'No fue posible rechazar la salida.'),
  })

  return (
    <div className="min-h-full p-4 md:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <PageHeader
          eyebrow="Báscula"
          title="Salidas pendientes"
          description="Vales escaneados en la pluma que esperan tu decisión."
        />

        {query.isLoading && <Skeleton className="h-64 w-full rounded-2xl" />}
        {query.isError && (
          <ErrorState title="No se pudieron cargar las salidas pendientes" description={query.error?.message} onRetry={query.refetch} />
        )}

        {query.data && query.data.length === 0 && (
          <EmptyState icon={Scale} title="Sin salidas pendientes" description="Cuando un vale se escanee en la pluma, aparecerá aquí." />
        )}

        {query.data?.length > 0 && (
          <div className="space-y-4">
            {query.data.map((item) => (
              <Card key={item.id} variant="bordered">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {item.folio}
                      <Badge variant="secondary">{VOUCHER_LABEL[item.voucher_type]}</Badge>
                    </CardTitle>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" />
                      Intento {item.attempt_number} · {elapsed(item.scanned_at)} · {item.gate_station_name}
                    </p>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Placa</p>
                      <p className="text-sm font-medium text-foreground">{item.vehicle_plate}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Material</p>
                      <p className="text-sm font-medium text-foreground">{item.material_name}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Cliente</p>
                      <p className="text-sm font-medium text-foreground">{item.customer_name ?? '—'}</p>
                    </div>
                    {item.voucher_type === 'VOLUME' && (
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Volumen vendido</p>
                        <p className="text-sm font-medium text-foreground">{item.sold_volume_m3} m³</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => approveMutation.mutate(item.id)}
                      loading={approveMutation.isPending}
                      disabled={approveMutation.isPending}
                    >
                      <Check className="mr-2 h-4 w-4" />
                      Aprobar salida
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setRejectTarget(item)}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Rechazar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={Boolean(rejectTarget)} onOpenChange={(open) => !open && setRejectTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rechazar salida — {rejectTarget?.folio}</DialogTitle>
              <DialogDescription>
                El vale quedará como "Requiere corrección" y podrá escanearse de nuevo una vez corregida la carga.
              </DialogDescription>
            </DialogHeader>
            <TextareaField
              label="Motivo del rechazo"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              required
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancelar</Button>
              <Button
                variant="destructive"
                onClick={() => rejectMutation.mutate({ id: rejectTarget.id, reason: rejectReason.trim() })}
                loading={rejectMutation.isPending}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
              >
                Rechazar salida
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
