import { useEffect } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Button, CurrencyField, DateField, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, NumberField, SelectField, TextField, TextareaField,
} from '@runly/ui'
import { SupplierField } from '../SupplierField.jsx'
import { errorText, useSaveDocument } from '../../hooks/usePurchases.js'
import { CURRENCY_OPTIONS } from '../../lib/purchases-constants.js'
import { formatMoney, today } from '../../lib/format.js'

const schema = z.object({
  supplierId: z.string({ error: 'Elige el proveedor' }).min(1, 'Elige el proveedor'),
  reference: z.string().max(100).optional(),
  issueDate: z.string().min(1, 'Indica la fecha'),
  validUntil: z.string().optional(),
  currency: z.string().length(3),
  subtotal: z.number().min(0),
  tax: z.number().min(0),
  deliveryDays: z.union([z.coerce.number().int().min(0), z.literal('')]).optional(),
  notes: z.string().max(2000).optional(),
})

// Registers a supplier quote on a case (and its request, when there is one).
export function QuoteDialog({ caseId, requestId, currency = 'MXN', open, onOpenChange }) {
  const save = useSaveDocument('quotes')
  const defaults = { supplierId: null, reference: '', issueDate: today(), validUntil: '', currency, subtotal: 0, tax: 0, deliveryDays: '', notes: '' }
  const { control, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(schema), defaultValues: defaults })
  const [subtotal, tax, cur] = useWatch({ control, name: ['subtotal', 'tax', 'currency'] })
  useEffect(() => { if (open) reset(defaults) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({ data: {
        caseId, requestId: requestId ?? null, supplierId: v.supplierId, reference: v.reference?.trim() || null,
        issueDate: v.issueDate, validUntil: v.validUntil || null, currency: v.currency,
        subtotal: v.subtotal, tax: v.tax, total: Math.round((v.subtotal + v.tax) * 100) / 100,
        deliveryDays: v.deliveryDays === '' || v.deliveryDays == null ? null : Number(v.deliveryDays), notes: v.notes?.trim() || null,
      } })
      toast.success('Cotización registrada')
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error, 'No se pudo registrar la cotización'))
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Registrar cotización</DialogTitle>
          <DialogDescription>Captura la propuesta del proveedor para compararla con las demás.</DialogDescription>
        </DialogHeader>
        <form id="purchase-quote" onSubmit={submit} className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          <Controller control={control} name="supplierId" render={({ field }) => (
            <SupplierField required value={field.value} onChange={(id) => field.onChange(id)} error={errors.supplierId?.message} />
          )} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Controller control={control} name="reference" render={({ field }) => <TextField label="Referencia del proveedor" placeholder="COT-2291" {...field} value={field.value ?? ''} />} />
            <Controller control={control} name="currency" render={({ field }) => <SelectField label="Moneda" options={CURRENCY_OPTIONS} value={field.value} onValueChange={field.onChange} />} />
            <Controller control={control} name="issueDate" render={({ field }) => <DateField label="Fecha" required value={field.value} onChange={(e) => field.onChange(e.target.value)} error={errors.issueDate?.message} />} />
            <Controller control={control} name="validUntil" render={({ field }) => <DateField label="Vigente hasta" value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} />} />
            <Controller control={control} name="subtotal" render={({ field }) => <CurrencyField label="Subtotal" value={field.value} onChange={field.onChange} currency={cur} />} />
            <Controller control={control} name="tax" render={({ field }) => <CurrencyField label="Impuestos" value={field.value} onChange={field.onChange} currency={cur} hint={`Total ${formatMoney((subtotal || 0) + (tax || 0), cur)}`} />} />
            <Controller control={control} name="deliveryDays" render={({ field }) => (
              <NumberField label="Tiempo de entrega" suffix="días" min="0" allowDecimal={false} allowNegative={false} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} />
            )} />
          </div>
          <Controller control={control} name="notes" render={({ field }) => <TextareaField label="Notas" rows={2} maxLength={2000} {...field} value={field.value ?? ''} />} />
        </form>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="purchase-quote" disabled={save.isPending}>{save.isPending ? 'Guardando...' : 'Registrar cotización'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
