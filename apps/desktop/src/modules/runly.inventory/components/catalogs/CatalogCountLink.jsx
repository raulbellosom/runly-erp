import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '@runly/ui'
import { X } from 'lucide-react'

export const INVENTORY_PATH = '/app/m/runly.inventory/inventory'
export const CATALOGS_PATH = '/app/m/runly.inventory/inventory/catalogs'

// Count chip that opens the related list already filtered (inventory items,
// or another catalog tab). Without `to` it is a plain badge.
export function CatalogCountLink({ label, to }) {
  if (!to) return <Badge variant="outline" className="text-xs">{label}</Badge>
  return (
    <Link
      to={to}
      className="inline-flex items-center rounded-full border border-[hsl(var(--border))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 hover:text-[hsl(var(--primary))]"
    >
      {label}
    </Link>
  )
}

// Shows the filter a deep link applied (e.g. "Tipo: Laptop") with a way to clear it.
export function ActiveFilterChip({ label, onClear }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-[hsl(var(--muted-foreground))]">Filtrado por</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(var(--primary))]/10 px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--primary))]">
        {label}
        <button type="button" onClick={onClear} aria-label="Quitar filtro" className="ml-0.5 rounded-full px-1 hover:bg-[hsl(var(--primary))]/20"><X className="h-3 w-3" /></button>
      </span>
    </div>
  )
}

// Reads a catalog deep-link filter (?typeId=, ?brandId=) and clears it in place.
export function useCatalogUrlFilter(key) {
  const [searchParams, setSearchParams] = useSearchParams()
  const value = searchParams.get(key)
  const clear = () => setSearchParams((prev) => { const next = new URLSearchParams(prev); next.delete(key); return next }, { replace: true })
  return [value, clear]
}
