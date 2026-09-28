import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextField, TextareaField } from '@runly/ui'
import { toast } from 'sonner'
import { useSaveInventoryModel } from '../hooks/useInventoryModels.js'
import { InventoryBrandPicker, InventoryTypePicker } from './InventoryCatalogPickers.jsx'

const EMPTY = { name: '', typeId: '', brandId: '', year: '', description: '' }

// Creates or edits a catalog model. No <form>: it can open inside RunlyForm,
// and a portaled submit would bubble to that form through the React tree.
export function InventoryModelDialog({ open, onOpenChange, model = null, initialValues, onSaved }) {
  const save = useSaveInventoryModel()
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})

  useEffect(() => {
    if (!open) return
    setErrors({})
    setValues(model
      ? { name: model.name, typeId: model.typeId, brandId: model.brandId, year: model.year ? String(model.year) : '', description: model.description ?? '' }
      : { ...EMPTY, ...initialValues })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, value) => { setValues((prev) => ({ ...prev, [key]: value })); setErrors((prev) => ({ ...prev, [key]: '' })) }

  async function handleSave() {
    const year = values.year === '' ? null : Number(values.year)
    const next = {}
    if (!values.name.trim()) next.name = 'Indica el nombre del modelo'
    if (!values.typeId) next.typeId = 'Selecciona o crea el tipo'
    if (!values.brandId) next.brandId = 'Selecciona o crea la marca'
    if (year !== null && !(Number.isInteger(year) && year >= 1900 && year <= 2100)) next.year = 'Año entre 1900 y 2100'
    setErrors(next)
    if (Object.keys(next).length) return
    try {
      const row = await save.mutateAsync({
        ...(model ? { id: model.id } : {}),
        name: values.name.trim(), typeId: values.typeId, brandId: values.brandId, year,
        description: values.description.trim() || null,
      })
      toast.success(model ? 'Modelo actualizado' : 'Modelo creado')
      onSaved?.(row)
      onOpenChange(false)
    } catch (err) { toast.error(err.message) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent scrollable size="md">
        <DialogHeader>
          <DialogTitle>{model ? 'Editar modelo' : 'Nuevo modelo'}</DialogTitle>
          <DialogDescription>Un modelo se define por su tipo, marca, nombre y, opcionalmente, año.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-0.5">
          <div className="grid gap-4 sm:grid-cols-2">
            <InventoryTypePicker required value={values.typeId} onChange={(v) => set('typeId', v)} error={errors.typeId} />
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
          <Button type="button" disabled={save.isPending} onClick={handleSave}>
            {save.isPending ? 'Guardando...' : model ? 'Guardar cambios' : 'Crear modelo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
