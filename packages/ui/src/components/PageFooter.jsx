import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button.jsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './Select.jsx'
import { cn } from '../lib/utils.js'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

// Pagination footer under a table: a quiet line (no band of its own) with the
// record count, rows-per-page and the pager. The page-size picker and pager
// only appear when there is more than one page's worth of rows.
export function PageFooter({
  total = 0,
  pageIndex = 0,
  pageCount = 1,
  pageSize = 10,
  onPrevious,
  onNext,
  canPrevious = false,
  canNext = false,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
}) {
  const from = total === 0 ? 0 : pageIndex * pageSize + 1
  const to = Math.min((pageIndex + 1) * pageSize, total)
  const showSize = Boolean(onPageSizeChange) && total > Math.min(...pageSizeOptions)
  const showPager = pageCount > 1

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 px-1 pt-3 text-xs text-[hsl(var(--muted-foreground))]', className)}>
      <p className="tabular-nums">
        {total === 0 ? 'Sin registros' : total <= pageSize ? `${total} ${total === 1 ? 'registro' : 'registros'}` : `${from}–${to} de ${total} registros`}
      </p>

      {(showSize || showPager) && (
        <div className="flex items-center gap-4">
          {showSize && (
            <div className="flex items-center gap-2">
              <span className="hidden sm:inline">Filas por página</span>
              <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
                <SelectTrigger className="h-8 w-18 rounded-lg px-2.5 text-xs" aria-label="Filas por página">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pageSizeOptions.map((s) => (
                    <SelectItem key={s} value={String(s)} className="text-xs">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {showPager && (
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="icon-sm" className="h-8 w-8 rounded-lg" aria-label="Página anterior" onClick={onPrevious} disabled={!canPrevious}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="min-w-20 text-center tabular-nums">Página {pageIndex + 1} de {pageCount}</span>
              <Button variant="outline" size="icon-sm" className="h-8 w-8 rounded-lg" aria-label="Página siguiente" onClick={onNext} disabled={!canNext}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
