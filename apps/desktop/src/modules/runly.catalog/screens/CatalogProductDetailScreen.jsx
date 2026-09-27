// apps/desktop/src/modules/runly.catalog/screens/CatalogProductDetailScreen.jsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import {
  Badge, Button, Card, ComboboxField, ConfirmDialog, CurrencyField, EmptyState,
  MarkdownField, NumberField, Popover, PopoverContent, PopoverTrigger, SelectField,
  Skeleton, SortableList, Switch, TextareaField, TextField, cn,
} from '@runly/ui'
import {
  ArrowLeft, Boxes, ChevronDown, EyeOff, FileEdit, FileSpreadsheet, FileText,
  Globe, GripVertical, History, Images, Layers, Package, Search, Tag, Trash2,
  TrendingDown, TrendingUp,
} from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { companyFetch } from '../../../lib/companyFetch.js'
import { runly } from '../../../lib/runly.js'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { aggregateMovementsByMonth } from '../lib/aggregateMovements.js'
import { getStockStatus, STOCK_STATUS_META } from '../lib/stockStatus.js'
import MovementsTrendChart  from '../components/MovementsTrendChart.jsx'
import ProductImageManager  from '../components/ProductImageManager.jsx'
import StockMovementModal   from '../components/StockMovementModal.jsx'
import VariantOptionsEditor from '../components/VariantOptionsEditor.jsx'
import VariantMatrix        from '../components/VariantMatrix.jsx'

const API_BASE = getApiUrl()

const ALL_TABS = [
  { key: 'General',    label: 'General',                icon: FileEdit },
  { key: 'Precios',    label: 'Precio e inventario',     icon: Tag },
  { key: 'Variantes',  label: 'Variantes',               icon: Layers },
  { key: 'Historial',  label: 'Historial de movimientos', icon: History },
  { key: 'SEO',        label: 'SEO y meta',              icon: Search },
]

const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD — Dólar estadounidense' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'MXN', label: 'MXN — Peso mexicano' },
  { value: 'COP', label: 'COP — Peso colombiano' },
  { value: 'ARS', label: 'ARS — Peso argentino' },
  { value: 'PEN', label: 'PEN — Sol peruano' },
  { value: 'CLP', label: 'CLP — Peso chileno' },
  { value: 'BRL', label: 'BRL — Real brasileño' },
  { value: 'GTQ', label: 'GTQ — Quetzal guatemalteco' },
]

// Colored icon-chip header, same tone vocabulary as CatalogStatCard — flat
// muted-gray icons read as "unfinished" next to the rest of the redesign.
const SECTION_TONE = {
  brand:       'bg-(--brand-soft) text-(--brand-primary)',
  success:     'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  destructive: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
  amber:       'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  violet:      'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  neutral:     'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
}

