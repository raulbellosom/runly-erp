import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Button, CurrencyField, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SelectField, TextField, TextareaField,
} from '@runly/ui'
import { SupplierField } from './SupplierField.jsx'
import { errorText, useSaveDocument } from '../hooks/usePurchases.js'
import { CURRENCY_OPTIONS, ROOT } from '../lib/purchases-constants.js'

const schema = z.object({
  title: z.string().trim().min(3, 'Describe la compra en al menos 3 caracteres').max(255),
  number: z.string().trim().max(40, 'Máximo 40 caracteres').optional(),
  description: z.string().max(2000).optional(),
  supplierId: z.string().nullable().optional(),
  estimatedTotal: z.number().min(0),
  currency: z.string().length(3),
})
const DEFAULTS = { number: '', title: '', description: '', supplierId: null, estimatedTotal: 0, currency: 'MXN' }

export function CaseCreateDialog({ open, onOpenChange }) {
  const navigate = useNavigate()
  const save = useSaveDocument('cases')
  const form = useForm({ resolver: zodResolver(schema), defaultValues: DEFAULTS })
  const { control, register, handleSubmit, reset, watch, formState: { errors } } = form
  useEffect(() => { if (open) reset(DEFAULTS) }, [open, reset])

  const submit = handleSubmit(async (values) => {
    try {
      const created = await save.mutateAsync({ data: { ...values, number: values.number || null } })
      toast.success('Expediente abierto')
      onOpenChange(false)
      if (created?.id) navigate(`${ROOT}/cases/${created.id}`)
    } catch (error) {
      toast.error(errorText(error, 'No se pudo abrir el expediente'))
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="lg">
        <DialogHeader className="shrink-0">
          <DialogTitle>Nuevo expediente</DialogTitle>
          <DialogDescription>Agrupa todo lo que ocurra en una compra: solicitud, cotizaciones, orden, facturas y pagos.</DialogDescription>
        </DialogHeader>
        <form id="purchase-case-form" onSubmit={submit} className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          <TextField label="Qué se compra" required placeholder="Renovación de laptops del área comercial" error={errors.title?.message} {...register('title')} />
          <TextField label="Folio (opcional)" placeholder="Automático" hint="Déjalo vacío para usar el formato de tu empresa." error={errors.number?.message} {...register('number')} />
          <Controller control={control} name="supplierId" render={({ field }) => (
            <SupplierField value={field.value} onChange={(id) => field.onChange(id)} hint="Opcional; puedes definirlo al cotizar." />
          )} />
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <Controller control={control} name="estimatedTotal" render={({ field }) => (
              <CurrencyField label="Monto estimado" value={field.value} onChange={field.onChange} currency={watch('currency')} />
            )} />
            <Controller control={control} name="currency" render={({ field }) => (
              <SelectField label="Moneda" options={CURRENCY_OPTIONS} value={field.value} onValueChange={field.onChange} />
            )} />
          </div>
          <TextareaField label="Contexto" rows={3} placeholder="Para qué se necesita, restricciones, contactos." {...register('description')} value={watch('description')} />
        </form>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="purchase-case-form" disabled={save.isPending}>{save.isPending ? 'Abriendo...' : 'Abrir expediente'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
