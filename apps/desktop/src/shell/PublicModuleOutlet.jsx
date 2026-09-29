import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { EmptyState, ErrorState, Skeleton } from '@runly/ui'
import { Package } from 'lucide-react'
import { componentRegistry } from '../lib/moduleComponentRegistry'
import { normalizePath } from '../lib/pathUtils'
import { getApiUrl } from '../lib/runtimeConfig.js'
import { loadBundle } from './ModuleBundleLoader.jsx'

export function PublicModuleOutlet() {
  const location = useLocation()
  const navigate = useNavigate()

  const blueprintsQuery = useQuery({
    queryKey: ['public-blueprints'],
    queryFn: async () => {
      const res = await fetch(`${getApiUrl()}/public/blueprints`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const rows = useMemo(
    () => (Array.isArray(blueprintsQuery.data?.data) ? blueprintsQuery.data.data : []),
    [blueprintsQuery.data]
  )

  // Exact path match, or a public view path followed by one extra segment: the
  // public-link token (spec 2026-09-28-module-public-links-design.md).
  const { matchedBlueprint, linkToken } = useMemo(() => {
    const normalizedPathname = normalizePath(location.pathname)
    const exact = rows.find((row) => normalizePath(row?.schema?.path) === normalizedPathname)
    if (exact) return { matchedBlueprint: exact, linkToken: null }
    const slash = normalizedPathname.lastIndexOf('/')
    const parent = normalizedPathname.slice(0, slash)
    const token = normalizedPathname.slice(slash + 1)
    const byPrefix = parent ? rows.find((row) => normalizePath(row?.schema?.path) === parent) : null
    return byPrefix && token ? { matchedBlueprint: byPrefix, linkToken: token } : { matchedBlueprint: null, linkToken: null }
  }, [rows, location.pathname])

  const linkApiBaseUrl = matchedBlueprint && linkToken
    ? `${getApiUrl()}/public/m/${encodeURIComponent(matchedBlueprint.moduleKey)}/${encodeURIComponent(linkToken)}`
    : null

  // Anonymous visitors never ran ModuleBundleLoader: load the module bundle
  // (bundle.js is served without auth) when the component is not registered yet.
  const componentKey = matchedBlueprint?.schema?.component ?? null
  const bundleQuery = useQuery({
    queryKey: ['public-module-bundle', matchedBlueprint?.moduleKey],
    enabled: Boolean(componentKey) && !componentRegistry.resolve(componentKey),
    queryFn: () => loadBundle(matchedBlueprint.moduleKey, null),
    staleTime: Infinity,
    retry: 0,
  })

  const contextQuery = useQuery({
    queryKey: ['public-link-context', linkApiBaseUrl],
    enabled: Boolean(linkApiBaseUrl),
    queryFn: async () => {
      const res = await fetch(`${linkApiBaseUrl}/_context`)
      if (res.status === 404 || res.status === 410) return { unavailable: true }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()).data
    },
    retry: 1,
  })

  if (blueprintsQuery.isLoading || contextQuery.isLoading || bundleQuery.isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-4 w-64" />
      </div>
    )
  }

  if (blueprintsQuery.isError) {
    return (
      <div className="p-6">
        <ErrorState
          title="No se pudo cargar la vista"
          description="Verifica tu conexión e intenta de nuevo."
          onRetry={() => blueprintsQuery.refetch()}
        />
      </div>
    )
  }

  if (!matchedBlueprint) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Package}
          title="Vista pública no encontrada"
          description="Esta ruta no tiene una vista pública configurada."
        />
      </div>
    )
  }

  const CustomComponent = componentKey ? componentRegistry.resolve(componentKey) : null

  if (!CustomComponent) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Package}
          title="Componente no disponible"
          description={`El componente "${componentKey ?? 'desconocido'}" no está en el bundle actual.`}
        />
      </div>
    )
  }

  if (linkToken && (contextQuery.isError || contextQuery.data?.unavailable)) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Package}
          title="Enlace no disponible"
          description="Este enlace venció, fue revocado o ya no admite más respuestas."
        />
      </div>
    )
  }

  return (
    <CustomComponent
      navigate={navigate}
      moduleKey={matchedBlueprint.moduleKey}
      {...(linkToken
        ? { linkToken, apiBaseUrl: linkApiBaseUrl, publicLink: contextQuery.data ?? null }
        : {})}
    />
  )
}