function SectionCard({ title, icon: Icon, tone = 'neutral', meta, actions, children, className }) {
  return (
    <Card variant="solid" className={cn('p-5 space-y-4', className)}>
      {(title || meta || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {title && (
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
              {Icon && (
                <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-lg', SECTION_TONE[tone] ?? SECTION_TONE.neutral)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
              )}
              {title}
            </h3>
          )}
          {meta && <span className="shrink-0 text-xs text-[hsl(var(--muted-foreground))]">{meta}</span>}
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Card>
  )
}

export default function CatalogProductDetailScreen() {
  const { '*': wildcard } = useParams()
  const id = wildcard
  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const permissions = userProfile?.permissions ?? []
  const hasPermission = key => Boolean(userProfile?.isAdmin || permissions.includes(key))
  const canUpdate = hasPermission('catalog.products.update')

  const [tab, setTab] = useState('General')
  const [stockModalOpen, setStockModalOpen] = useState(false)
  const [typeMenuOpen, setTypeMenuOpen] = useState(false)
  const [confirmTypeChange, setConfirmTypeChange] = useState(null)

  const { data: productData, isPending } = useQuery({
    queryKey: ['catalog-product', id, token],
    queryFn: () => runly.catalog.getProduct(id, token),
    enabled: Boolean(token && id),
    staleTime: 30_000,
  })

  const { data: categoriesData } = useQuery({
    queryKey: ['catalog-categories-flat', token],
    queryFn: () => runly.catalog.listCategories(token, { flat: 'true' }),
    enabled: Boolean(token),
    staleTime: 60_000,
  })

  const { data: movementsData } = useQuery({
    queryKey: ['catalog-stock-movements', id, token],
    queryFn: () => runly.catalog.listStockMovements(id, token, { limit: 50 }),
    enabled: Boolean(token && id && tab === 'Historial'),
    staleTime: 30_000,
  })

  const updateMutation = useMutation({
    mutationFn: data => runly.catalog.updateProduct(id, data, token),
    onSuccess: () => {
      toast.success('Producto guardado')
      queryClient.invalidateQueries({ queryKey: ['catalog-product', id] })
    },
    onError: err => toast.error(err?.message ?? 'Error al guardar'),
  })

  const publishMutation = useMutation({
    mutationFn: pub => pub
      ? runly.catalog.publishProduct(id, token)
      : runly.catalog.unpublishProduct(id, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalog-product', id] })
    },
    onError: err => toast.error(err?.message ?? 'Error'),
  })

  const typeMutation = useMutation({
    mutationFn: type => runly.catalog.updateProduct(id, { product_type: type }, token),
    onSuccess: () => {
      toast.success('Tipo de producto actualizado')
      queryClient.invalidateQueries({ queryKey: ['catalog-product', id] })
    },
    onError: err => toast.error(err?.message ?? 'No se pudo cambiar el tipo de producto'),
  })

  function requestTypeChange(nextType) {
    setTypeMenuOpen(false)
    if (nextType === product?.product_type) return
    // VARIABLE -> SIMPLE hides the Variantes tab; existing option/variant rows
    // stay in the database (nothing is deleted) but become unreachable from
    // the UI until the product is switched back — worth a confirmation.
    if (nextType === 'SIMPLE' && product?.product_type === 'VARIABLE') {
      setConfirmTypeChange(nextType)
      return
    }
    typeMutation.mutate(nextType)
  }

  if (isPending) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    )
  }

  const product = productData?.data
  if (!product) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState icon={Package} title="Producto no encontrado" description="El producto no existe o fue eliminado." />
      </div>
    )
  }

  const categories = categoriesData?.data ?? []
  const movements  = movementsData?.data  ?? []
  const movTotal   = movementsData?.total ?? 0
  const isVariable = product.product_type === 'VARIABLE'
  const visibleTabs = ALL_TABS.filter(t => t.key !== 'Variantes' || isVariable)
  const stockStatus = getStockStatus({ trackStock: product.track_stock, stock: product.stock ?? 0 })

  return (
    <div className="flex flex-col min-h-dvh">
      {/* ── Top bar ── */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-4 px-4 md:px-6 py-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--background))]/95 backdrop-blur-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/app/m/runly.catalog')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-sm font-semibold text-[hsl(var(--foreground))] truncate">{product.name}</h1>
              {canUpdate ? (
                <Popover open={typeMenuOpen} onOpenChange={setTypeMenuOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="shrink-0 inline-flex items-center gap-1 rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
                    >
                      {isVariable ? 'Variable' : 'Simple'}
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-64 p-1.5">
                    <button
                      type="button"
                      onClick={() => requestTypeChange('SIMPLE')}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-lg p-2 text-left transition-colors',
                        !isVariable ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]',
                      )}
                    >
                      <span className="text-xs font-semibold text-[hsl(var(--foreground))]">Producto Simple</span>
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Inventario único, sin variantes.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => requestTypeChange('VARIABLE')}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 rounded-lg p-2 text-left transition-colors',
                        isVariable ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted))]',
                      )}
                    >
                      <span className="text-xs font-semibold text-[hsl(var(--foreground))]">Producto Variable</span>
                      <span className="text-[11px] text-[hsl(var(--muted-foreground))]">Múltiples SKUs por talla, color u otro atributo.</span>
                    </button>
                  </PopoverContent>
                </Popover>
              ) : (
                <span className="shrink-0 inline-flex items-center rounded-full border border-[hsl(var(--border))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--muted-foreground))]">
                  {isVariable ? 'Variable' : 'Simple'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={cn(
                'h-1.5 w-1.5 rounded-full shrink-0',
                product.published ? 'bg-emerald-500' : 'bg-amber-400 animate-pulse',
              )} />
              <span className="text-xs text-[hsl(var(--muted-foreground))]">
                {product.published ? 'Publicado' : 'Borrador — no visible al público'}
              </span>
              {product.track_stock && (
                <>
                  <span className="text-[hsl(var(--border))]">·</span>
                  <Badge variant={STOCK_STATUS_META[stockStatus].tone} className="h-4.5 px-1.5 text-[10px]">
                    {STOCK_STATUS_META[stockStatus].label}
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>
        {canUpdate && (
          <Button
            size="sm"
            variant={product.published ? 'outline' : 'default'}
            onClick={() => publishMutation.mutate(!product.published)}
            disabled={publishMutation.isPending}
          >
            {product.published
              ? <><EyeOff className="h-4 w-4 mr-1.5" />Despublicar</>
              : <><Globe className="h-4 w-4 mr-1.5" />Publicar</>}
          </Button>
        )}
      </div>

      {/* ── Pill tabs ── */}
      <div className="px-4 md:px-6 pt-4">
        <div className="flex items-center gap-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/40 p-1 w-fit overflow-x-auto">
          {visibleTabs.map(t => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-150 whitespace-nowrap',
                tab === t.key
                  ? 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] shadow-sm'
                  : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
              )}
            >
              <t.icon className="h-3.5 w-3.5 shrink-0" />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className="flex-1 px-4 md:px-6 py-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {tab === 'General'   && <GeneralTab   product={product} categories={categories} token={token} onSave={updateMutation.mutate} saving={updateMutation.isPending} />}
            {tab === 'Precios'   && <PreciosTab   product={product} onSave={updateMutation.mutate} saving={updateMutation.isPending} onStockAdjust={() => setStockModalOpen(true)} />}
            {tab === 'Variantes' && isVariable && <VariantesTab product={product} token={token} productId={id} />}
            {tab === 'Historial' && <HistorialTab movements={movements} total={movTotal} stock={product.stock} trackStock={product.track_stock} productId={id} token={token} onAdjust={() => setStockModalOpen(true)} />}
            {tab === 'SEO'       && <SeoTab       product={product} onSave={updateMutation.mutate} saving={updateMutation.isPending} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <StockMovementModal
        open={stockModalOpen}
        onClose={() => setStockModalOpen(false)}
        token={token}
        productId={id}
      />

      <ConfirmDialog
        open={Boolean(confirmTypeChange)}
        onOpenChange={v => !v && setConfirmTypeChange(null)}
        title="Cambiar a Producto Simple"
        description="Las opciones y variantes existentes no se eliminarán, pero la pestaña Variantes dejará de estar disponible hasta que vuelvas a marcarlo como Variable."
        confirmLabel="Cambiar a Simple"
        onConfirm={() => { typeMutation.mutate(confirmTypeChange); setConfirmTypeChange(null) }}
        loading={typeMutation.isPending}
      />
    </div>
  )
}

// ── Tab components ────────────────────────────────────────────────────────────

// Attributes are persisted as a plain { key, value } array — order in that
// array IS the display order. `id` only identifies rows for SortableList's
// drag-reorder in this session; it's stripped before onSave, never sent to the API.
let attrLocalIdSeq = 0
function withLocalId(attr) { return { ...attr, id: attr.id ?? `attr-${attrLocalIdSeq++}` } }

function GeneralTab({ product, categories, token, onSave, saving }) {
  const [form, setForm] = useState({
    name:        product.name        ?? '',
    slug:        product.slug        ?? '',
    description: product.description ?? '',
    category_id: product.category_id ?? '',
    attributes:  (Array.isArray(product.attributes) ? product.attributes : []).map(withLocalId),
  })

  function slugify(s) {
    return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  }

  function handleNameChange(e) {
    const name = e.target.value
    const autoSlug = slugify(product.name ?? '')
    const isAutoSlug = form.slug === autoSlug || form.slug === slugify(form.name)
    setForm(f => ({ ...f, name, slug: isAutoSlug ? slugify(name) : f.slug }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      name:        form.name,
      slug:        form.slug,
      description: form.description || undefined,
      category_id: form.category_id || null,
      attributes:  form.attributes
        .filter(a => a.key?.trim())
        .map(({ key, value }) => ({ key, value })),
    })
  }

  function addAttr()          { setForm(f => ({ ...f, attributes: [...f.attributes, withLocalId({ key: '', value: '' })] })) }
  function removeAttr(id)     { setForm(f => ({ ...f, attributes: f.attributes.filter(a => a.id !== id) })) }
  function setAttr(id, k, v)  { setForm(f => ({ ...f, attributes: f.attributes.map(a => a.id === id ? { ...a, [k]: v } : a) })) }
  function reorderAttrs(next) { setForm(f => ({ ...f, attributes: next })) }

  const categoryOptions = [
    { value: '', label: 'Sin categoría' },
    ...categories.map(c => ({ value: c.id, label: c.name })),
  ]

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main — 2/3 */}
        <div className="lg:col-span-2 space-y-5">
          <SectionCard title="Información básica" icon={FileEdit} tone="brand">
            <TextField
              label="Nombre del producto"
              value={form.name}
              onChange={handleNameChange}
              required
            />
            <div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--muted))]/40 px-3 py-2">
              <Tag className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">Identificador:</span>
              <code className="truncate text-xs font-mono text-[hsl(var(--foreground))]">/p/{form.slug || '—'}</code>
            </div>
            <TextField
              label="Slug"
              value={form.slug}
              onChange={e => setForm(f => ({ ...f, slug: e.target.value }))}
              description="Identificador en la URL del producto"
              required
            />
            <MarkdownField
              label="Descripción"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe el producto..."
            />
          </SectionCard>

          <SectionCard
            title="Atributos personalizados"
            icon={Layers}
            tone="violet"
            meta="Especificaciones visibles en la ficha técnica"
          >
            <div className="space-y-2">
              {form.attributes.length === 0 && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Sin atributos. Agrega pares clave-valor para especificaciones adicionales.
                </p>
              )}
              <SortableList
                items={form.attributes}
                onReorder={reorderAttrs}
                renderItem={(a, { dragHandleProps, isDragging }) => (
                  <div className={cn('flex gap-2 items-center py-1', isDragging && 'opacity-50')}>
                    <button
                      type="button"
                      {...dragHandleProps}
                      className="flex h-9 w-5 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))]/60 cursor-grab touch-none"
                      aria-label="Arrastrar para reordenar"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                    <TextField
                      value={a.key}
                      onChange={e => setAttr(a.id, 'key', e.target.value)}
                      placeholder="Ej: Material"
                      className="w-40"
                    />
                    <TextField
                      value={a.value}
                      onChange={e => setAttr(a.id, 'value', e.target.value)}
                      placeholder="Ej: Aluminio"
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttr(a.id)}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] hover:bg-red-50 hover:text-red-500 transition-colors"
                      aria-label="Eliminar atributo"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              />
              <Button type="button" variant="outline" size="sm" onClick={addAttr}>
                + Agregar atributo
              </Button>
            </div>
          </SectionCard>
        </div>

        {/* Sidebar — 1/3 */}
        <div className="space-y-5">
          <SectionCard title="Imágenes del producto" icon={Images} tone="amber">
            <ProductImageManager
              token={token}
              coverId={product.cover_asset_id}
              imageIds={Array.isArray(product.images) ? product.images : []}
              onChange={({ coverId, imageIds }) => onSave({ cover_asset_id: coverId, images: imageIds })}
            />
          </SectionCard>

          <SectionCard title="Organización" icon={Boxes} tone="neutral">
            <ComboboxField
              label="Categoría"
              options={categoryOptions}
              value={form.category_id}
              onChange={v => setForm(f => ({ ...f, category_id: v }))}
              placeholder="Seleccionar categoría..."
              searchPlaceholder="Buscar categoría..."
              emptyText="Sin resultados"
            />
          </SectionCard>
        </div>
      </div>

      <div className="mt-6">
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}

