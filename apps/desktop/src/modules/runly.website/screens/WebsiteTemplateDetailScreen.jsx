import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.website/screens/WebsiteTemplateDetailScreen.jsx
import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { PageHeader, Button, Badge, ConfirmDialog } from '@runly/ui'
import { ArrowLeft, LayoutTemplate } from 'lucide-react'
import { allTemplates } from '../../../website/runlyTemplates/index.js'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { toast } from 'sonner'

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

export default function WebsiteTemplateDetailScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { session } = useAuth()
  const token = session?.access_token
  const [confirmOpen, setConfirmOpen] = useState(false)

  const tpl = allTemplates.find((t) => t.id === id)

  const siteQuery = useQuery({
    queryKey: ['website-site', token],
    queryFn:  () => apiFetch('/website/site', token),
    enabled:  Boolean(token),
    staleTime: 60_000,
  })
  const site = siteQuery.data?.data ?? null

  const pagesQuery = useQuery({
    queryKey: ['website-pages-count', site?.id],
    queryFn:  () => apiFetch(`/website/pages?siteId=${site.id}&pageSize=1`, token),
    enabled:  Boolean(token) && Boolean(site?.id),
    staleTime: 60_000,
  })
  const hasPages = (pagesQuery.data?.total ?? 0) > 0

  if (!tpl) {
    return (
      <div className="p-4 md:p-6">
        <p className="text-muted-foreground">Plantilla no encontrada.</p>
      </div>
    )
  }

  const confirmDescription = hasPages
    ? `Esto reemplazara las paginas actuales con las paginas de la plantilla "${tpl.label}". Los contenidos existentes se perderan.`
    : `Se crearan ${tpl.pages.length} pagina${tpl.pages.length !== 1 ? 's' : ''} con la plantilla "${tpl.label}".`

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/app/m/runly.website/templates')}>
          <ArrowLeft size={14} className="mr-1"/>
          Plantillas
        </Button>
      </div>
      <PageHeader
        eyebrow="Runly Website"
        title={tpl.label}
        description={tpl.description}
        actions={
          <Button onClick={() => setConfirmOpen(true)}>
            <LayoutTemplate size={14} className="mr-1.5"/>
            Usar esta plantilla
          </Button>
        }
      />
      <div className="flex gap-2 flex-wrap">
        {tpl.pages.map((p) => (
          <Badge key={p.id} variant="secondary">{p.label}</Badge>
        ))}
      </div>
      <div
        className="rounded-xl border border-border bg-muted overflow-hidden"
        style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <div className="text-center text-muted-foreground p-8">
          <LayoutTemplate size={48} className="mx-auto mb-3 opacity-30"/>
          <p className="text-sm">Vista previa disponible en el editor</p>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Usar esta plantilla"
        description={confirmDescription}
        confirmLabel="Usar plantilla"
        onConfirm={() => {
          toast.info('Aplicar plantilla — proximamente')
          setConfirmOpen(false)
        }}
      />
    </div>
  )
}
