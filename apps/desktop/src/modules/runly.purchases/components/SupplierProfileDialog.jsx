import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextField, TextareaField } from '@runly/ui'
import { useUpdateSupplierProfile } from '../hooks/usePurchases.js'

const schema = z.object({
  supplierCode: z.string().max(60).optional(),
  paymentTerms: z.string().max(120).optional(),
  notes: z.string().max(1000).optional(),
})

// Purchasing data only; name, RFC and address stay in the contact.
export function SupplierProfileDialog({ contactId, name, profile, open, onOpenChange }) {
  const update = useUpdateSupplierProfile(contactId)
  const { control, handleSubmit, reset } = useForm({ resolver: zodResolver(schema) })
  useEffect(() => {
    if (open) reset({ supplierCode: profile?.supplierCode ?? '', paymentTerms: profile?.paymentTerms ?? '', notes: profile?.notes ?? '' })
  }, [open, profile, reset])

  const submit = handleSubmit((v) => update.mutate(
    { supplierCode: v.supplierCode?.trim() || null, paymentTerms: v.paymentTerms?.trim() || null, notes: v.notes?.trim() || null },
    { onSuccess: () => onOpenChange(false) },
  ))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="md">
        <DialogHeader className="shrink-0">
          <DialogTitle>Perfil de compras</DialogTitle>
          <DialogDescription>{name}. Los datos de contacto se editan en el directorio.</DialogDescription>
        </DialogHeader>
        <form id="supplier-profile" onSubmit={submit} className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto px-0.5">
          <Controller control={control} name="supplierCode" render={({ field }) => <TextField label="Código de proveedor" placeholder="PROV-014" {...field} value={field.value ?? ''} />} />
          <Controller control={control} name="paymentTerms" render={({ field }) => <TextField label="Condiciones de pago" placeholder="Crédito 30 días" {...field} value={field.value ?? ''} />} />
          <Controller control={control} name="notes" render={({ field }) => <TextareaField label="Notas" rows={3} maxLength={1000} {...field} value={field.value ?? ''} />} />
        </form>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="supplier-profile" disabled={update.isPending}>{update.isPending ? 'Guardando...' : 'Guardar perfil'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
