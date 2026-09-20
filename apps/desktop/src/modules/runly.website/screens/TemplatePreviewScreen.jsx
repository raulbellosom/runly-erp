import { companyFetch } from '../../../lib/companyFetch.js'
import { useState, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AtlasWebBuilderProvider,
  AtlasWebRenderer,
  baseBlocks,
  serializePage,
  parsePage,
  defaultTheme,
  defineTheme,
} from '@raulbellosom/atlas-web-builder'
import '@raulbellosom/atlas-web-builder/styles'
import { Button } from '@runly/ui'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { allTemplates } from '../../../website/runlyTemplates/index.js'
import {
  universalRunlyBlocks,
  ecommerceRunlyBlocks,
  bookingsRunlyBlocks,
  restaurantRunlyBlocks,
} from '../../../website/runlyBlocks/index.js'

const ALL_BLOCKS = [
  ...baseBlocks,
  ...universalRunlyBlocks,
  ...ecommerceRunlyBlocks,
  ...bookingsRunlyBlocks,
  ...restaurantRunlyBlocks,
]

async function apiFetch(path, token, options = {}) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function routeToSlug(routePath) {
  const clean = routePath
    .replace(/^\//, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
  return clean || 'inicio'
}

function TemplatePagePreview({ page }) {
  const parsedPage = useMemo(() => {
    try {
      return parsePage(serializePage(page))
    } catch {
      return null
    }
  }, [page])

  if (!parsedPage) {
    return (
      <div className="flex items-center justify-center py-32 text-sm text-[hsl(var(--muted-foreground))]">
        Vista previa no disponible.
      </div>
    )
  }

  return (
    <AtlasWebBuilderProvider blocks={ALL_BLOCKS} theme={defaultTheme}>
      <AtlasWebRenderer page={parsedPage} mode="public" />
    </AtlasWebBuilderProvider>
  )
}

export default function TemplatePreviewScreen() {
  const { '*': wildcard } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const token = session?.access_token
  const queryClient = useQueryClient()

  const templateId = wildcard?.match(/^templates\/([^/]+)\/preview$/)?.[1] ?? null
  const template = useMemo(
    () => allTemplates.find((t) => t.id === templateId) ?? null,
    [templateId],
  )

  const [selectedPageIds, setSelectedPageIds] = useState([])

  useEffect(() => {
    if (template) setSelectedPageIds(template.pages.map((p) => p.id))
  }, [template])

  const siteQuery = useQuery({
    queryKey: ['website-site', token],
    queryFn:  () => apiFetch('/website/site', token),
    enabled:  Boolean(token),
    staleTime: 60_000,
  })
  const site = siteQuery.data?.data ?? null

  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!template || !site) throw new Error('Sin plantilla o sitio seleccionado')
      const pagesToCreate = template.pages.filter((p) => selectedPageIds.includes(p.id))
      let firstPageId = null
      let created = 0
      let skipped = 0

      for (const p of pagesToCreate) {
        try {
          const res = await apiFetch('/website/pages', token, {
            method: 'POST',
            body: JSON.stringify({
              siteId:     site.id,
              title:      p.label,
              slug:       routeToSlug(p.routePath),
              routePath:  p.routePath.startsWith('/') ? p.routePath : `/${p.routePath}`,
              pageType:   'page',
              visibility: 'public',
            }),
          })
          const created_ = res.data ?? res
          if (!firstPageId) firstPageId = created_.id
          await apiFetch(`/website/pages/${created_.id}/draft`, token, {
            method: 'POST',
            body: JSON.stringify({ draft_builder_data: serializePage(p.page) }),
          })
          created++
        } catch (err) {
          if (err.message?.includes('ya esta en uso')) skipped++
          else throw err
        }
      }
      if (template.themeTokens) {
        const mergedTokens = {
          ...defaultTheme.tokens,
          color: { ...defaultTheme.tokens?.color, ...template.themeTokens.color },
        }
        const builtTheme = defineTheme({ ...defaultTheme, id: 'atlas-site', name: 'Site Theme', tokens: mergedTokens })
        await apiFetch('/website/theme', token, {
          method: 'POST',
          body: JSON.stringify({ site_id: site.id, tokens: builtTheme.tokens }),
        })
      }

      return { firstPageId, created, skipped }
    },
    onSuccess: ({ firstPageId, created, skipped }) => {
      queryClient.invalidateQueries({ queryKey: ['website-pages'] })
      if (created === 0) {
        const skip = skipped > 0
          ? `${skipped} pagina${skipped !== 1 ? 's' : ''} omitida${skipped !== 1 ? 's' : ''} (ruta ya existe)`
          : 'Ninguna pagina fue creada.'
        toast.info(skip + ' Edítalas directamente desde Páginas.')
        return
      }
      const msg = `${created} pagina${created !== 1 ? 's' : ''} creada${created !== 1 ? 's' : ''}`
      const skip = skipped > 0 ? ` · ${skipped} omitida${skipped !== 1 ? 's' : ''} (ruta ya existe)` : ''
      toast.success(msg + skip)
      if (firstPageId) navigate(`/app/m/runly.website/pages/${firstPageId}/editor`)
      else navigate('/app/m/runly.website/pages')
    },
    onError: (err) => toast.error(err.message),
  })

  if (!template) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Plantilla no encontrada.</p>
        <Button variant="outline" onClick={() => navigate('/app/m/runly.website/templates')}>
          Volver a plantillas
        </Button>
      </div>
    )
  }

  const homePage = template.pages[0]?.page ?? null

  function togglePage(pageId) {
    setSelectedPageIds((prev) =>
      prev.includes(pageId) ? prev.filter((id) => id !== pageId) : [...prev, pageId]
    )
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* Left panel: selection + apply */}
      <div className="w-72 shrink-0 flex flex-col border-r border-[hsl(var(--border))] bg-[hsl(var(--background))] h-full">

        {/* Header */}
        <div className="p-4 border-b border-[hsl(var(--border))]">
          <button
            onClick={() => navigate('/app/m/runly.website/templates')}
            className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors mb-3 cursor-pointer"
          >
            <ArrowLeft size={13} />
            Plantillas
          </button>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: template.color }} />
            <h2 className="font-semibold text-[hsl(var(--foreground))] truncate">{template.label}</h2>
          </div>
          <p className="text-xs text-[hsl(var(--muted-foreground))] leading-relaxed">
            {template.description}
          </p>
        </div>

        {/* Page selection */}
        <div className="flex-1 overflow-y-auto p-4 space-y-1">
          <p className="text-[11px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
            Paginas a crear
          </p>
          {template.pages.map((p) => (
            <label
              key={p.id}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition-colors ${
                p.required ? 'opacity-60' : 'cursor-pointer hover:bg-[hsl(var(--muted)/0.5)]'
              } ${selectedPageIds.includes(p.id) ? 'bg-[hsl(var(--muted)/0.3)]' : ''}`}
            >
              <input
                type="checkbox"
                className="rounded shrink-0"
                checked={selectedPageIds.includes(p.id)}
                disabled={p.required}
                onChange={() => { if (!p.required) togglePage(p.id) }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[hsl(var(--foreground))] truncate">{p.label}</p>
                <p className="text-[11px] text-[hsl(var(--muted-foreground))] font-mono">{p.routePath}</p>
              </div>
              {p.required && (
                <span className="text-[10px] text-white dark:text-amber-300 bg-amber-500 dark:bg-amber-950/40 border border-transparent dark:border-amber-800 rounded px-1.5 py-0.5 shrink-0">
                  base
                </span>
              )}
            </label>
          ))}
        </div>

        {/* Apply footer */}
        <div className="p-4 border-t border-[hsl(var(--border))] space-y-2">
          {!site && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              Configura tu sitio primero para aplicar plantillas.
            </p>
          )}
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">
            Las rutas ya existentes seran omitidas.
          </p>
          <Button
            className="w-full"
            onClick={() => applyMutation.mutate()}
            disabled={applyMutation.isPending || selectedPageIds.length === 0 || !site}
          >
            {applyMutation.isPending
              ? 'Creando paginas...'
              : `Aplicar — ${selectedPageIds.length} pagina${selectedPageIds.length !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>

      {/* Right panel: full-width preview, scrollable */}
      <div className="flex-1 overflow-y-auto bg-white relative">
        <div className="absolute top-3 right-4 z-10 bg-black/50 backdrop-blur-sm text-white text-[11px] px-3 py-1 rounded-full pointer-events-none">
          Vista previa — pagina de inicio
        </div>
        {homePage && <TemplatePagePreview page={homePage} />}
      </div>

    </div>
  )
}
