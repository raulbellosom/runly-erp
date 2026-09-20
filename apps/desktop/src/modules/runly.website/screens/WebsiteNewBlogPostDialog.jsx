import { companyFetch } from '../../../lib/companyFetch.js'
import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import {
  Button, SelectField, TextareaField, TextField,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@runly/ui'
import { toast } from 'sonner'

function toSlug(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export default function WebsiteNewBlogPostDialog({ siteId, open, onOpenChange, onCreated }) {
  const { session } = useAuth()
  const token = session?.access_token

  const [form, setForm] = useState({ title: '', slug: '', categoryId: '', excerpt: '' })
  const [slugTouched, setSlugTouched] = useState(false)

  useEffect(() => {
    if (!open) {
      setForm({ title: '', slug: '', categoryId: '', excerpt: '' })
      setSlugTouched(false)
    }
  }, [open])

  useEffect(() => {
    if (!slugTouched && form.title) {
      setForm((f) => ({ ...f, slug: toSlug(f.title) }))
    }
  }, [form.title, slugTouched])

  const catsQuery = useQuery({
    queryKey: ['blog-categories', siteId, token],
    queryFn: async () => {
      const res = await companyFetch(`${getApiUrl()}/website/blog/categories?siteId=${siteId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) return { data: [] }
      return res.json()
    },
    enabled: Boolean(token) && Boolean(siteId) && open,
    staleTime: 60_000,
  })
  const categories = catsQuery.data?.data ?? []

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await companyFetch(`${getApiUrl()}/website/blog/posts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
      return res.json()
    },
    onSuccess: (post) => {
      toast.success('Entrada creada')
      onCreated(post)
      onOpenChange(false)
    },
    onError: (err) => toast.error(err.message || 'Error al crear la entrada'),
  })

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim() || !form.slug.trim()) return
    createMutation.mutate({
      siteId,
      title:      form.title.trim(),
      slug:       form.slug.trim(),
      categoryId: form.categoryId || null,
      excerpt:    form.excerpt.trim() || undefined,
    })
  }

  const categoryOptions = [
    { value: '', label: '— Sin categoria —' },
    ...categories.map((cat) => ({ value: cat.id, label: cat.name })),
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva entrada de blog</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <TextField
            label="Titulo"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="Mi primera entrada"
            required
            autoFocus
          />

          <div className="space-y-1">
            <TextField
              label="Slug"
              value={form.slug}
              onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: e.target.value })) }}
              placeholder="mi-primera-entrada"
              required
            />
            <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">/blog/{form.slug}</p>
          </div>

          {categories.length > 0 && (
            <SelectField
              label="Categoria (opcional)"
              value={form.categoryId}
              onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
              options={categoryOptions}
            />
          )}

          <TextareaField
            label="Resumen (opcional)"
            value={form.excerpt}
            onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
            rows={2}
            placeholder="Breve descripcion de la entrada..."
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createMutation.isPending || !form.title.trim() || !form.slug.trim()}>
              {createMutation.isPending ? 'Creando...' : 'Crear entrada'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
