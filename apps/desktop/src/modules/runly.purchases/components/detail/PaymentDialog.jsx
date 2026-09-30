import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Button, CurrencyField, DateField, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SelectField, TextField,
} from '@runly/ui'
import { errorText, useTransition } from '../../hooks/usePurchases.js'
import { PAYMENT_METHODS } from '../../lib/purchases-constants.js'
import { formatMoney, toNumber, today } from '../../lib/format.js'

// Records a payment against an invoice (transition `pay`). Compras keeps the
// status and reference only; accounting stays in Finanzas.
export function PaymentDialog({ invoice, open, onOpenChange }) {
  const transition = useTransition('invoices', invoice?.id)
  const balance = Math.max(0, toNumber(invoice?.total) - toNumber(invoice?.paidAmount))
  const schema = z.object({
    amount: z.number().positive('Captura el monto pagado').max(balance + 0.001, `No puede exceder el saldo de ${formatMoney(balance, invoice?.currency)}`),
    paidAt: z.string().min(1, 'Indica la fecha'),
    method: z.string().min(1, 'Elige la forma de pago'),
    reference: z.string().max(120).optional(),
  })
  const { control, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: { amount: balance, paidAt: today(), method: 'TRANSFER', reference: '' } })
  const amount = useWatch({ control, name: 'amount' })
  useEffect(() => { if (open) reset({ amount: balance, paidAt: today(), method: 'TRANSFER', reference: '' }) }, [open, balance, reset])

  const submit = handleSubmit(async (values) => {
    try {
      await transition.mutateAsync({ action: 'pay', ...values, reference: values.reference?.trim() || undefined })
      toast.success(values.amount >= balance ? 'Factura pagada' : 'Pago parcial registrado')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error, 'No se pudo registrar el pago'))
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="md">
        <DialogHeader className="shrink-0">
          <DialogTitle>Registrar pago de {invoice?.number}</DialogTitle>
          <DialogDescription>Saldo actual {formatMoney(balance, invoice?.currency)}.</DialogDescription>
        </DialogHeader>
        <form id="purchase-payment" onSubmit={submit} className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          <Controller control={control} name="amount" render={({ field }) => (
            <CurrencyField label="Monto pagado" required value={field.value} onChange={field.onChange} currency={invoice?.currency} error={errors.amount?.message}
              hint={toNumber(amount) < balance ? `Quedará un saldo de ${formatMoney(balance - toNumber(amount), invoice?.currency)}` : 'Liquida la factura'} />
          )} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller control={control} name="paidAt" render={({ field }) => (
              <DateField label="Fecha de pago" required value={field.value} onChange={(e) => field.onChange(e.target.value)} error={errors.paidAt?.message} />
            )} />
            <Controller control={control} name="method" render={({ field }) => (
              <SelectField label="Forma de pago" options={PAYMENT_METHODS} value={field.value} onValueChange={field.onChange} error={errors.method?.message} />
            )} />
          </div>
          <Controller control={control} name="reference" render={({ field }) => (
            <TextField label="Referencia" placeholder="Folio de transferencia o número de cheque" {...field} value={field.value ?? ''} />
          )} />
        </form>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="purchase-payment" disabled={transition.isPending}>{transition.isPending ? 'Guardando...' : 'Registrar pago'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
