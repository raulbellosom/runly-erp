import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyForm, PageHeader, LoadingState, ErrorState, FormCompletionRing, Button, ConfirmDialog } from '@runly/ui'
import { Eye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem, useDeleteInventoryItem } from '../hooks/useInventoryItems.js'
import { INVENTORY_ITEM_FORM } from '../blueprints/inventory-item-form.blueprint.js'

const API_BASE = getApiUrl()

export default function InventoryItemForm() {
  const { '*': wildcard } = useParams()
  const id = useMemo(() => {
    const parts = (wildcard ?? '').split('/')
    return parts[2] === 'edit' ? parts[1] : null
  }, [wildcard])
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [completion, setCompletion] = useState({ percent: 0, filledCount: 0, totalCount: 0 })

  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const itemQuery = useInventoryItem(isEdit ? id : null)
  const editItem = itemQuery.data?.data ?? itemQuery.data ?? null
  const deleteItem = useDeleteInventoryItem()

  if (isEdit && itemQuery.isLoading) {
    return <LoadingState message="Cargando activo..." />
  }
  if (isEdit && itemQuery.isError) {
    return <ErrorState message="No se pudo cargar el activo" />
  }

  const handleDelete = async () => {
    await deleteItem.mutateAsync(id)
    toast.success('Activo eliminado correctamente')
    navigate('/app/m/runly.inventory/inventory')
  }

  return (
    <div className="p-4 md:p-6 pb-24">
      <PageHeader
        eyebrow={isEdit ? 'Editar activo' : 'Inventario'}
        title={isEdit ? (editItem?.name || 'Editar activo') : 'Nuevo activo'}
        description={isEdit ? undefined : 'Completa la información del activo'}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <FormCompletionRing
              percent={completion.percent}
              filledCount={completion.filledCount}
              totalCount={completion.totalCount}
            />
            {isEdit && editItem?.id ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/app/m/runly.inventory/inventory/${id}`)}
                >
                  <Eye className="mr-1.5 h-3.5 w-3.5" />
                  Ver
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Eliminar
                </Button>
              </div>
            ) : null}
          </div>
        }
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={INVENTORY_ITEM_FORM}
          initialData={isEdit ? editItem : {}}
          mode={isEdit ? 'edit' : 'create'}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          onCompletionChange={setCompletion}
          onSuccess={(result) => {
            const savedId = result?.data?.id ?? editItem?.id
            navigate(savedId ? `/app/m/runly.inventory/inventory/${savedId}` : '/app/m/runly.inventory/inventory')
          }}
          onCancel={() => navigate(-1)}
        />
      </div>

      {isEdit && editItem ? (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title="Eliminar activo"
          description={`Esta acción eliminará permanentemente "${editItem.name}" (${editItem.assetTag}). No se puede deshacer.`}
          confirmLabel="Eliminar"
          onConfirm={handleDelete}
        />
      ) : null}
    </div>
  )
}
