import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Sparkles, Upload } from 'lucide-react'
import { RunlyTable, Button, ConfirmDialog, PageHeader } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { runly } from '../../../lib/runly.js'
import { useInventoryCategories, useInventoryBrands, useInventoryLocations } from '../hooks/useInventoryCatalogs.js'
import { useInventoryModels } from '../hooks/useInventoryModels.js'
import { ITEM_STATUSES } from '../lib/inventory-constants.js'
import { useMiraiRecordContext, openMiraiSidebar } from '../../runly.chat/lib/miraiPageContext.js'
import { InventoryItemImportDialog } from '../components/InventoryItemImportDialog.jsx'
import { InventoryAdminKpis } from '../components/InventoryAdminKpis.jsx'
import { InventoryAdminTransitionDialog } from '../components/InventoryAdminTransitionDialog.jsx'
import { useInventoryCan, useInventoryConditions, useInventorySummary } from '../hooks/useInventoryAdmin.js'
import { ADMIN_ACTIONS, ADMIN_FILTER_OPTIONS, ADMIN_STATUSES } from '../lib/admin-status.js'

const STATUS_OPTIONS = ITEM_STATUSES.map(s => ({ value: s.value, label: s.label }))
// Deep links from Catálogos (e.g. ?categoryId=...) open the list pre-filtered.
const URL_FILTERS = ['status', 'adminStatus', 'conditionId', 'categoryId', 'brandId', 'locationId', 'modelId', 'createdFrom', 'createdTo']
const ADMIN_OPTIONS = ADMIN_STATUSES.map(s => ({ value: s.value, label: s.label }))

