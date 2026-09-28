import { useMemo, useState } from 'react'
import { DataTable, resolveLucideIcon } from '@runly/ui'
import { Boxes, Package } from 'lucide-react'
import { toast } from 'sonner'
import { useInventoryModels, useDeleteInventoryModel } from '../../hooks/useInventoryModels.js'
import { InventoryModelDialog } from '../InventoryModelDialog.jsx'
import { CatalogPanel } from './CatalogPanel.jsx'
import { CatalogRowActions } from './CatalogRowActions.jsx'

export function ModelsPanel({ onImport }) {
  const { data: rows = [], isLoading, isError, refetch } = useInventoryModels()
  const remove = useDeleteInventoryModel()
  const [dialog, setDialog] = useState(null) // { model } | {} | null

  const filters = useMemo(() => {
    const unique = (pairs) => [...new Map(pairs.filter(([id]) => id)).entries()].map(([value, label]) => ({ value, label }))
    return [
      { key: 'typeId', label: 'Tipo', options: unique(rows.map((r) => [r.typeId, r.typeName])) },
      { key: 'brandId', label: 'Marca', options: unique(rows.map((r) => [r.brandId, r.brandName])) },
    ]
  }, [rows])

  const columns = [
    { id: 'type', header: 'Tipo', accessorFn: (r) => r.typeName ?? '', cell: ({ row }) => {
      const Icon = resolveLucideIcon(row.original.typeIcon) ?? Package
      const color = row.original.typeColor ?? '#7c3aed'
      return (
        <span className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}22`, color }}><Icon className="h-3.5 w-3.5" /></span>
          {row.original.typeName}
        </span>
      )
    } },
    { accessorKey: 'name', header: 'Modelo', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    { accessorKey: 'brandName', header: 'Marca' },
    { accessorKey: 'year', header: 'Año' },
    { accessorKey: 'itemCount', header: 'Activos' },
    { id: 'actions', header: '', enableSorting: false, cell: ({ row }) => (
      <CatalogRowActions name={row.original.name} onEdit={() => setDialog({ model: row.original })}
        onDelete={() => remove.mutateAsync(row.original.id).then(() => toast.success('Modelo eliminado')).catch((err) => toast.error(err.message))} />
    ) },
  ]

  return (
    <CatalogPanel catalogKey="models" createLabel="Nuevo modelo" onCreate={() => setDialog({})} onImport={onImport}>
      <DataTable columns={columns} data={rows} filters={filters} isLoading={isLoading} isError={isError} onRetry={refetch}
        getRowId={(row) => row.id} searchPlaceholder="Buscar por nombre, marca, tipo o año..." emptyTitle="Sin modelos"
        emptyDescription="Crea un modelo o importa una lista." emptyIcon={Boxes} emptyAction={{ label: 'Nuevo modelo', onClick: () => setDialog({}) }} />
      <InventoryModelDialog open={Boolean(dialog)} onOpenChange={(value) => { if (!value) setDialog(null) }} model={dialog?.model ?? null} />
    </CatalogPanel>
  )
}