function PreciosTab({ product, onSave, saving, onStockAdjust }) {
  const isVariable = product.product_type === 'VARIABLE'
  const [form, setForm] = useState({
    price:         String(product.price        ?? 0),
    compare_price: product.compare_price != null ? String(product.compare_price) : '',
    currency:      product.currency     ?? 'USD',
    sku:           product.sku          ?? '',
    barcode:       product.barcode      ?? '',
    weight:        product.weight  != null ? String(product.weight) : '',
    track_stock:   product.track_stock  ?? false,
  })

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      price:         Number(form.price),
      compare_price: form.compare_price ? Number(form.compare_price) : null,
      currency:      form.currency,
      sku:           form.sku     || null,
      barcode:       form.barcode || null,
      weight:        form.weight  ? Number(form.weight) : null,
      track_stock:   form.track_stock,
    })
  }

  const priceNum = Number(form.price) || 0
  const comparePriceNum = Number(form.compare_price) || 0
  const discountPct = comparePriceNum > priceNum && priceNum > 0
    ? Math.round((1 - priceNum / comparePriceNum) * 100)
    : null

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main — 2/3 */}
        <div className="lg:col-span-2 space-y-5">
          <SectionCard
            title="Precio de venta"
            icon={Tag}
            tone="success"
            meta={discountPct != null ? <Badge variant="destructive">-{discountPct}%</Badge> : undefined}
          >
            <div className="grid grid-cols-2 gap-4">
              <CurrencyField
                label="Precio"
                value={form.price}
                onChange={v => setForm(f => ({ ...f, price: String(v) }))}
                currency={form.currency}
                min={0}
                required
              />
              <SelectField
                label="Moneda"
                options={CURRENCY_OPTIONS}
                value={form.currency}
                onValueChange={v => setForm(f => ({ ...f, currency: v }))}
                placeholder="Seleccionar..."
              />
            </div>
            <CurrencyField
              label="Precio anterior (tachado, opcional)"
              value={form.compare_price || 0}
              onChange={v => setForm(f => ({ ...f, compare_price: v > 0 ? String(v) : '' }))}
              currency={form.currency}
              min={0}
              hint="Se muestra tachado junto al precio actual para indicar descuento"
            />
          </SectionCard>

          {!isVariable && (
            <SectionCard title="Identificadores y logística" icon={Package} tone="neutral">
              <div className="grid grid-cols-2 gap-4">
                <TextField
                  label="SKU"
                  value={form.sku}
                  onChange={e => setForm(f => ({ ...f, sku: e.target.value }))}
                  placeholder="Código interno"
                  description="Referencia interna del producto"
                />
                <TextField
                  label="Código de barras"
                  value={form.barcode}
                  onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
                  placeholder="EAN / UPC"
                />
              </div>
              <NumberField
                label="Peso (kg)"
                value={form.weight}
                onChange={e => setForm(f => ({ ...f, weight: e.target.value }))}
                min={0}
                step={0.001}
                description="Peso para cálculo de costos de envío"
              />
            </SectionCard>
          )}

          {isVariable && (
            <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
              Los precios, SKU y stock se gestionan por variante.<br />
              <span className="font-medium">Usa la pestaña Variantes.</span>
            </div>
          )}
        </div>

        {/* Sidebar — 1/3 */}
        {!isVariable && (
          <div className="space-y-5">
            <SectionCard title="Inventario" icon={Boxes} tone="amber">
              <div className="flex items-start gap-3">
                <Switch
                  id="pr-track"
                  checked={form.track_stock}
                  onCheckedChange={v => setForm(f => ({ ...f, track_stock: v }))}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium leading-none">Controlar stock</p>
                  <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">Registrar entradas y salidas</p>
                </div>
              </div>

              {form.track_stock && (() => {
                const status = getStockStatus({ trackStock: true, stock: product.stock ?? 0 })
                const meta = STOCK_STATUS_META[status]
                return (
                  <div className="rounded-xl bg-[hsl(var(--muted))]/50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-[hsl(var(--muted-foreground))]">Stock actual</p>
                        <p className="text-3xl font-bold tabular-nums text-[hsl(var(--foreground))]">
                          {product.stock ?? 0}
                        </p>
                      </div>
                      <Badge variant={meta.tone}>{meta.label}</Badge>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="w-full" onClick={onStockAdjust}>
                      Registrar ajuste
                    </Button>
                  </div>
                )
              })()}
            </SectionCard>
          </div>
        )}
      </div>

      <div className="mt-6">
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </div>
    </form>
  )
}

