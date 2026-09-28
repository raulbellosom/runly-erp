import { useMemo, useState } from 'react'
import { CreatableComboboxField } from '@runly/ui'
import { useInventoryModels, modelLabel } from '../hooks/useInventoryModels.js'
import { InventoryBrandPicker, InventoryTypePicker } from './InventoryCatalogPickers.jsx'
import { InventoryModelDialog } from './InventoryModelDialog.jsx'

const LEGACY = '__legacy__'
const NONE = '__none__'

// RunlyForm "component" section: model, type (categoryId) and brand. Picking a
// catalog model fills Tipo and Marca; "+ Crear «X»" opens the model dialog,
// which can itself create types and brands.
export function InventoryItemClassification({ value, onChange, errors = {}, disabled, renderPin }) {
  const { data: models = [] } = useInventoryModels()
  const [dialog, setDialog] = useState(null)

  const selected = value.modelId || (value.model ? LEGACY : '')
  const options = useMemo(() => {
    const rows = models.map((row) => ({ value: row.id, label: modelLabel(row), keywords: row.description ?? '' }))
    if (!value.modelId && value.model) rows.unshift({ value: LEGACY, label: `${value.model} (sin catálogo)` })
    if (value.modelId || value.model) rows.unshift({ value: NONE, label: 'Sin modelo' })
    return rows
  }, [models, value.modelId, value.model])

  function applyModel(row) {
    onChange({ modelId: row.id, model: row.name, categoryId: row.typeId, brandId: row.brandId })
  }

  function handleSelect(id) {
    if (id === NONE) return onChange({ modelId: null, model: '' })
    const row = models.find((model) => model.id === id)
    if (row) applyModel(row)
  }

  return (
    <fieldset disabled={disabled} className="grid gap-4 lg:grid-cols-2">
      <div className="relative col-span-full">
        {renderPin?.(['modelId', 'model'], 'Modelo')}
        <CreatableComboboxField
          label="Modelo"
          value={selected}
          options={options}
          error={errors.modelId || errors.model}
          hint="Busca por nombre, marca, tipo o año. Al elegir un modelo se completan tipo y marca."
          onChange={handleSelect}
          onCreate={(name) => setDialog({ name, typeId: value.categoryId ?? '', brandId: value.brandId ?? '' })}
          placeholder="Buscar o crear..."
          searchPlaceholder="Ej. Dell XPS 2023"
        />
      </div>
      <div className="relative">
        {renderPin?.(['categoryId'], 'Tipo')}
        <InventoryTypePicker value={value.categoryId} onChange={(categoryId) => onChange({ categoryId })} error={errors.categoryId} />
      </div>
      <div className="relative">
        {renderPin?.(['brandId'], 'Marca')}
        <InventoryBrandPicker value={value.brandId} onChange={(brandId) => onChange({ brandId })} error={errors.brandId} />
      </div>
      <InventoryModelDialog
        open={Boolean(dialog)}
        onOpenChange={(open) => { if (!open) setDialog(null) }}
        initialValues={dialog ?? undefined}
        onSaved={applyModel}
      />
    </fieldset>
  )
}

export const inventoryFormComponents = {
  resolve: (key) => (key === 'inventory.item-classification' ? InventoryItemClassification : null),
}