export default function InventoryScreen() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialFilters = useMemo(
    () => Object.fromEntries(URL_FILTERS.map(key => [key, searchParams.get(key)]).filter(([, value]) => value)),
    [searchParams],
  )
  const filterKey = JSON.stringify(initialFilters)
  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()
  const queryClient = useQueryClient()

  const [confirmDelete, setConfirmDelete] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const [bulk, setBulk] = useState(null)
  const can = useInventoryCan()
  const summary = useInventorySummary()
  // Published to the global MirAI sidebar (shared contract: selection =
  // { mode: "filtered" | "selected", ids, filters }) — null when the list has
  // neither a selection nor active filters, so no selection is published.
  const [miraiSelection, setMiraiSelection] = useState(null)
  const updateMiraiSelection = useCallback(({ selectedIds, search, filters }) => {
    const activeFilters = Object.fromEntries(Object.entries({ ...filters, search }).filter(([, value]) => value !== '' && value != null && value !== 'all'))
    const next = selectedIds.length
      ? { mode: 'selected', ids: selectedIds, filters: {} }
      : Object.keys(activeFilters).length
        ? { mode: 'filtered', ids: [], filters: activeFilters }
        : null
    setMiraiSelection(current => JSON.stringify(current) === JSON.stringify(next) ? current : next)
  }, [])
  useMiraiRecordContext({ selection: miraiSelection })

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
  const { data: conditionsData } = useInventoryConditions()
  const conditionOptions = useMemo(
    () => (conditionsData?.data ?? []).map(c => ({ value: c.id, label: c.name })),
    [conditionsData?.data],
  )

  // One bulk action per administrative transition the user may perform,
  // shown only when every selected item is in that action's source status.
  const bulkActions = useMemo(() => Object.entries(ADMIN_ACTIONS)
    .filter(([, action]) => can(action.permission))
    .map(([key, action]) => (rows) => (rows.length && rows.every(r => r.adminStatus === action.from)
      ? { label: action.label, variant: action.destructive ? 'destructive' : undefined, onClick: (selected) => setBulk({ action: key, ids: selected.map(r => r.id) }) }
      : null)), [can])

  // Only needed to label a ?modelId= deep link; the list has no model filter otherwise.
  const { data: modelsData } = useInventoryModels()
  const modelOptions = useMemo(() => (modelsData ?? []).map(m => ({ value: m.id, label: m.name })), [modelsData])

  const blueprint = useMemo(() => ({
    key: 'inventory.items.table',
    schema: {
      apiPath: '/inventory/items',
      primaryField: 'name',
      // List/grid cards show the tag under the item's name.
      subtitleField: 'assetTag',
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
        { field: 'assetTag',       label: 'N.º de activo', sortable: true  },
        { field: 'name',           label: 'Nombre',      sortable: true,  link: true },
        { field: 'categoryName',   label: 'Tipo',        sortable: true  },
        { field: 'brandName',      label: 'Marca',       sortable: true  },
        {
          field: 'status', label: 'Disponibilidad', sortable: true, type: 'select',
          options: STATUS_OPTIONS,
        },
        { field: 'adminStatus',    label: 'Estado',      sortable: true,  type: 'select', options: ADMIN_OPTIONS },
        { field: 'assignedToName', label: 'Responsable', sortable: true  },
        { field: 'conditionName',  label: 'Condición',   sortable: true,  defaultVisible: false },
        { field: 'locationName',   label: 'Ubicacion',   sortable: true,  defaultVisible: false },
        { field: 'serialNumber',   label: 'No. Serie',   sortable: true,  defaultVisible: false },
        { field: 'model',          label: 'Modelo',      sortable: true,  defaultVisible: false },
        { field: 'purchaseDate',   label: 'Compra',      sortable: true,  type: 'date', defaultVisible: false },
        { field: 'warrantyExpiry', label: 'Garantia',    sortable: true,  type: 'date', defaultVisible: false },
        { field: 'createdAt',      label: 'Alta',        sortable: true,  type: 'date', defaultVisible: false },
        { field: 'updatedAt',      label: 'Actualizado', sortable: true,  type: 'date', defaultVisible: false },
      ],
      filters: [
        { key: 'adminStatus', label: 'Estado', type: 'select', options: ADMIN_FILTER_OPTIONS },
        { key: 'status',     label: 'Disponibilidad', type: 'select', options: STATUS_OPTIONS },
        { key: 'conditionId', label: 'Condición', type: 'select', options: conditionOptions },
        { key: 'categoryId', label: 'Tipo', type: 'select', options: categoryOptions },
        { key: 'brandId',    label: 'Marca',     type: 'select', options: brandOptions },
        { key: 'locationId', label: 'Ubicacion', type: 'select', options: locationOptions },
        ...(initialFilters.modelId ? [{ key: 'modelId', label: 'Modelo', type: 'select', options: modelOptions }] : []),
        // -> createdFrom/createdTo and purchaseFrom/purchaseTo on /inventory/items.
        { key: 'created',    label: 'Fecha de alta',   type: 'daterange' },
        { key: 'purchase',   label: 'Fecha de compra', type: 'daterange' },
      ],
      emptyState: { message: 'No hay activos registrados.' },
    },
  }), [categoryOptions, brandOptions, locationOptions, conditionOptions, modelOptions, initialFilters.modelId])

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
          <>
          <Button variant="ghost" onClick={() => openMiraiSidebar()}><Sparkles className="mr-2 h-4 w-4" />Consultar con IA</Button>
          <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="mr-2 h-4 w-4" />Importar</Button>
          <Button variant="outline" onClick={() => navigate('/app/m/runly.inventory/inventory/intake')}><Sparkles className="mr-2 h-4 w-4" />Registro con IA</Button>
          <Button onClick={() => navigate('/app/m/runly.inventory/inventory/new')}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo item
          </Button>
          </>
        }
      />

      <InventoryAdminKpis
        summary={summary.data}
        isLoading={summary.isLoading}
        active={searchParams.get('adminStatus') || null}
        onSelect={(value) => {
          const next = new URLSearchParams(searchParams)
          if (searchParams.get('adminStatus') === value) next.delete('adminStatus')
          else next.set('adminStatus', value)
          setSearchParams(next, { replace: true })
        }}
      />

      <RunlyTable
        key={`${activeCompanyId}:${filterKey}`}
        bulkActions={bulkActions}
        initialFilters={initialFilters}
        onContextChange={updateMiraiSelection}
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


      <InventoryAdminTransitionDialog
        action={bulk?.action}
        ids={bulk?.ids}
        open={Boolean(bulk)}
        onOpenChange={(open) => { if (!open) setBulk(null) }}
        onDone={() => setRefreshSignal(s => s + 1)}
      />

      <InventoryItemImportDialog open={importOpen} onOpenChange={setImportOpen} onImported={() => setRefreshSignal(s => s + 1)} />

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
