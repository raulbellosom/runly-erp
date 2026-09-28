import { CreatableComboboxField } from '@runly/ui'
import { toast } from 'sonner'
import { useInventoryBrands, useCreateInventoryBrand } from '../hooks/useInventoryCatalogs.js'
import { useInventoryTypes, useCreateInventoryType } from '../hooks/useInventoryReusableCatalogs.js'

export function useBrandRows() {
  const { data } = useInventoryBrands()
  return (data?.data ?? data ?? []).filter((brand) => brand.enabled !== false)
}

export function findBrandId(brands, { brandId, brandName } = {}) {
  if (brandId && brands.some((brand) => brand.id === brandId)) return brandId
  const key = brandName?.trim().toLocaleLowerCase('es')
  return key ? (brands.find((brand) => brand.name.trim().toLocaleLowerCase('es') === key)?.id ?? null) : null
}

// Tipo: base types + company types; "+ Crear «X»" adds it to the catalog.
export function InventoryTypePicker({ value, onChange, error, required, label = 'Tipo' }) {
  const { data } = useInventoryTypes()
  const createType = useCreateInventoryType()
  const options = (data ?? []).map((row) => ({ value: row.value, label: row.name }))
  if (value && !options.some((option) => option.value === value)) options.unshift({ value, label: value })
  async function handleCreate(name) {
    try {
      const row = await createType.mutateAsync({ name })
      onChange(row.value)
      toast.success(`Tipo «${row.name}» disponible`)
    } catch (err) { toast.error(err.message) }
  }
  return (
    <CreatableComboboxField label={label} required={required} error={error} value={value ?? ''} options={options}
      onChange={onChange} onCreate={handleCreate} isCreating={createType.isPending}
      placeholder="Buscar o crear..." searchPlaceholder="Buscar tipo..." />
  )
}

// Marca: InvBrand rows by id; "+ Crear «X»" creates the brand right away.
export function InventoryBrandPicker({ value, onChange, error, required, label = 'Marca' }) {
  const brands = useBrandRows()
  const createBrand = useCreateInventoryBrand()
  const options = brands.map((brand) => ({ value: brand.id, label: brand.name }))
  async function handleCreate(name) {
    try {
      const res = await createBrand.mutateAsync({ name })
      const row = res?.data ?? res
      if (row?.id) onChange(row.id)
      toast.success(`Marca «${name}» creada`)
    } catch (err) { toast.error(err.message || 'No se pudo crear la marca.') }
  }
  return (
    <CreatableComboboxField label={label} required={required} error={error} value={value ?? ''} options={options}
      onChange={onChange} onCreate={handleCreate} isCreating={createBrand.isPending}
      placeholder="Buscar o crear..." searchPlaceholder="Buscar marca..." />
  )
}