function VariantesTab({ product, token, productId }) {
  return (
    <div className="space-y-6 max-w-4xl">
      <SectionCard title="Opciones de variante" icon={Layers} tone="violet">
        <VariantOptionsEditor token={token} productId={productId} options={product.options ?? []} />
      </SectionCard>
      <SectionCard title="Combinaciones" icon={Boxes} tone="brand">
        <VariantMatrix token={token} productId={productId} variants={product.variants ?? []} />
      </SectionCard>
    </div>
  )
}

function HistorialTab({ movements, total, stock, trackStock, productId, token, onAdjust }) {
  const [exporting, setExporting] = useState(null)

  function fmtDate(val) {
    if (!val) return '—'
    try {
      return new Date(val).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
    } catch {
      return val
    }
  }

  async function handleExport(format) {
    setExporting(format)
    try {
      const res = await companyFetch(
        `${API_BASE}/catalog/products/${productId}/stock-movements/export/${format}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      if (!res.ok) {
        toast.error('No se pudo exportar el archivo')
        return
      }
      const blob = await res.blob()
      const anchor = document.createElement('a')
      anchor.href = URL.createObjectURL(blob)
      anchor.download = `movimientos-${productId}-${Date.now()}.${format}`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(anchor.href)
    } catch {
      toast.error('No se pudo exportar el archivo')
    } finally {
      setExporting(null)
    }
  }

  const status = getStockStatus({ trackStock, stock: stock ?? 0 })
  const meta = STOCK_STATUS_META[status]
  const trend = aggregateMovementsByMonth(movements)

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="flex items-center justify-between rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted))]/30 px-4 py-3">
        <div>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Stock actual</p>
          <p className="text-2xl font-bold tabular-nums text-[hsl(var(--foreground))]">{stock ?? 0}</p>
        </div>
        {trackStock && <Badge variant={meta.tone}>{meta.label}</Badge>}
      </div>

      {trend.length > 0 && (
        <SectionCard title="Entradas y salidas por mes" icon={TrendingUp} tone="brand">
          <MovementsTrendChart data={trend} />
        </SectionCard>
      )}

      <SectionCard
        title="Movimientos de inventario"
        icon={History}
        tone="violet"
        meta={`${total} movimiento${total !== 1 ? 's' : ''} registrado${total !== 1 ? 's' : ''}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(exporting) || total === 0}
              onClick={() => handleExport('xlsx')}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1.5" />
              {exporting === 'xlsx' ? 'Exportando...' : 'Excel'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={Boolean(exporting) || total === 0}
              onClick={() => handleExport('pdf')}
            >
              <FileText className="h-4 w-4 mr-1.5" />
              {exporting === 'pdf' ? 'Exportando...' : 'PDF'}
            </Button>
            <Button size="sm" onClick={onAdjust}>Registrar ajuste</Button>
          </>
        }
      >
      {movements.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Sin movimientos"
          description="Aún no hay ajustes de stock registrados para este producto."
        />
      ) : (
        <div className="rounded-2xl border border-[hsl(var(--border))] divide-y divide-[hsl(var(--border))] overflow-hidden">
          {movements.map(m => (
            <div
              key={m.id}
              className="flex items-center justify-between px-4 py-3 hover:bg-[hsl(var(--muted))]/20 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                  m.quantity_delta > 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600',
                )}>
                  {m.quantity_delta > 0
                    ? <TrendingUp className="h-3.5 w-3.5" />
                    : <TrendingDown className="h-3.5 w-3.5" />}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      'text-sm font-semibold tabular-nums',
                      m.quantity_delta > 0 ? 'text-emerald-600' : 'text-red-600',
                    )}>
                      {m.quantity_delta > 0 ? `+${m.quantity_delta}` : m.quantity_delta}
                    </span>
                    {m.reason && (
                      <span className="text-sm text-[hsl(var(--foreground))] truncate">{m.reason}</span>
                    )}
                  </div>
                  {m.note && (
                    <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">{m.note}</p>
                  )}
                </div>
              </div>
              <p className="text-xs text-[hsl(var(--muted-foreground))] shrink-0 ml-3">{fmtDate(m.created_at)}</p>
            </div>
          ))}
        </div>
      )}
      </SectionCard>
    </div>
  )
}

