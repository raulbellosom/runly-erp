import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyDetail, LoadingState, ErrorState, ConfirmDialog, Button } from '@runly/ui'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem, useDeleteInventoryItem } from '../hooks/useInventoryItems.js'
import { INVENTORY_ITEM_DETAIL } from '../blueprints/inventory-item-detail.blueprint.js'
import { componentRegistry } from '../../../lib/moduleComponentRegistry.js'

const API_BASE = getApiUrl()

export default function InventoryItemDetail() {
  const { '*': wildcard } = useParams()
  const id = useMemo(() => (wildcard ?? '').split('/')[1] ?? null, [wildcard])
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const { data, isLoading } = useInventoryItem(id)
  const deleteItem = useDeleteInventoryItem()

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingState />
      </div>
    )
  }

  const item = data?.data ?? data

  if (!item) {
    return (
      <div className="p-6">
        <ErrorState title="Item no encontrado" />
      </div>
    )
  }

  const handleDelete = async () => {
    await deleteItem.mutateAsync(id)
    toast.success('Activo eliminado correctamente')
    navigate('/app/m/runly.inventory/inventory')
  }

  return (
    <div className="p-6 space-y-6">
      <RunlyDetail
        blueprint={INVENTORY_ITEM_DETAIL}
        data={item}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        onBack={() => navigate('/app/m/runly.inventory/inventory')}
        onEdit={() => navigate(`/app/m/runly.inventory/inventory/${id}/edit`)}
        heroActions={
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => navigate('/app/m/runly.inventory/inventory')}>
              Volver
            </Button>
            <Button type="button" size="sm" onClick={() => navigate(`/app/m/runly.inventory/inventory/${id}/edit`)}>
              Editar
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Eliminar
            </Button>
          </div>
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminar activo"
        description={`Esta acción eliminará permanentemente "${item.name}" (${item.assetTag}). No se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
    </div>
  )
}
