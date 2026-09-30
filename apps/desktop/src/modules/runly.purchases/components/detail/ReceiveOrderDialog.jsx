import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { PackageCheck } from 'lucide-react'
import {
  Button, DateField, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, NumberField, TextareaField,
} from '@runly/ui'
import { errorText, useSaveDocument } from '../../hooks/usePurchases.js'
import { pendingQuantity } from '../../lib/document-math.js'
import { formatQty, toNumber, today } from '../../lib/format.js'

// Partial receipts: one quantity per pending goods line, never above what is
// still pending (the API validates the same rule).
export function ReceiveOrderDialog({ order, open, onOpenChange }) {
  const save = useSaveDocument('receipts')
  const pendingLines = useMemo(() => (order?.lines ?? []).filter((l) => l.id && l.itemKind !== 'SERVICE' && pendingQuantity(l) > 0), [order?.lines])
  const [qty, setQty] = useState({})
  const [receivedAt, setReceivedAt] = useState(today())
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    setQty(Object.fromEntries(pendingLines.map((l) => [l.id, String(pendingQuantity(l))])))
    setReceivedAt(today())
    setNotes('')
  }, [open, pendingLines])

  const errors = Object.fromEntries(pendingLines.map((l) => {
    const value = toNumber(qty[l.id])
    if (value < 0) return [l.id, 'No negativo']
    if (value > pendingQuantity(l)) return [l.id, `Máximo ${formatQty(pendingQuantity(l))}`]
    return [l.id, null]
  }))
  const payloadLines = pendingLines.map((l) => ({ orderLineId: l.id, quantity: toNumber(qty[l.id]) })).filter((l) => l.quantity > 0)
  const invalid = Object.values(errors).some(Boolean) || !payloadLines.length || !receivedAt
  const completes = pendingLines.every((l) => toNumber(qty[l.id]) === pendingQuantity(l))

  const submit = async () => {
    try {
      await save.mutateAsync({ data: { orderId: order.id, receivedAt, notes: notes.trim() || null, lines: payloadLines } })
      toast.success(completes ? 'Orden recibida completa' : 'Recepción parcial registrada')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error, 'No se pudo registrar la recepción'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Registrar recepción de {order?.number}</DialogTitle>
          <DialogDescription>Captura lo que llegó. Si falta algo, la orden queda como recibida parcial.</DialogDescription>
        </DialogHeader>
        <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          {!pendingLines.length ? (
            <EmptyState icon={PackageCheck} title="Nada por recibir" description="Todos los bienes de esta orden ya se recibieron." />
          ) : (
            <>
              <DateField label="Fecha de recepción" required value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
              <ul className="space-y-2">
                {pendingLines.map((l) => (
                  <li key={l.id} className="grid items-end gap-3 rounded-xl bg-[hsl(var(--muted))]/35 p-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                    <div className="min-w-0 pb-1">
                      <p className="truncate text-sm font-medium">{l.description || 'Sin concepto'}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        Pedido {formatQty(l.quantity)}{l.unit ? ` ${l.unit}` : ''}, recibido {formatQty(l.receivedQuantity)}, pendiente {formatQty(pendingQuantity(l))}
                      </p>
                    </div>
                    <NumberField label="Llegó" min="0" step="any" allowNegative={false} value={qty[l.id] ?? ''} error={errors[l.id]}
                      onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} suffix={l.unit || undefined} />
                  </li>
                ))}
              </ul>
              <TextareaField label="Observaciones" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Estado del empaque, faltantes, quién recibió." />
            </>
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={invalid || save.isPending} onClick={submit}>{save.isPending ? 'Guardando...' : completes ? 'Recibir todo' : 'Registrar recepción parcial'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
