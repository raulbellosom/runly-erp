import { CreatableComboboxField } from '@runly/ui'
import { toast } from 'sonner'
import {
  useInventoryBrands, useCreateInventoryBrand, useInventoryCategories, useCreateInventoryCategory,
} from '../hooks/useInventoryCatalogs.js'

const rowsOf = (data) => (data?.data ?? data ?? []).filter((row) => row.enabled !== false)

export function useBrandRows() {
  return rowsOf(useInventoryBrands().data)
}

export function useTypeRows() {
  return rowsOf(useInventoryCategories().data)
}

// Subtypes read "Laptop › Gamer" so the hierarchy is visible in a flat list.
export function typeOptions(types) {
  const byId = new Map(types.map((type) => [type.id, type]))
  return types.map((type) => ({
    value: type.id,
    label: type.parentId && byId.has(type.parentId) ? `${byId.get(type.parentId).name} › ${type.name}` : type.name,
  }))
}

export function InventoryTypePicker({ value, onChange, error, required, label = 'Tipo' }) {
  const types = useTypeRows()
  const createType = useCreateInventoryCategory()
  async function handleCreate(name) {
    try {
      const res = await createType.mutateAsync({ name })
      const row = res?.data ?? res
      if (row?.id) onChange(row.id)
      toast.success(`Tipo «${name}» creado`)
    } catch (err) { toast.error(err?.message || 'No se pudo crear el tipo.') }
  }
  return (
    <CreatableComboboxField label={label} required={required} error={error} value={value ?? ''} options={typeOptions(types)}
      onChange={onChange} onCreate={handleCreate} isCreating={createType.isPending}
      placeholder="Buscar o crear..." searchPlaceholder="Buscar tipo..." />
  )
}

export function InventoryBrandPicker({ value, onChange, error, required, label = 'Marca' }) {
  const brands = useBrandRows()
  const createBrand = useCreateInventoryBrand()
  async function handleCreate(name) {
    try {
      const res = await createBrand.mutateAsync({ name })
      const row = res?.data ?? res
      if (row?.id) onChange(row.id)
      toast.success(`Marca «${name}» creada`)
    } catch (err) { toast.error(err?.message || 'No se pudo crear la marca.') }
  }
  return (
    <CreatableComboboxField label={label} required={required} error={error} value={value ?? ''}
      options={brands.map((brand) => ({ value: brand.id, label: brand.name }))}
      onChange={onChange} onCreate={handleCreate} isCreating={createBrand.isPending}
      placeholder="Buscar o crear..." searchPlaceholder="Buscar marca..." />
  )
}
