import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyForm, PageHeader, LoadingState, ErrorState, Button, ConfirmDialog } from '@runly/ui'
import { Eye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem, useDeleteInventoryItem } from '../hooks/useInventoryItems.js'
import { useInventoryFormBlueprint } from '../hooks/useInventoryFormBlueprint.js'

const API_BASE = getApiUrl()

export default function InventoryItemForm() {
  const blueprint = useInventoryFormBlueprint()
  const { '*': wildcard } = useParams()
  const id = useMemo(() => {
    const parts = (wildcard ?? '').split('/')
    return parts[2] === 'edit' ? parts[1] : null
  }, [wildcard])
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)

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
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={blueprint}
          initialData={isEdit ? editItem : {}}
          mode={isEdit ? 'edit' : 'create'}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          asideActions={
            isEdit && editItem?.id ? (
              <div className="glass-shell flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-stretch xl:flex-col">
                <Button
                  type="button"
                  variant="glass"
                  className="justify-start sm:justify-center xl:justify-start"
                  onClick={() => navigate(`/app/m/runly.inventory/inventory/${id}`)}
                >
                  <Eye className="h-4 w-4" />
                  Ver activo
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="justify-start sm:justify-center xl:justify-start"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar activo
                </Button>
              </div>
            ) : null
          }
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
