import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ErrorState, PageHeader, Skeleton } from '@runly/ui'
import { useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { getDispatchSetup, saveCatalogRecord, setCatalogRecordEnabled } from '../lib/dispatch-api.js'
import { CATALOGS } from '../lib/catalog-config.js'
import CatalogWorkspace from '../setup/CatalogWorkspace.jsx'

const QUERY_KEY = ['custom.dispatch', 'setup']

function CatalogPageSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-12 w-full rounded-2xl" />
      <Skeleton className="h-80 w-full rounded-2xl" />
    </div>
  )
}

// Thin, resource-specific page shell. Each catalog route mounts this with a
// fixed `resource` — there is no control here that lets the user leave the
// page's resource without navigating to a different route.
export default function CatalogPage({ resource, token }) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const config = CATALOGS[resource]
  const createIntent = new URLSearchParams(location.search).get('new')

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getDispatchSetup(token),
    enabled: Boolean(token),
  })

  const mutation = useMutation({
    mutationFn: (operation) => operation(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error) => toast.error(error.message || 'No fue posible guardar el cambio.'),
  })

  function handleSave(record, data, close) {
    mutation.mutate(
      () => saveCatalogRecord({ token, resource, record, data }),
      {
        onSuccess: () => {
          toast.success(record ? 'Registro actualizado.' : 'Registro creado.')
          close?.()
        },
      },
    )
  }

  function handleSetEnabled(record, enabled, close) {
    mutation.mutate(
      () => setCatalogRecordEnabled({ token, resource, id: record.id, enabled }),
      {
        onSuccess: () => {
          toast.success(enabled ? 'Registro reactivado.' : 'Registro desactivado.')
          close?.()
        },
      },
    )
  }

  const clearCreateIntent = useCallback(() => {
    navigate(location.pathname, { replace: true })
  }, [location.pathname, navigate])

  return (
    <div className="min-h-full p-4 md:p-6 xl:p-8">
      <div className="mx-auto w-full max-w-screen-2xl space-y-6">
        <PageHeader eyebrow="Catálogos operativos" title={config.title} description={config.description} />

        {query.isLoading && <CatalogPageSkeleton />}
        {query.isError && (
          <ErrorState
            title="No se pudo cargar la configuración"
            description={query.error?.message}
            onRetry={query.refetch}
          />
        )}

        {query.data && (
          <CatalogWorkspace
            setup={query.data}
            resource={resource}
            createIntent={createIntent}
            onCreateIntentHandled={clearCreateIntent}
            onSave={(_resource, record, data, close) => handleSave(record, data, close)}
            onSetEnabled={(_resource, record, enabled, close) => handleSetEnabled(record, enabled, close)}
            saving={mutation.isPending}
          />
        )}
      </div>
    </div>
  )
}
