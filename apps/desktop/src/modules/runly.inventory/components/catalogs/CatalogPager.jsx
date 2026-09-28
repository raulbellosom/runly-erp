import { useEffect, useState } from 'react'
import { Button } from '@runly/ui'
import { ChevronLeft, ChevronRight } from 'lucide-react'

export const CATALOG_PAGE_SIZE = 10

// Client-side paging for the sortable catalog lists. `replacePage` merges a
// reordered page back into the full list so drag-and-drop keeps global order.
export function usePagedList(items, pageSize = CATALOG_PAGE_SIZE) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  useEffect(() => { if (page > pageCount - 1) setPage(pageCount - 1) }, [page, pageCount])
  const start = Math.min(page, pageCount - 1) * pageSize
  return {
    page: Math.min(page, pageCount - 1),
    pageCount,
    setPage,
    start,
    total: items.length,
    pageItems: items.slice(start, start + pageSize),
    replacePage: (reordered) => [...items.slice(0, start), ...reordered, ...items.slice(start + reordered.length)],
  }
}

export function CatalogPager({ page, pageCount, setPage, start, total, pageItems }) {
  if (pageCount <= 1) return null
  return (
    <div className="flex items-center justify-between gap-3 pt-1 text-sm text-[hsl(var(--muted-foreground))]">
      <span>{start + 1}–{start + pageItems.length} de {total}</span>
      <div className="flex items-center gap-1">
        <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="px-2 tabular-nums">{page + 1} / {pageCount}</span>
        <Button type="button" variant="outline" size="sm" disabled={page >= pageCount - 1} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
