import { useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { Button, PageHeader } from '@runly/ui'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { InventorySmartForm } from '../components/InventorySmartForm.jsx'

export default function InventoryIntakeScreen() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const back = () => navigate('/app/m/runly.inventory/inventory')
  return <div className="space-y-6 p-4 pb-24 md:p-6">
    <PageHeader eyebrow="Inventario" title="Registro con IA y captura masiva"
      description="Carga fotos o captura series con tu lector. Revisa los datos de cada equipo antes de crearlos."
      actions={<Button variant="outline" onClick={back}><ArrowLeft className="h-4 w-4" />Volver al inventario</Button>} />
    <InventorySmartForm key={`${activeCompanyId}:${session?.user?.id}`} token={session?.access_token}
      companyId={activeCompanyId} apiBaseUrl={getApiUrl()} onCancel={back} />
  </div>
}
