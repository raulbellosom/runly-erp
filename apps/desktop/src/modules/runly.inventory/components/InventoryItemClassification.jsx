import { useMemo, useState } from 'react'
import { CreatableComboboxField } from '@runly/ui'
import { useInventoryModels, modelLabel } from '../hooks/useInventoryReusableCatalogs.js'
import { InventoryBrandPicker, InventoryTypePicker, findBrandId, useBrandRows } from './InventoryCatalogPickers.jsx'
import { InventoryModelDialog } from './InventoryModelDialog.jsx'

const CURRENT = '__current__'
const NONE = '__none__'

// RunlyForm "component" section for the item's model, type and brand.
// Picking a catalog model fills Tipo and Marca; "+ Crear «X»" opens the
// model dialog, which can itself create types and brands.
export function InventoryItemClassification({ value, onChange, errors = {}, disabled }) {
  const { data: models = [] } = useInventoryModels()
  const brands = useBrandRows()
  const [dialog, setDialog] = useState(null)

  const selectedId = useMemo(() => {
    const name = value.model?.trim().toLocaleLowerCase('es')
    if (!name) return ''
    const sameName = models.filter((row) => row.name.toLocaleLowerCase('es') === name)
    const exact = sameName.find((row) => (row.details?.brandId || findBrandId(brands, row.details)) === value.brandId
      && (!value.itemType || row.details?.itemType === value.itemType))
    return (exact ?? sameName[0])?.id ?? CURRENT
  }, [models, brands, value.model, value.brandId, value.itemType])

  const options = useMemo(() => {
    const rows = models.map((row) => ({ value: row.id, label: modelLabel(row), keywords: row.details?.description ?? '' }))
    if (selectedId === CURRENT) rows.unshift({ value: CURRENT, label: value.model })
    if (value.model) rows.unshift({ value: NONE, label: 'Sin modelo' })
    return rows
  }, [models, selectedId, value.model])

  function applyModel(row) {
    const details = row.details ?? {}
    onChange({
      model: row.name,
      itemType: details.itemType || value.itemType || '',
      brandId: details.brandId || findBrandId(brands, details) || value.brandId || '',
    })
  }

  function handleSelect(id) {
    if (id === NONE) return onChange({ model: '' })
    const row = models.find((model) => model.id === id)
    if (row) applyModel(row)
  }

  return (
    <fieldset disabled={disabled} className="grid gap-4 lg:grid-cols-2">
      <div className="col-span-full">
        <CreatableComboboxField
          label="Modelo"
          value={selectedId}
          options={options}
          error={errors.model}
          hint="Busca por nombre, marca, tipo o año. Al elegir un modelo se completan tipo y marca."
          onChange={handleSelect}
          onCreate={(name) => setDialog({ name, itemType: value.itemType ?? '', brandId: value.brandId ?? '' })}
          placeholder="Buscar o crear..."
          searchPlaceholder="Ej. Dell XPS 2023"
        />
      </div>
      <InventoryTypePicker value={value.itemType} onChange={(itemType) => onChange({ itemType })} error={errors.itemType} />
      <InventoryBrandPicker value={value.brandId} onChange={(brandId) => onChange({ brandId })} error={errors.brandId} />
      <InventoryModelDialog
        open={Boolean(dialog)}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        initialValues={dialog ?? undefined}
        onCreated={applyModel}
      />
    </fieldset>
  )
}

export const inventoryFormComponents = {
  resolve: (key) => (key === 'inventory.item-classification' ? InventoryItemClassification : null),
}
