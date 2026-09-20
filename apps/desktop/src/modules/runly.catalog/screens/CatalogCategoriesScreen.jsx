import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.catalog/screens/CatalogCategoriesScreen.jsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  ComboboxField,
  ConfirmDialog,
  MarkdownField,
  PageHeader,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SortableList,
  TextField,
} from '@runly/ui'
import { GripVertical, Pencil, Trash2, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

function slugify(s) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/(^-|-$)/g, '')
}

function CategoryRow({ item, onEdit, onDelete, dragHandleProps, isDragging }) {
  return (
    <div
      className={[
        'flex items-center gap-2 px-3 py-2.5 bg-[hsl(var(--background))] border border-[hsl(var(--border))] rounded-lg group',
        isDragging ? 'opacity-50 shadow-lg' : '',
      ].join(' ')}
    >
      <button
        {...dragHandleProps}
        type="button"
        className="cursor-grab text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] touch-none shrink-0"
        aria-label="Arrastrar para reordenar"
      >
        <GripVertical size={14} />
      </button>
      <span className="flex-1 text-sm font-medium text-[hsl(var(--foreground))] truncate">
        {item.name}
      </span>
      <span className="text-xs text-[hsl(var(--muted-foreground))] font-mono hidden sm:block truncate max-w-35">
        {item.slug}
      </span>
      {item.parent_name && (
        <span className="text-xs text-[hsl(var(--muted-foreground))] hidden md:block truncate max-w-30">
          {item.parent_name}
        </span>
      )}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          type="button"
          onClick={() => onEdit(item)}
          className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(item)}
          className="p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--destructive))]"
        >
          <Trash2 size={12} />
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
  const [form, setForm] = useState({ name: '', slug: '', description: '', parent_id: '' })
  const [localOrder, setLocalOrder] = useState(null)

  const flatQuery = useQuery({
    queryKey: ['catalog-categories-flat', token],
    queryFn:  () => runly.catalog.listCategories(token, { flat: 'true' }),
    enabled:  Boolean(token),
    staleTime: 60_000,
  })
  const flatCats = flatQuery.data?.data ?? []
  const orderedCats = localOrder ?? flatCats

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
    setForm({ name: '', slug: '', description: '', parent_id: '' })
    setSheetOpen(true)
  }

  function openEdit(row) {
    setEditing(row)
    setForm({
      name:        row.name        ?? '',
      slug:        row.slug        ?? '',
      description: row.description ?? '',
      parent_id:   row.parent_id   ?? '',
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
      name:        form.name,
      slug:        form.slug,
      description: form.description || undefined,
      parent_id:   form.parent_id   || null,
      position:    editing ? undefined : nextPosition,
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
          canCreate && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Nueva categoría
            </Button>
          )
        }
      />

      {flatQuery.isLoading ? (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando categorías...</p>
      ) : orderedCats.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[hsl(var(--border))] p-10 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">No hay categorías registradas.</p>
          {canCreate && <Button className="mt-4" onClick={openCreate}>Nueva categoría</Button>}
        </div>
      ) : (
        <div className="space-y-1.5">
          <SortableList
            items={orderedCats}
            onReorder={canUpdate ? handleReorder : () => {}}
            renderItem={(item, { dragHandleProps, isDragging }) => (
              <CategoryRow
                item={item}
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
