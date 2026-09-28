import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextField, TextareaField } from '@runly/ui'
import { toast } from 'sonner'
import { useCreateInventoryModel } from '../hooks/useInventoryReusableCatalogs.js'
import { InventoryBrandPicker, InventoryTypePicker, useBrandRows } from './InventoryCatalogPickers.jsx'

const EMPTY = { name: '', itemType: '', brandId: '', year: '', description: '' }

// Creates a catalog model (tipo + marca + nombre, año opcional). No <form>: it
// may open from inside RunlyForm, and a portaled submit would bubble to it.
export function InventoryModelDialog({ open, onOpenChange, initialValues, onCreated }) {
  const brands = useBrandRows()
  const createModel = useCreateInventoryModel()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (open) { setValues({ ...EMPTY, ...initialValues }); setErrors({}) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, value) => { setValues((prev) => ({ ...prev, [key]: value })); setErrors((prev) => ({ ...prev, [key]: '' })) }

  async function save() {
    const year = values.year === '' ? undefined : Number(values.year)
    const next = {}
    if (!values.name.trim()) next.name = 'Indica el nombre del modelo'
    if (!values.itemType) next.itemType = 'Selecciona o crea el tipo'
    if (!values.brandId) next.brandId = 'Selecciona o crea la marca'
    if (year !== undefined && !(Number.isInteger(year) && year >= 1900 && year <= 2100)) next.year = 'Año entre 1900 y 2100'
    setErrors(next)
    if (Object.keys(next).length) return
    const brand = brands.find((row) => row.id === values.brandId)
    try {
      const row = await createModel.mutateAsync({
        name: values.name.trim(), itemType: values.itemType, brandName: brand?.name, year,
        ...(values.description.trim() ? { description: values.description.trim() } : {}),
      })
      toast.success(row.reused ? 'El modelo ya existía; se seleccionó.' : 'Modelo creado')
      onCreated?.(row)
      onOpenChange(false)
    } catch (err) { toast.error(err.message) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="md">
        <DialogHeader>
          <DialogTitle>Nuevo modelo</DialogTitle>
          <DialogDescription>Un modelo se define por su tipo, marca, nombre y, opcionalmente, año.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          <div className="grid gap-4 sm:grid-cols-2">
            <InventoryTypePicker required value={values.itemType} onChange={(v) => set('itemType', v)} error={errors.itemType} />
            <InventoryBrandPicker required value={values.brandId} onChange={(v) => set('brandId', v)} error={errors.brandId} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <TextField label="Nombre del modelo" required value={values.name} maxLength={255} hint="XPS 15"
              onChange={(e) => set('name', e.target.value)} error={errors.name} />
            <TextField label="Año" type="number" min={1900} max={2100} value={values.year}
              onChange={(e) => set('year', e.target.value)} error={errors.year} />
          </div>
          <TextareaField label="Descripción" value={values.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" disabled={createModel.isPending} onClick={save}>
            {createModel.isPending ? 'Guardando...' : 'Crear modelo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
