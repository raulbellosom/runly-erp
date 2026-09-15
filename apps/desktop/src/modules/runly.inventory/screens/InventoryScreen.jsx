import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus } from 'lucide-react'
import { RunlyTable, Button, ConfirmDialog, PageHeader } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { runly } from '../../../lib/runly.js'
import { useInventoryCategories, useInventoryBrands, useInventoryLocations } from '../hooks/useInventoryCatalogs.js'
import { ITEM_STATUSES } from '../lib/inventory-constants.js'

const STATUS_OPTIONS = ITEM_STATUSES.map(s => ({ value: s.value, label: s.label }))

export default function InventoryScreen() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()
  const queryClient = useQueryClient()

  const [confirmDelete, setConfirmDelete] = useState(null)
  const [refreshSignal, setRefreshSignal] = useState(0)

  const { data: categoriesData } = useInventoryCategories()
  const { data: brandsData } = useInventoryBrands()
  const { data: locationsData } = useInventoryLocations()

  const categoryOptions = useMemo(
    () => (categoriesData?.data ?? []).map(c => ({ value: c.id, label: c.name })),
    [categoriesData?.data],
  )
  const brandOptions = useMemo(
    () => (brandsData?.data ?? []).map(b => ({ value: b.id, label: b.name })),
    [brandsData?.data],
  )
  const locationOptions = useMemo(
    () => (locationsData?.data ?? []).map(l => ({ value: l.id, label: l.name })),
    [locationsData?.data],
  )

  const blueprint = useMemo(() => ({
    key: 'inventory.items.table',
    schema: {
      apiPath: '/inventory/items',
      primaryField: 'name',
      searchable: true,
      searchPlaceholder: 'Buscar item...',
      columns: [
        {
          field: 'coverImageFileId',
          label: 'Imagen',
          type: 'image-asset',
          sortable: false,
          imagesApiPath: '/inventory/items/:id/files',
        },
        { field: 'assetTag',       label: 'Tag',         sortable: true  },
        { field: 'name',           label: 'Nombre',      sortable: true,  link: true },
        { field: 'categoryName',   label: 'Categoria',   sortable: false },
        { field: 'brandName',      label: 'Marca',       sortable: false },
        {
          field: 'status', label: 'Estado', sortable: true, type: 'select',
          options: STATUS_OPTIONS,
        },
        { field: 'assignedToName', label: 'Responsable', sortable: false },
        { field: 'locationName',   label: 'Ubicacion',   sortable: false, defaultVisible: false },
        { field: 'serialNumber',   label: 'No. Serie',   sortable: false, defaultVisible: false },
        { field: 'model',          label: 'Modelo',      sortable: false, defaultVisible: false },
        { field: 'purchaseDate',   label: 'Compra',      sortable: true,  type: 'date', defaultVisible: false },
        { field: 'warrantyExpiry', label: 'Garantia',    sortable: true,  type: 'date', defaultVisible: false },
        { field: 'updatedAt',      label: 'Actualizado', sortable: true,  type: 'date', defaultVisible: false },
      ],
      filters: [
        { key: 'status',     label: 'Estado',    type: 'select', options: STATUS_OPTIONS },
        { key: 'categoryId', label: 'Categoria', type: 'select', options: categoryOptions },
        { key: 'brandId',    label: 'Marca',     type: 'select', options: brandOptions },
        { key: 'locationId', label: 'Ubicacion', type: 'select', options: locationOptions },
      ],
      emptyState: { message: 'No hay activos registrados.' },
    },
  }), [categoryOptions, brandOptions, locationOptions])

  const deleteMutation = useMutation({
    mutationFn: id => runly.inventory.deleteItem(id, token),
    onSuccess: () => {
      setConfirmDelete(null)
      setRefreshSignal(s => s + 1)
      queryClient.invalidateQueries({ queryKey: ['inventory', 'items'] })
      toast.success('Activo eliminado')
    },
    onError: err => toast.error(err?.message ?? 'No se pudo eliminar el activo'),
  })

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly Inventario"
        title="Inventario"
        description="Gestiona y rastrea todos los activos de la empresa"
        actions={
          <Button onClick={() => navigate('/app/m/runly.inventory/inventory/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo item
          </Button>
        }
      />

      <RunlyTable
        blueprint={blueprint}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={getApiUrl()}
        onView={row => {
          queryClient.prefetchQuery({
            queryKey: ['inventory', 'items', row.id],
            queryFn: () => runly.inventory.getItem(row.id, token),
            staleTime: 5 * 60 * 1000,
          })
          navigate(`/app/m/runly.inventory/inventory/${row.id}`)
        }}
        onEdit={row => navigate(`/app/m/runly.inventory/inventory/${row.id}/edit`)}
        onDelete={row => setConfirmDelete(row)}
        refreshSignal={refreshSignal}
      />

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={v => !v && setConfirmDelete(null)}
        title="Eliminar activo"
        description="El activo sera desactivado. Esta accion no se puede deshacer facilmente."
        detail={confirmDelete ? `${confirmDelete.assetTag} — ${confirmDelete.name}` : ''}
        confirmLabel="Eliminar"
        onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
