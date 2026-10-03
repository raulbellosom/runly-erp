import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader, ErrorState, Button, ConfirmDialog, FormSkeleton } from '@runly/ui'
import { Eye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useInventoryItem, useDeleteInventoryItem } from '../hooks/useInventoryItems.js'
import { buildItemFormBlueprint } from '../blueprints/inventory-item-form.blueprint.js'
import { inventoryFormComponents } from '../components/InventoryItemClassification.jsx'
import { InventoryCaptureTools } from '../components/InventoryCaptureTools.jsx'
import { MAX_BULK_SERIALS, bulkUnitName, canPinField, captureStorageKey, loadCapture, parseSerials } from '../lib/capture.js'
import { intakeRequest } from '../lib/intake.js'
import { ConnectedRunlyForm } from '../../../shell/connections/ConnectedRunlyForm.jsx'

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

  const { session } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const queryClient = useQueryClient()
  // Capture settings (pinned fields, continuous, bulk by serial) live in this browser.
  const storageKey = captureStorageKey(activeCompanyId, session?.user?.id)
  const [settings, setSettings] = useState(() => loadCapture(storageKey))
  const [formKey, setFormKey] = useState(0)
  const [serialsText, setSerialsText] = useState('')
  useEffect(() => { setSettings(loadCapture(storageKey)); setFormKey((k) => k + 1) }, [storageKey])
  // Re-read on every new blank form so the latest pinned values prefill it.
  const createInitial = useMemo(() => loadCapture(storageKey).values, [storageKey, formKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submitBulk({ payload }) {
    const { serials } = parseSerials(serialsText)
    if (!serials.length) throw new Error('Escribe al menos un número de serie.')
    if (serials.length > MAX_BULK_SERIALS) throw new Error(`Máximo ${MAX_BULK_SERIALS} series por captura.`)
    const key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
    const partNumber = payload.partNumber ?? null
    const body = {
      key,
      common: payload,
      units: serials.map((serialNumber) => ({
        serialNumber,
        name: bulkUnitName(payload.name, serialNumber),
        // The user typed these serials, so they count as confirmed.
        confirmedIdentifiers: { serialNumber, partNumber, assetTag: null },
      })),
    }
    const request = (path) => intakeRequest({ apiBaseUrl: API_BASE, token, companyId: activeCompanyId, path, body })
    const checked = await request('/inventory/items/validate-batch')
    if (!checked.valid) {
      const bad = [...new Set(checked.issues.filter((i) => i.field === 'serialNumber').map((i) => serials[i.index]))]
      throw new Error(bad.length
        ? `Estas series ya existen: ${bad.slice(0, 10).join(', ')}${bad.length > 10 ? '…' : ''}. Quítalas y vuelve a guardar.`
        : (checked.issues[0]?.message ?? 'Revisa la captura.'))
    }
    const result = await request('/inventory/items/bulk')
    void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    return { data: result, bulk: true }
  }

  const itemQuery = useInventoryItem(isEdit ? id : null)
  const editItem = itemQuery.data?.data ?? itemQuery.data ?? null
  // Legacy purchase fields only stay editable on items that already carry them;
  // new commercial data is recorded in Compras.
  const showLegacyPurchase = Boolean(isEdit && editItem?.hasLegacyPurchaseData)
  const blueprint = useMemo(() => buildItemFormBlueprint(isEdit, { showLegacyPurchase }), [isEdit, showLegacyPurchase])
  const deleteItem = useDeleteInventoryItem()

  if (isEdit && itemQuery.isLoading) {
    return <div className="p-4 md:p-6"><FormSkeleton sections={4} /></div>
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
        <ConnectedRunlyForm
          targetType="inventory_item"
          targetId={id}
          key={isEdit ? 'edit' : `create-${formKey}`}
          blueprint={blueprint}
          initialData={isEdit ? editItem : createInitial}
          submitRequest={!isEdit && settings.multi ? submitBulk : null}
          fieldPins={isEdit ? null : {
            pinned: settings.pinned,
            visible: settings.pinMode,
            canPin: canPinField,
            onToggle: (names, pin) => setSettings((prev) => ({
              ...prev,
              pinned: pin ? [...new Set([...prev.pinned, ...names])] : prev.pinned.filter((name) => !names.includes(name)),
            })),
          }}
          renderTools={isEdit ? null : (tools) => (
            <InventoryCaptureTools {...tools} settings={settings} setSettings={setSettings} storageKey={storageKey}
              serialsText={serialsText} setSerialsText={setSerialsText} />
          )}
          mode={isEdit ? 'edit' : 'create'}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          componentRegistry={inventoryFormComponents}
          asideActions={
            isEdit && editItem?.id ? (
              <div className="glass-shell-flat flex flex-col gap-2 rounded-2xl p-3 sm:flex-row sm:items-stretch xl:flex-col">
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
            if (!isEdit && (result?.bulk || settings.continuous)) {
              const count = result?.data?.items?.length
              toast.success(result?.bulk ? `${count} activos creados` : (result?.data?.assetTag ? `Activo ${result.data.assetTag} creado` : 'Activo creado'))
              if (settings.continuous) { setSerialsText(''); setFormKey((k) => k + 1); return }
              navigate('/app/m/runly.inventory/inventory')
              return
            }
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
