import { useMemo, useRef, useState } from 'react'
import { ComboboxField } from '@runly/ui'
import { Building2 } from 'lucide-react'
import { useSuppliers } from '../hooks/usePurchases.js'

// Supplier = a contact from the directory (runly.contacts). Remote search over
// GET /purchases/suppliers; the chosen supplier stays in the options so its
// label survives new searches.
export function SupplierField({ value, selected, onChange, label = 'Proveedor', placeholder = 'Buscar proveedor...', error, hint, required, clearable = true, className, triggerClassName }) {
  const [search, setSearch] = useState('')
  const query = useSuppliers({ search: search || undefined, pageSize: 20 })
  const known = useRef(new Map())
  const rows = useMemo(() => query.data?.data ?? [], [query.data?.data])
  rows.forEach((row) => known.current.set(row.id, row))
  if (selected?.id) known.current.set(selected.id, selected)

  const options = useMemo(() => {
    const list = rows.map((row) => ({
      value: row.id,
      label: row.name,
      description: [row.taxId, row.profile?.supplierCode].filter(Boolean).join(', ') || row.email || undefined,
      avatar: { name: row.name, src: row.avatarUrl ?? undefined },
    }))
    const current = value && known.current.get(value)
    if (current && !list.some((o) => o.value === value)) list.unshift({ value, label: current.name ?? current.label, avatar: { name: current.name, src: current.avatarUrl ?? undefined } })
    return list
  }, [rows, value])

  return (
    <ComboboxField
      label={label}
      required={required}
      error={error}
      hint={hint}
      icon={Building2}
      className={className}
      triggerClassName={triggerClassName}
      options={options}
      value={value ?? ''}
      onChange={(next) => onChange?.(next || null, next ? known.current.get(next) ?? null : null)}
      onSearchChange={setSearch}
      filter={false}
      loading={query.isFetching && !rows.length}
      loadError={query.isError ? 'No se pudieron cargar los proveedores' : null}
      onRetry={() => query.refetch()}
      placeholder={placeholder}
      searchPlaceholder="Nombre, RFC o código"
      emptyText="Sin proveedores"
      emptyDescription="Los proveedores son contactos del directorio."
      missingLabel="Proveedor"
      clearable={clearable}
    />
  )
}
