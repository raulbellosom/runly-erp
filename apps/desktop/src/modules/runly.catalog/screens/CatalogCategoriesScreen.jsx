import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.catalog/screens/CatalogCategoriesScreen.jsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Badge,
  Button,
  ComboboxField,
  ConfirmDialog,
  EmptyState,
  MarkdownField,
  PageHeader,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Skeleton,
  SortableList,
  TextField,
} from '@runly/ui'
import { FolderTree, GripVertical, Pencil, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { pickCategoryStyle } from '../lib/categoryVisuals.js'
import CategoryCoverUploader from '../components/CategoryCoverUploader.jsx'

function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/(^-|-$)/g, '')
}

function CategoryRow({ item, coverUrl, onEdit, onDelete, dragHandleProps, isDragging }) {
  const style = pickCategoryStyle(item.name)
  const productCount = Number(item.product_count ?? 0)
  return (
    <div
      className={[
        'flex items-center gap-3 px-3 py-2.5 bg-[hsl(var(--card))] border border-[hsl(var(--border))] rounded-xl shadow-sm hover:shadow-md transition-all group',
        isDragging ? 'opacity-50 shadow-lg' : '',
      ].join(' ')}
    >
      <button
        {...dragHandleProps}
        type="button"
        className="cursor-grab text-[hsl(var(--muted-foreground))]/60 hover:text-[hsl(var(--foreground))] touch-none shrink-0"
        aria-label="Arrastrar para reordenar"
      >
        <GripVertical size={14} />
      </button>

      {coverUrl ? (
        <img src={coverUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${style.bg} ${style.fg}`}>
          <FolderTree size={16} />
        </span>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">
            {item.name}
          </span>
          {item.parent_name && (
            <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0 h-5">
              en {item.parent_name}
            </Badge>
          )}
        </div>
        <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono truncate">
          {item.slug}
        </span>
      </div>

      <Badge variant={productCount > 0 ? 'success' : 'outline'} className="shrink-0 hidden sm:inline-flex">
        {productCount} producto{productCount !== 1 ? 's' : ''}
      </Badge>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="p-1.5 rounded-lg hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          title="Editar"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(item)}
          className="p-1.5 rounded-lg hover:bg-red-50 text-[hsl(var(--muted-foreground))] hover:text-red-500"
          title="Eliminar"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

export default function CatalogCategoriesScreen() {
  const { session, userProfile } = useAuth()
  const token       = session?.access_token
  const queryClient = useQueryClient()
  const permissions = userProfile?.permissions ?? []
  const hasPermission = key => Boolean(userProfile?.isAdmin || permissions.includes(key))
  const canCreate = hasPermission('catalog.categories.create')
  const canUpdate = hasPermission('catalog.categories.update')
  const canDelete = hasPermission('catalog.categories.delete')

  const [sheetOpen,     setSheetOpen]     = useState(false)
  const [editing,       setEditing]       = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [form, setForm] = useState({ name: '', slug: '', description: '', parent_id: '', cover_asset_id: null })
  const [localOrder, setLocalOrder] = useState(null)

  const flatQuery = useQuery({
    queryKey: ['catalog-categories-flat', token],
    queryFn:  () => runly.catalog.listCategories(token, { flat: 'true' }),
    enabled:  Boolean(token),
    staleTime: 60_000,
  })
  const flatCats = flatQuery.data?.data ?? []
  const orderedCats = localOrder ?? flatCats

  const coverIds = [...new Set(flatCats.map(c => c.cover_asset_id).filter(Boolean))]
  const coverUrlsQuery = useQuery({
    queryKey: ['catalog-category-covers', coverIds.join(','), token],
    queryFn: () => runly.files.batchSignedUrls(coverIds, token),
    enabled: Boolean(token) && coverIds.length > 0,
    staleTime: 60_000,
  })
  const coverUrls = coverUrlsQuery.data?.data ?? {}

  const saveMutation = useMutation({
    mutationFn: data => editing
      ? runly.catalog.updateCategory(editing.id, data, token)
      : runly.catalog.createCategory(data, token),
    onSuccess: () => {
      toast.success(editing ? 'Categoría actualizada' : 'Categoría creada')
      setLocalOrder(null)
      queryClient.invalidateQueries({ queryKey: ['catalog-categories-flat'] })
      setSheetOpen(false)
    },
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  const deleteMutation = useMutation({
    mutationFn: id => runly.catalog.deleteCategory(id, token),
    onSuccess: () => {
      toast.success('Categoría eliminada')
      setLocalOrder(null)
      queryClient.invalidateQueries({ queryKey: ['catalog-categories-flat'] })
      setConfirmDelete(null)
    },
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  const reorderMutation = useMutation({
    mutationFn: async (items) => {
      const res = await companyFetch(`${getApiUrl()}/catalog/categories/reorder`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items.map((c, idx) => ({ id: c.id, position: idx * 10 })) }),
      })
      if (!res.ok) throw new Error('Error al guardar el orden')
    },
    onError: () => toast.error('Error al guardar el orden'),
  })

  function openCreate() {
    setEditing(null)
    setForm({ name: '', slug: '', description: '', parent_id: '', cover_asset_id: null })
    setSheetOpen(true)
  }

  function openEdit(row) {
    setEditing(row)
    setForm({
      name:           row.name           ?? '',
      slug:           row.slug           ?? '',
      description:    row.description    ?? '',
      parent_id:      row.parent_id      ?? '',
      cover_asset_id: row.cover_asset_id ?? null,
    })
    setSheetOpen(true)
  }

  function handleNameChange(e) {
    const name = e.target.value
    const isAuto = !editing || form.slug === slugify(editing.name) || form.slug === slugify(form.name)
    setForm(f => ({ ...f, name, slug: isAuto ? slugify(name) : f.slug }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    const nextPosition = orderedCats.length * 10
    saveMutation.mutate({
      name:           form.name,
      slug:           form.slug,
      description:    form.description || undefined,
      parent_id:      form.parent_id   || null,
      cover_asset_id: form.cover_asset_id || null,
      position:       editing ? undefined : nextPosition,
    })
  }

  function handleReorder(newOrder) {
    setLocalOrder(newOrder)
    reorderMutation.mutate(newOrder)
  }

  const parentOptions = [
    { value: '__none__', label: 'Sin padre (categoría raíz)' },
    ...flatCats
      .filter(c => c.id !== editing?.id)
      .map(c => ({ value: c.id, label: c.name })),
  ]

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly Catalog"
        title="Categorías"
        description="Organiza tus productos en categorías y subcategorías. Arrastra para reordenar."
        actions={
          <div className="flex items-center gap-3">
            {orderedCats.length > 0 && (
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {orderedCats.length} categoría{orderedCats.length !== 1 ? 's' : ''}
              </Badge>
            )}
            {canCreate && (
              <Button onClick={openCreate}>
                <Plus className="mr-2 h-4 w-4" /> Nueva categoría
              </Button>
            )}
          </div>
        }
      />

      {flatQuery.isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
        </div>
      ) : orderedCats.length === 0 ? (
        <EmptyState
          icon={FolderTree}
          title="No hay categorías registradas"
          description="Crea tu primera categoría para empezar a organizar el catálogo."
          action={canCreate ? { label: 'Nueva categoría', onClick: openCreate } : undefined}
        />
      ) : (
        <div className="space-y-1.5">
          <SortableList
            items={orderedCats}
            onReorder={canUpdate ? handleReorder : () => {}}
            renderItem={(item, { dragHandleProps, isDragging }) => (
              <CategoryRow
                item={item}
                coverUrl={item.cover_asset_id ? coverUrls[item.cover_asset_id] : null}
                dragHandleProps={canUpdate ? dragHandleProps : {}}
                isDragging={isDragging}
                onEdit={canUpdate ? openEdit : () => {}}
                onDelete={canDelete ? setConfirmDelete : () => {}}
              />
            )}
          />
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto" aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{editing ? 'Editar categoría' : 'Nueva categoría'}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <CategoryCoverUploader
              token={token}
              coverId={form.cover_asset_id}
              onChange={id => setForm(f => ({ ...f, cover_asset_id: id }))}
            />
            <TextField
              label="Nombre"
              value={form.name}
              onChange={handleNameChange}
              required
            />
            <TextField
              label="Slug"
              value={form.slug}
              onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
              description="Identificador único en la URL"
              required
            />
            <MarkdownField
              label="Descripción (opcional)"
              value={form.description}
              placeholder="Describe la categoría..."
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
            <ComboboxField
              label="Categoría padre"
              options={parentOptions}
              value={form.parent_id || '__none__'}
              onChange={v => setForm(f => ({ ...f, parent_id: v === '__none__' ? '' : v }))}
              placeholder="Seleccionar padre..."
              searchPlaceholder="Buscar categoría..."
              emptyText="Sin resultados"
            />
            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setSheetOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Guardando...' : editing ? 'Guardar' : 'Crear'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={v => !v && setConfirmDelete(null)}
        title="Eliminar categoría"
        description="La categoría será desactivada. Los productos que la tengan asignada no se verán afectados."
        detail={confirmDelete?.name}
        confirmLabel="Eliminar"
        onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
