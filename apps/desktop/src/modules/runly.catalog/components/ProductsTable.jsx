// apps/desktop/src/modules/runly.catalog/components/ProductsTable.jsx
import { Badge, Checkbox } from '@runly/ui'
import { ImageOff, Pencil, Trash2 } from 'lucide-react'
import { formatCurrency } from '../lib/formatCurrency.js'
import { getStockStatus, STOCK_STATUS_META } from '../lib/stockStatus.js'

const th = 'px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]'

export default function ProductsTable({ products, selectedIds, onToggleSelect, onToggleSelectAll, onView, onEdit, onDelete }) {
  const allSelected = onToggleSelectAll && products.length > 0 && selectedIds?.size === products.length
  return (
    <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
            {onToggleSelectAll && (
              <th className={`${th} w-10`}>
                <Checkbox checked={allSelected} onCheckedChange={onToggleSelectAll} aria-label="Seleccionar todos" />
              </th>
            )}
            <th className={`${th} w-14`}>Foto</th>
            <th className={th}>Producto</th>
            <th className={`${th} hidden sm:table-cell`}>Categoría</th>
            <th className={`${th} hidden md:table-cell`}>Tipo</th>
            <th className={`${th} text-right`}>Precio</th>
            <th className={`${th} hidden lg:table-cell`}>Stock</th>
            <th className={th}>Estado</th>
            <th className={`${th} text-right`}>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const stockStatus = getStockStatus({ trackStock: product.track_stock, stock: product.stock ?? 0 })
            const stockMeta = STOCK_STATUS_META[stockStatus]
            const hasDiscount = product.compare_price > product.price
            const selected = selectedIds?.has(product.id) ?? false
            return (
              <tr
                key={product.id}
                onClick={() => onView(product)}
                className={`group cursor-pointer border-b border-[hsl(var(--border)/0.5)] transition-colors last:border-b-0 hover:bg-[hsl(var(--muted)/0.4)] ${selected ? 'bg-(--brand-soft)' : ''}`}
              >
                {onToggleSelect && (
                  <td className="px-4 py-2.5" onClick={e => e.stopPropagation()}>
                    <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(product.id)} aria-label="Seleccionar" />
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[hsl(var(--muted))]">
                    {product.image_url ? (
                      <img src={product.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[hsl(var(--muted-foreground))]/40">
                        <ImageOff size={16} />
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-[hsl(var(--foreground))]">{product.name}</div>
                    {product.sku && (
                      <div className="truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">{product.sku}</div>
                    )}
                  </div>
                </td>
                <td className="hidden px-4 py-2.5 text-[hsl(var(--muted-foreground))] sm:table-cell">
                  {product.category_name ?? '—'}
                </td>
                <td className="hidden px-4 py-2.5 md:table-cell">
                  <Badge variant="outline" className="text-[10px]">
                    {product.product_type === 'VARIABLE' ? 'Variable' : 'Simple'}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="font-semibold tabular-nums text-[hsl(var(--foreground))]">
                    {formatCurrency(product.price, product.currency)}
                  </div>
                  {hasDiscount && (
                    <div className="text-xs text-[hsl(var(--muted-foreground))] line-through">
                      {formatCurrency(product.compare_price, product.currency)}
                    </div>
                  )}
                </td>
                <td className="hidden px-4 py-2.5 lg:table-cell">
                  {product.track_stock ? (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums">{product.stock}</span>
                      <Badge variant={stockMeta.tone} className="text-[10px]">{stockMeta.label}</Badge>
                    </div>
                  ) : (
                    <span className="text-xs text-[hsl(var(--muted-foreground))]">Sin control</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={product.published ? 'success' : 'warning'} className="text-[10px]">
                    {product.published ? 'Publicado' : 'Borrador'}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 sm:opacity-100">
                    {onEdit && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEdit(product) }}
                        className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                        title="Editar"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onDelete(product) }}
                        className="rounded-lg p-1.5 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-red-50 hover:text-red-500"
                        title="Eliminar"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
