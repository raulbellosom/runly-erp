import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { RunlyForm, PageHeader, LoadingState, ErrorState } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem } from '../hooks/useInventoryItems.js'
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

  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const itemQuery = useInventoryItem(isEdit ? id : null)
  const editItem = itemQuery.data?.data ?? itemQuery.data ?? null

  if (isEdit && itemQuery.isLoading) {
    return <LoadingState message="Cargando activo..." />
  }
  if (isEdit && itemQuery.isError) {
    return <ErrorState message="No se pudo cargar el activo" />
  }

  const title = isEdit ? 'Editar activo' : 'Nuevo activo'

  return (
    <div className="p-4 md:p-6 pb-24">
      <PageHeader
        title={title}
        subtitle={isEdit ? (editItem?.name ?? '') : 'Completa la información del activo'}
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={INVENTORY_ITEM_FORM}
          initialData={isEdit ? editItem : {}}
          mode={isEdit ? 'edit' : 'create'}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          onSuccess={(result) => {
            const savedId = result?.data?.id ?? editItem?.id
            navigate(savedId ? `/app/m/runly.inventory/inventory/${savedId}` : '/app/m/runly.inventory/inventory')
          }}
          onCancel={() => navigate(-1)}
        />
      </div>
    </div>
  )
}
