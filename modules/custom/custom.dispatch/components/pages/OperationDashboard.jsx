import { useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorState, PageHeader, Skeleton } from '@runly/ui'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileText, ReceiptText } from 'lucide-react'
import { getDispatchSetup } from '../lib/dispatch-api.js'
import { RESOURCE_PATHS } from '../lib/catalog-config.js'
import SetupOverview from '../setup/SetupOverview.jsx'

const QUERY_KEY = ['custom.dispatch', 'setup']
const TICKETS_PATH = '/app/m/custom.dispatch/vales'
const NEW_VOLUME_PATH = '/app/m/custom.dispatch/vales/nueva-volumen'
const NEW_SCALE_PATH = '/app/m/custom.dispatch/vales/nueva-bascula'

function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  )
}

// The real landing page for the module: readiness checklist for the
// catalogs plus quick actions into the ticket pages. It only links to other
// routes — it never renders another section's content inline.
export default function OperationDashboard({ token }) {
  const navigate = useNavigate()

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getDispatchSetup(token),
    enabled: Boolean(token),
  })

  const goToCatalog = useCallback((resource, intent = null) => {
    const path = RESOURCE_PATHS[resource] ?? '/app/m/custom.dispatch/operacion'
    navigate(intent ? `${path}?new=${encodeURIComponent(intent)}` : path)
  }, [navigate])

  return (
    <div className="min-h-full p-4 md:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-screen-2xl space-y-6">
        <PageHeader
          eyebrow="Despachos y báscula"
          title="Configuración operativa"
          description="Administra los sitios, puntos de operación, materiales, responsables y series de folios."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Card variant="bordered">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Nuevo vale por volumen</CardTitle>
              <ReceiptText className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Button className="w-full justify-between" onClick={() => navigate(NEW_VOLUME_PATH)}>
                Crear vale
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>

          <Card variant="bordered">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <CardTitle className="text-base">Nuevo vale con báscula</CardTitle>
              <FileText className="h-5 w-5 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <Button className="w-full justify-between" variant="outline" onClick={() => navigate(NEW_SCALE_PATH)}>
                Crear vale
                <ArrowRight className="h-4 w-4" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <Button variant="ghost" className="w-full justify-between sm:w-auto" onClick={() => navigate(TICKETS_PATH)}>
          Ver todos los vales
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>

        {query.isLoading && <DashboardSkeleton />}
        {query.isError && (
          <ErrorState
            title="No se pudo cargar la configuración"
            description={query.error?.message}
            onRetry={query.refetch}
          />
        )}
        {query.data && <SetupOverview setup={query.data} onGo={goToCatalog} />}
      </div>
    </div>
  )
}
