import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Controller, useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, NumberField, SelectField, TextField,
} from '@runly/ui'
import { useAuth } from '../../../../auth/AuthProvider.jsx'
import { runly } from '../../../../lib/runly.js'
import { errorText, useCreateInventoryFromLine } from '../../hooks/usePurchases.js'
import { toNumber } from '../../lib/format.js'

const MAX_UNITS = 50
const schema = z.object({
  count: z.coerce.number().int().min(1, 'Al menos 1').max(MAX_UNITS, `Máximo ${MAX_UNITS} por vez`),
  categoryId: z.string().nullable().optional(),
  locationId: z.string().nullable().optional(),
  units: z.array(z.object({ name: z.string().trim().min(1, 'Nombre requerido').max(255), serialNumber: z.string().max(120).optional() })),
})

function useCatalog(key, fn) {
  const token = useAuth().session?.access_token
  return useQuery({
    queryKey: ['inventory', key],
    queryFn: () => fn(token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

// Creates inventory items from a goods line through the inventory service
// (POST /purchases/lines/:lineId/inventory); each item is related to the
// document with origin AUTOMATIC and gets the line's unit amount allocated.
export function CreateInventoryFromLineDialog({ line, open, onOpenChange }) {
  const create = useCreateInventoryFromLine()
  const categories = useCatalog('categories', (t) => runly.inventory.listCategories(t))
  const locations = useCatalog('locations', (t) => runly.inventory.listLocations(t))
  const toOptions = (res) => (res?.data ?? res ?? []).map((c) => ({ value: c.id, label: c.name }))

  const initialCount = Math.min(MAX_UNITS, Math.max(1, Math.round(toNumber(line?.quantity) - toNumber(line?.inventoryCount))))
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { count: 1, categoryId: null, locationId: null, units: [] } })
  const { control, handleSubmit, reset, formState: { errors } } = form
  const { fields, replace } = useFieldArray({ control, name: 'units' })
  const count = useWatch({ control, name: 'count' })

  useEffect(() => {
    if (!open || !line) return
    reset({
      count: initialCount, categoryId: line.inventoryCategoryId ?? null, locationId: null,
      units: Array.from({ length: initialCount }, () => ({ name: line.description, serialNumber: '' })),
    })
  }, [open, line, initialCount, reset])

  useEffect(() => {
    const n = Math.min(MAX_UNITS, Math.max(0, Math.floor(toNumber(count))))
    if (!open || n === fields.length || !line) return
    const current = form.getValues('units')
    replace(Array.from({ length: n }, (_, i) => current[i] ?? { name: line.description, serialNumber: '' }))
  }, [count]) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        lineId: line.id,
        items: values.units.map((u) => ({ name: u.name.trim(), serialNumber: u.serialNumber?.trim() || null, categoryId: values.categoryId || null, locationId: values.locationId || null })),
      })
      toast.success(values.units.length === 1 ? 'Activo creado en Inventario' : `${values.units.length} activos creados en Inventario`)
      onOpenChange(false)
    } catch (error) {
      toast.error(errorText(error, 'No se pudieron crear los activos'))
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="xl">
        <DialogHeader className="shrink-0">
          <DialogTitle>Crear activos desde el concepto</DialogTitle>
          <DialogDescription>{line?.description ? `${line.description}. ` : ''}Cada activo queda relacionado con este documento y con su costo unitario.</DialogDescription>
        </DialogHeader>
        <form id="inventory-from-line" onSubmit={submit} className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Controller control={control} name="count" render={({ field }) => (
              <NumberField label="Cuántos activos" min="1" max={MAX_UNITS} allowDecimal={false} allowNegative={false} error={errors.count?.message}
                value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} />
            )} />
            <Controller control={control} name="categoryId" render={({ field }) => (
              <SelectField label="Tipo" options={toOptions(categories.data)} value={field.value ?? ''} onValueChange={field.onChange} placeholder="Sin tipo" clearable />
            )} />
            <Controller control={control} name="locationId" render={({ field }) => (
              <SelectField label="Ubicación" options={toOptions(locations.data)} value={field.value ?? ''} onValueChange={field.onChange} placeholder="Sin ubicación" clearable />
            )} />
          </div>
          <ol className="space-y-2">
            {fields.map((f, index) => (
              <li key={f.id} className="grid gap-3 rounded-xl bg-[hsl(var(--muted))]/35 p-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,14rem)] sm:items-end">
                <span className="hidden pb-2.5 text-xs tabular-nums text-[hsl(var(--muted-foreground))] sm:block">{index + 1}</span>
                <Controller control={control} name={`units.${index}.name`} render={({ field }) => (
                  <TextField label="Nombre" error={errors.units?.[index]?.name?.message} {...field} value={field.value ?? ''} />
                )} />
                <Controller control={control} name={`units.${index}.serialNumber`} render={({ field }) => (
                  <TextField label="Número de serie" placeholder="Opcional" {...field} value={field.value ?? ''} />
                )} />
              </li>
            ))}
          </ol>
        </form>
        <DialogFooter className="shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="submit" form="inventory-from-line" disabled={create.isPending || !fields.length}>
            {create.isPending ? 'Creando...' : `Crear ${fields.length} ${fields.length === 1 ? 'activo' : 'activos'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
