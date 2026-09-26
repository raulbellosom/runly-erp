import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/components/DeletedTransactionsSheet.jsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Sheet, SheetContent, SheetHeader, SheetTitle, Button, EmptyState } from '@runly/ui'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

function fmtCurrency(amount, currency = 'MXN') {
  return Number(amount ?? 0).toLocaleString('es-MX', {
    style: 'currency', currency, minimumFractionDigits: 2,
  })
}

export default function DeletedTransactionsSheet({ accountId, currency, open, onOpenChange }) {
  const { session } = useAuth()
  const token = session?.access_token ?? null
  const queryClient = useQueryClient()
  const headers = { Authorization: `Bearer ${token}` }

  const { data, isLoading } = useQuery({
    queryKey: ['ledger-transactions-disabled', accountId, token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}/transactions/disabled?pageSize=200`, { headers })
      if (!res.ok) throw new Error('No se pudieron cargar los movimientos eliminados.')
      return res.json()
    },
    enabled: open && !!accountId && !!token,
  })

  const restoreMutation = useMutation({
    mutationFn: async (txId) => {
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${accountId}/transactions/${txId}/enabled`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ enabled: true }),
      })
      if (!res.ok) throw new Error('No se pudo restaurar el movimiento.')
    },
    onSuccess: () => {
      toast.success('Movimiento restaurado.')
      queryClient.invalidateQueries({ queryKey: ['ledger-transactions-disabled', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-transactions', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-account', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-summary', accountId] })
    },
    onError: (err) => toast.error(err.message),
  })

  const rows = data?.data ?? []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Movimientos eliminados</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-auto px-1 py-3 space-y-2">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />)}
            </div>
          )}

          {!isLoading && rows.length === 0 && (
            <EmptyState
              icon={Trash2}
              title="Sin movimientos eliminados"
              description="Los movimientos que elimines de esta cuenta aparecerán aquí."
            />
          )}

          {rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{row.nombre}</p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  {row.fecha}
                  <span className="mx-1.5 opacity-40">·</span>
                  {row.deposito ? fmtCurrency(row.deposito, currency) : `-${fmtCurrency(row.retiro, currency)}`}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => restoreMutation.mutate(row.id)}
                disabled={restoreMutation.isPending}
              >
                <RotateCcw size={13} className="mr-1.5" />
                Restaurar
              </Button>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
