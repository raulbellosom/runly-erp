import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@runly/ui'
import { Button, SelectField, TextField } from '@runly/ui'
import { Home } from 'lucide-react'
import { toast } from 'sonner'

const PAGE_TYPES = [
  { value: 'page',    label: 'Pagina estandar' },
  { value: 'landing', label: 'Landing page' },
  { value: 'system',  label: 'Sistema' },
]

const VISIBILITY_OPTIONS = [
  { value: 'public',        label: 'Publica' },
  { value: 'authenticated', label: 'Solo usuarios autenticados' },
  { value: 'private',       label: 'Privada' },
]

function toSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

const HOMEPAGE_SLUG = 'home'

export default function WebsiteNewPageDialog({ siteId, open, onOpenChange, onCreated }) {
  const { session } = useAuth()
  const token = session?.access_token

  // Check if a homepage already exists for this site
  const homepageCheckQuery = useQuery({
    queryKey: ['homepage-exists', siteId, token],
    queryFn: async () => {
      const res = await fetch(
        `${getApiUrl()}/website/pages/by-path?siteId=${siteId}&routePath=${encodeURIComponent('/')}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) return { data: null }
      return res.json()
    },
    enabled: Boolean(token) && Boolean(siteId) && open,
    staleTime: 30_000,
  })
  const homepageExists = Boolean(homepageCheckQuery.data?.data)

  const [isHomepage, setIsHomepage] = useState(false)
  const [form, setForm] = useState({
    title: '',
    slug: '',
    routePath: '',
    pageType: 'page',
    visibility: 'public',
  })
  const [slugTouched, setSlugTouched] = useState(false)

  // Reset on close
  useEffect(() => {
    if (!open) {
      setIsHomepage(false)
      setSlugTouched(false)
      setForm({ title: '', slug: '', routePath: '', pageType: 'page', visibility: 'public' })
    }
  }, [open])

  // Auto-derive slug from title (unless slug was manually edited or is homepage)
  useEffect(() => {
    if (isHomepage || slugTouched) return
    if (!form.title) return
    const slug = toSlug(form.title) || 'pagina'
    setForm((f) => ({ ...f, slug, routePath: `/${slug}` }))
  }, [form.title, slugTouched, isHomepage])

  // Toggle homepage mode
  function toggleHomepage(checked) {
    setIsHomepage(checked)
    setSlugTouched(false)
    if (checked) {
      setForm((f) => ({ ...f, slug: HOMEPAGE_SLUG, routePath: '/' }))
    } else {
      const slug = toSlug(form.title) || ''
      setForm((f) => ({ ...f, slug, routePath: slug ? `/${slug}` : '' }))
    }
  }

  function handleSlugChange(e) {
    setSlugTouched(true)
    const raw = e.target.value.replace(/[^a-z0-9-]/g, '')
    setForm((f) => ({ ...f, slug: raw, routePath: raw ? `/${raw}` : '' }))
  }

  const canSubmit = form.title.trim() && (isHomepage ? true : form.slug.trim())

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch(`${getApiUrl()}/website/pages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      return res.json()
    },
    onSuccess: (page) => {
      toast.success('Pagina creada')
      onCreated(page)
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message || 'Error al crear la pagina'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!canSubmit) return
    const slug      = isHomepage ? HOMEPAGE_SLUG : form.slug.trim()
    const routePath = isHomepage ? '/' : `/${slug}`
    createMutation.mutate({
      siteId,
      title:      form.title.trim(),
      slug,
      routePath,
      pageType:   form.pageType,
      visibility: form.visibility,
    })
  }

  const routePreview = isHomepage ? '/' : (form.slug ? `/${form.slug}` : '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva pagina</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">

          {/* Homepage toggle */}
          <label
            className={`flex items-center gap-3 p-3 rounded-lg border border-[hsl(var(--border))] transition-colors ${
              homepageExists
                ? 'opacity-60 cursor-not-allowed bg-[hsl(var(--muted)/0.3)]'
                : 'cursor-pointer hover:bg-[hsl(var(--muted)/0.4)]'
            }`}
          >
            <input
              type="checkbox"
              checked={isHomepage}
              onChange={(e) => !homepageExists && toggleHomepage(e.target.checked)}
              disabled={homepageExists}
              className="rounded disabled:cursor-not-allowed"
            />
            <Home size={15} className="text-[hsl(var(--muted-foreground))] shrink-0" />
            <div>
              <p className="text-sm font-medium text-[hsl(var(--foreground))]">Pagina de inicio</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {homepageExists
                  ? 'Ya existe una pagina de inicio para este sitio.'
                  : 'Esta pagina se mostrara en la URL raiz de tu sitio (example.com)'}
              </p>
            </div>
            {homepageExists && (
              <span className="ml-auto text-xs text-[hsl(var(--muted-foreground))] bg-[hsl(var(--muted))] px-2 py-0.5 rounded-full shrink-0">
                Ya existe
              </span>
            )}
          </label>

          <TextField
            label="Titulo"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder={isHomepage ? 'Inicio' : 'Mi pagina'}
            required
            autoFocus
          />

          {!isHomepage && (
            <div className="space-y-1">
              <TextField
                label="Slug (URL)"
                value={form.slug}
                onChange={handleSlugChange}
                placeholder="mi-pagina"
                required
              />
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                URL completa:{' '}
                <span className="font-mono">
                  {routePreview || <span className="opacity-50">escribe el slug arriba</span>}
                </span>
              </p>
            </div>
          )}

          {isHomepage && (
            <div className="rounded-lg bg-[hsl(var(--muted)/0.5)] px-3 py-2.5">
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                URL: <span className="font-mono text-[hsl(var(--foreground))]">/</span>
                <span className="ml-2 opacity-60">(pagina principal del sitio)</span>
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Tipo"
              value={form.pageType}
              onChange={(v) => setForm((f) => ({ ...f, pageType: v }))}
              options={PAGE_TYPES}
            />
            <SelectField
              label="Visibilidad"
              value={form.visibility}
              onChange={(v) => setForm((f) => ({ ...f, visibility: v }))}
              options={VISIBILITY_OPTIONS}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !canSubmit}>
              {createMutation.isPending ? 'Creando...' : 'Crear pagina'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
