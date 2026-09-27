// apps/desktop/src/modules/runly.catalog/screens/CatalogProductsScreen.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button, Checkbox, ConfirmDialog, Dialog, DialogContent, DialogHeader, DialogTitle,
  EmptyState, ErrorState, FilterBar, PageHeader, SearchInput, Skeleton,
  TextField, ViewModeSwitch, getStoredViewMode,
} from '@runly/ui'
import {
  Boxes, CircleCheck, EyeOff, FileClock, Globe, Package, Plus, Trash2, TriangleAlert, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { CatalogStatStrip } from '../components/CatalogStatCard.jsx'
import ProductCard from '../components/ProductCard.jsx'
import ProductsTable from '../components/ProductsTable.jsx'

const PAGE_SIZE = 20

const TYPE_OPTIONS = [
  { value: 'SIMPLE', label: 'Simple' },
  { value: 'VARIABLE', label: 'Variable' },
]
const PUBLISHED_OPTIONS = [
  { value: 'true', label: 'Publicado' },
  { value: 'false', label: 'Borrador' },
]
const STOCK_OPTIONS = [
  { value: 'ok', label: 'Optimo' },
  { value: 'low', label: 'Stock bajo' },
  { value: 'out', label: 'Agotado' },
]

const FILTERS = [
  { key: 'type', label: 'Tipo', options: TYPE_OPTIONS },
  { key: 'published', label: 'Estado', options: PUBLISHED_OPTIONS },
  { key: 'stockStatus', label: 'Stock', options: STOCK_OPTIONS },
]

export default function CatalogProductsScreen() {
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const permissions = userProfile?.permissions ?? []
  const hasPermission = key => Boolean(userProfile?.isAdmin || permissions.includes(key))
  const canCreate = hasPermission('catalog.products.create')
  const canUpdate = hasPermission('catalog.products.update')
  const canDelete = hasPermission('catalog.products.delete')

  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ type: '', published: '', stockStatus: '' })
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState(() => getStoredViewMode('catalog-products', 'cards'))
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('SIMPLE')
  const [selectedIds, setSelectedIds] = useState(() => new Set())

  const { data: statsData } = useQuery({
    queryKey: ['catalog-product-stats', token],
    queryFn: () => runly.catalog.getProductStats(token),
    enabled: Boolean(token),
    staleTime: 30_000,
  })
  const stats = statsData?.data

  const { data: productsData, isPending, isError, refetch } = useQuery({
    queryKey: ['catalog-products', token, search, filters, page],
    queryFn: () => runly.catalog.listProducts(token, {
      search: search || undefined,
      type: filters.type || undefined,
      published: filters.published || undefined,
      stockStatus: filters.stockStatus || undefined,
      page,
      pageSize: PAGE_SIZE,
    }),
    enabled: Boolean(token),
    staleTime: 10_000,
  })
  const products = productsData?.data ?? []
  const total = productsData?.pagination?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const deleteMutation = useMutation({
    mutationFn: id => runly.catalog.deleteProduct(id, token),
    onSuccess: () => {
      setConfirmDelete(null)
      queryClient.invalidateQueries({ queryKey: ['catalog-products'] })
      queryClient.invalidateQueries({ queryKey: ['catalog-product-stats'] })
      toast.success('Producto eliminado')
    },
    onError: err => toast.error(err?.message ?? 'No se pudo eliminar el producto'),
  })

  const createMutation = useMutation({
    mutationFn: data => runly.catalog.createProduct(data, token),
    onSuccess: res => {
      toast.success('Producto creado')
      queryClient.invalidateQueries({ queryKey: ['catalog-products'] })
      queryClient.invalidateQueries({ queryKey: ['catalog-product-stats'] })
      navigate(`/app/m/runly.catalog/${res.data.id}`)
    },
    onError: err => toast.error(err?.message ?? 'No se pudo crear el producto'),
  })

  function invalidateAfterBulk() {
    setSelectedIds(new Set())
    queryClient.invalidateQueries({ queryKey: ['catalog-products'] })
    queryClient.invalidateQueries({ queryKey: ['catalog-product-stats'] })
  }

  const bulkPublishMutation = useMutation({
    mutationFn: async ids => {
      const results = await Promise.allSettled(ids.map(id => runly.catalog.publishProduct(id, token)))
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) throw new Error(`${failed} de ${ids.length} no se pudieron publicar`)
    },
    onSuccess: (_, ids) => { toast.success(`${ids.length} producto(s) publicado(s)`); invalidateAfterBulk() },
    onError: err => { toast.error(err?.message ?? 'Error al publicar en lote'); invalidateAfterBulk() },
  })

  const bulkUnpublishMutation = useMutation({
    mutationFn: async ids => {
      const results = await Promise.allSettled(ids.map(id => runly.catalog.unpublishProduct(id, token)))
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) throw new Error(`${failed} de ${ids.length} no se pudieron despublicar`)
    },
    onSuccess: (_, ids) => { toast.success(`${ids.length} producto(s) despublicado(s)`); invalidateAfterBulk() },
    onError: err => { toast.error(err?.message ?? 'Error al despublicar en lote'); invalidateAfterBulk() },
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async ids => {
      const results = await Promise.allSettled(ids.map(id => runly.catalog.deleteProduct(id, token)))
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) throw new Error(`${failed} de ${ids.length} no se pudieron eliminar`)
    },
    onSuccess: (_, ids) => { toast.success(`${ids.length} producto(s) eliminado(s)`); invalidateAfterBulk() },
    onError: err => { toast.error(err?.message ?? 'Error al eliminar en lote'); invalidateAfterBulk() },
  })

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev => prev.size === products.length ? new Set() : new Set(products.map(p => p.id)))
  }

  const statItems = stats && [
    { key: 'total', label: 'Total', value: stats.total, icon: Boxes, tone: 'brand' },
    { key: 'published', label: 'Publicados', value: stats.published, icon: CircleCheck, tone: 'success' },
    { key: 'draft', label: 'Borradores', value: stats.draft, icon: FileClock, tone: 'amber' },
    (stats.lowStock + stats.outOfStock) > 0 && {
      key: 'critical',
      label: 'Stock critico / agotado',
      value: stats.lowStock + stats.outOfStock,
      icon: TriangleAlert,
      tone: 'destructive',
    },
  ].filter(Boolean)

  function handleCreate() {
    setNewName('')
    setNewType('SIMPLE')
    setCreateOpen(true)
  }

  function handleSubmitCreate(e) {
    e.preventDefault()
    if (!newName.trim()) return
    const slug = newName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
    createMutation.mutate({ name: newName.trim(), slug, price: 0, product_type: newType })
    setCreateOpen(false)
  }

  function handleFiltersChange(next) {
    setFilters(next)
    setPage(1)
    setSelectedIds(new Set())
  }

  function handleSearchChange(e) {
    setSearch(e.target.value)
    setPage(1)
    setSelectedIds(new Set())
  }

  function goToPage(next) {
    setPage(next)
    setSelectedIds(new Set())
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly Catalog"
        title="Productos"
        description="Gestiona el catalogo de productos de tu empresa."
        actions={
          canCreate && (
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              <Plus className="mr-2 h-4 w-4" />
              Nuevo producto
            </Button>
          )
        }
      />

      {statItems && statItems.length > 0 && <CatalogStatStrip items={statItems} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={handleSearchChange}
          placeholder="Buscar por nombre, SKU..."
          className="sm:max-w-xs"
        />
        <FilterBar filters={FILTERS} value={filters} onChange={handleFiltersChange} className="flex-1" />
        <ViewModeSwitch
          modes={['cards', 'table']}
          value={viewMode}
          onChange={setViewMode}
          storageKey="catalog-products"
        />
      </div>

      {selectedIds.size > 0 && (canUpdate || canDelete) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-(--brand-primary)/30 bg-(--brand-soft) px-4 py-2.5">
          <span className="text-sm font-medium text-[hsl(var(--foreground))]">
            {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
          </span>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {canUpdate && (
              <>
                <Button
                  variant="outline" size="sm"
                  disabled={bulkPublishMutation.isPending}
                  onClick={() => bulkPublishMutation.mutate([...selectedIds])}
                >
                  <Globe className="h-4 w-4 mr-1.5" /> Publicar
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={bulkUnpublishMutation.isPending}
                  onClick={() => bulkUnpublishMutation.mutate([...selectedIds])}
                >
                  <EyeOff className="h-4 w-4 mr-1.5" /> Despublicar
                </Button>
              </>
            )}
            {canDelete && (
              <Button
                variant="outline" size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                disabled={bulkDeleteMutation.isPending}
                onClick={() => setConfirmBulkDelete(true)}
              >
                <Trash2 className="h-4 w-4 mr-1.5" /> Eliminar
              </Button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
              title="Cancelar selección"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-52 rounded-xl" />)}
        </div>
      ) : isError ? (
        <ErrorState title="No se pudo cargar el catalogo" onRetry={refetch} />
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No hay productos registrados"
          description="Crea tu primer producto para empezar a construir el catalogo."
          action={canCreate ? { label: 'Nuevo producto', onClick: handleCreate } : undefined}
        />
      ) : viewMode === 'table' ? (
        <ProductsTable
          products={products}
          selectedIds={selectedIds}
          onToggleSelect={canUpdate || canDelete ? toggleSelect : undefined}
          onToggleSelectAll={canUpdate || canDelete ? toggleSelectAll : undefined}
          onView={p => navigate(`/app/m/runly.catalog/${p.id}`)}
          onEdit={canUpdate ? p => navigate(`/app/m/runly.catalog/${p.id}`) : undefined}
          onDelete={canDelete ? p => setConfirmDelete(p) : undefined}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
          {products.map(p => (
            <ProductCard
              key={p.id}
              product={p}
              selected={selectedIds.has(p.id)}
              onToggleSelect={canUpdate || canDelete ? () => toggleSelect(p.id) : undefined}
              onSelect={prod => navigate(`/app/m/runly.catalog/${prod.id}`)}
            />
          ))}
        </div>
      )}

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-4 text-sm text-[hsl(var(--muted-foreground))]">
          <span>
            Mostrando <strong className="text-[hsl(var(--foreground))]">{(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, total)}</strong> de{' '}
            <strong className="text-[hsl(var(--foreground))]">{total}</strong> productos
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
              Anterior
            </Button>
            <span className="px-1">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
              Siguiente
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={v => !v && setConfirmDelete(null)}
        title="Eliminar producto"
        description="El producto sera desactivado. Esta accion no se puede deshacer facilmente."
        detail={confirmDelete?.name}
        confirmLabel="Eliminar"
        onConfirm={() => deleteMutation.mutate(confirmDelete.id)}
        loading={deleteMutation.isPending}
      />

      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={setConfirmBulkDelete}
        title="Eliminar productos seleccionados"
        description="Los productos seran desactivados. Esta accion no se puede deshacer facilmente."
        detail={`${selectedIds.size} producto(s)`}
        confirmLabel="Eliminar"
        onConfirm={() => { bulkDeleteMutation.mutate([...selectedIds]); setConfirmBulkDelete(false) }}
        loading={bulkDeleteMutation.isPending}
      />

      <Dialog open={createOpen} onOpenChange={v => { if (!v) setCreateOpen(false) }}>
        <DialogContent size="sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Nuevo producto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmitCreate} className="space-y-4 pt-2">
            <TextField
              label="Nombre del producto"
              required
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Ej. Camiseta basica"
              autoFocus
              maxLength={255}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewType('SIMPLE')}
                className={`flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-colors ${
                  newType === 'SIMPLE'
                    ? 'border-(--brand-primary) bg-(--brand-soft)'
                    : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                }`}
              >
                <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Simple</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">SKU único, sin variantes</span>
              </button>
              <button
                type="button"
                onClick={() => setNewType('VARIABLE')}
                className={`flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left transition-colors ${
                  newType === 'VARIABLE'
                    ? 'border-(--brand-primary) bg-(--brand-soft)'
                    : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]'
                }`}
              >
                <span className="text-sm font-semibold text-[hsl(var(--foreground))]">Variable</span>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">Con tallas, colores, etc.</span>
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={!newName.trim() || createMutation.isPending}>
                {createMutation.isPending ? 'Creando...' : 'Crear producto'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
