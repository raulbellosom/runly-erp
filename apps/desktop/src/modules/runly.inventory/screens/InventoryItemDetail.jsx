import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyDetail, ErrorState, ConfirmDialog, DetailActionBar, Button, DetailSkeleton } from '@runly/ui'
import { ArrowLeft, PowerOff, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem, useDeleteInventoryItem } from '../hooks/useInventoryItems.js'
import { INVENTORY_ITEM_DETAIL } from '../blueprints/inventory-item-detail.blueprint.js'
import { componentRegistry } from '../../../lib/moduleComponentRegistry.js'
import { CanvasReferences } from '../../runly.canvas/components/CanvasReferences.jsx'
import { ConnectionSections } from '../../../shell/connections/ConnectionSections.jsx'
import { useMiraiRecordContext, openMiraiSidebar } from '../../runly.chat/lib/miraiPageContext.js'

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
  const item = data?.data ?? data
  useMiraiRecordContext({ recordType: 'item', recordId: id, label: item?.name })

  if (isLoading) {
    return (
      <div className="p-4 md:p-6">
        <DetailSkeleton />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="Item no encontrado" />
      </div>
    )
  }

  // A deregistered item is read-only (the API refuses edits too).
  const readOnly = item.adminStatus === 'deregistered'

  const handleDelete = async () => {
    await deleteItem.mutateAsync(id)
    toast.success('Activo desactivado', { description: 'Puedes reactivarlo o eliminarlo definitivamente en Desactivados.' })
    navigate('/app/m/runly.inventory/inventory')
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <Button variant="outline" onClick={() => openMiraiSidebar()}><Sparkles className="mr-2 h-4 w-4" />Consultar este equipo con IA</Button>
      <RunlyDetail
        blueprint={INVENTORY_ITEM_DETAIL}
        data={item}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        onBack={() => navigate('/app/m/runly.inventory/inventory')}
        onEdit={readOnly ? undefined : () => navigate(`/app/m/runly.inventory/inventory/${id}/edit`)}
        mainExtra={<ConnectionSections targetType="inventory_item" targetId={id} />}
        asideExtra={<CanvasReferences moduleKey="runly.inventory" entityType="inventory_item" entityId={id} />}
        heroActions={
          <DetailActionBar
            primary={readOnly ? undefined : {
              label: 'Editar',
              onClick: () => navigate(`/app/m/runly.inventory/inventory/${id}/edit`),
            }}
            secondary={[
              {
                label: 'Volver',
                icon: <ArrowLeft className="h-4 w-4" />,
                onClick: () => navigate('/app/m/runly.inventory/inventory'),
              },
              {
                label: 'Desactivar',
                icon: <PowerOff className="h-4 w-4" />,
                onClick: () => setDeleteOpen(true),
                destructive: true,
              },
            ]}
          />
        }
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Desactivar activo"
        description={`"${item.name}" (${item.assetTag}): Dejará de mostrarse en el inventario; sus datos se conservan. Podrás reactivarlo o eliminarlo definitivamente en Inventario > Desactivados.`}
        confirmLabel="Desactivar"
        onConfirm={handleDelete}
      />
    </div>
  )
}