function SeoTab({ product, onSave, saving }) {
  const [form, setForm] = useState({
    meta_title:       product.meta_title       ?? '',
    meta_description: product.meta_description ?? '',
  })

  function handleSubmit(e) {
    e.preventDefault()
    onSave({ meta_title: form.meta_title || null, meta_description: form.meta_description || null })
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main — 2/3 */}
        <div className="lg:col-span-2">
          <SectionCard title="Metadatos SEO" icon={Search} tone="brand">
            <TextField
              label="Título SEO"
              value={form.meta_title}
              onChange={e => setForm(f => ({ ...f, meta_title: e.target.value }))}
              placeholder={product.name}
              maxLength={160}
              description={`${form.meta_title.length} / 160 caracteres`}
            />
            <TextareaField
              label="Descripción SEO"
              value={form.meta_description}
              onChange={e => setForm(f => ({ ...f, meta_description: e.target.value }))}
              placeholder="Descripción para motores de búsqueda..."
              maxLength={320}
              rows={4}
              description={`${form.meta_description.length} / 320 caracteres`}
            />
          </SectionCard>
        </div>

        {/* Sidebar — 1/3 */}
        <div>
          <SectionCard title="Vista previa en Google" icon={Globe} tone="neutral">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-3">
              Ejemplo de resultado
            </p>
            <div className="space-y-0.5">
              <p className="text-sm text-blue-600 font-medium truncate leading-snug">
                {form.meta_title || product.name}
              </p>
              <p className="text-xs text-emerald-700 truncate">tudominio.com / {product.slug}</p>
              <p className="text-xs text-[hsl(var(--muted-foreground))] line-clamp-3 leading-relaxed mt-1">
                {form.meta_description || product.description || 'Sin descripción SEO configurada.'}
              </p>
            </div>
          </SectionCard>
        </div>
      </div>

      <div className="mt-6">
        <Button type="submit" disabled={saving}>
          {saving ? 'Guardando...' : 'Guardar SEO'}
        </Button>
      </div>
    </form>
  )
}
