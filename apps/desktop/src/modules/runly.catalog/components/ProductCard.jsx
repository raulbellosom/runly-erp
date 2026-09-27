// apps/desktop/src/modules/runly.catalog/components/ProductCard.jsx
import { Badge, Card, Checkbox } from '@runly/ui'
import { ImageOff, Layers } from 'lucide-react'
import { formatCurrency } from '../lib/formatCurrency.js'
import { getStockStatus, STOCK_STATUS_META } from '../lib/stockStatus.js'

// Rich grid tile for the catalog products view — mirrors runly.ledger's
// AccountCard.jsx (image/icon, title block, footer badges). Every value shown
// comes straight from the product row returned by GET /catalog/products.
export default function ProductCard({ product, selected = false, onToggleSelect, onSelect }) {
  const isVariable = product.product_type === 'VARIABLE'
  const stockStatus = getStockStatus({ trackStock: product.track_stock, stock: product.stock ?? 0 })
  const stockMeta = STOCK_STATUS_META[stockStatus]
  const hasDiscount = product.compare_price > product.price

  return (
    <Card
      variant="interactive"
      className={`group flex flex-col overflow-hidden rounded-xl p-0 ${selected ? 'ring-2 ring-(--brand-primary)' : ''}`}
      onClick={() => onSelect(product)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(product)}
    >
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-[hsl(var(--muted))]">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[hsl(var(--muted-foreground))]/40">
            <ImageOff size={24} />
          </div>
        )}
        {onToggleSelect && (
          <div
            className={`absolute right-1.5 top-1.5 rounded-md bg-[hsl(var(--card))]/90 p-0.5 shadow-sm backdrop-blur transition-opacity ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            onClick={e => e.stopPropagation()}
          >
            <Checkbox checked={selected} onCheckedChange={() => onToggleSelect()} aria-label="Seleccionar" />
          </div>
        )}
        <Badge
          variant={product.published ? 'success' : 'warning'}
          className="absolute left-1.5 top-1.5 h-5 px-1.5 py-0 text-[10px] shadow-sm"
        >
          {product.published ? 'Publicado' : 'Borrador'}
        </Badge>
        {isVariable && (
          <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 rounded-md bg-[hsl(var(--card))]/90 px-1.5 py-0.5 text-[9px] font-semibold text-[hsl(var(--foreground))] shadow-sm backdrop-blur">
            <Layers size={10} /> Variable
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-2.5">
        <span className="text-[9px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] truncate">
          {product.category_name ?? 'Sin categoría'}
        </span>
        <h3 className="truncate text-xs font-semibold text-[hsl(var(--foreground))]" title={product.name}>
          {product.name}
        </h3>
        {product.sku && (
          <span className="truncate font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{product.sku}</span>
        )}

        <div className="mt-1.5 flex items-baseline justify-between gap-2 border-t border-[hsl(var(--border))] pt-1.5">
          <div className="min-w-0">
            <span className="text-sm font-bold tabular-nums text-[hsl(var(--foreground))]">
              {formatCurrency(product.price, product.currency)}
            </span>
            {hasDiscount && (
              <span className="ml-1 text-[10px] text-[hsl(var(--muted-foreground))] line-through">
                {formatCurrency(product.compare_price, product.currency)}
              </span>
            )}
          </div>
          {product.track_stock && (
            <Badge variant={stockMeta.tone} className="h-5 shrink-0 px-1.5 py-0 text-[9px]">
              {product.stock}
            </Badge>
          )}
        </div>
      </div>
    </Card>
  )
}
