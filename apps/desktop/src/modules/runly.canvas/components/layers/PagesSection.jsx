import { Button, cn } from '@runly/ui'
import { FileText, Loader2, Plus } from 'lucide-react'

// Content of the "Páginas" accordion item: a height-capped, scrollable list
// (pages can outnumber what fits before layers) plus the existing "add page"
// action. The active page stays visible via the accordion trigger's own
// label (built by the caller), not inside this list.
export function PagesSection({ pages, activePageId, onPageChange, onAddPage, addingPage, readOnly }) {
  return (
    <div className="space-y-2">
      <ul className="max-h-48 space-y-0.5 overflow-y-auto overscroll-contain">
        {pages.map((page) => {
          const active = page.id === activePageId
          return (
            <li key={page.id}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                onClick={() => onPageChange(page.id)}
                className={cn(
                  'flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors lg:h-9',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  active ? 'bg-[hsl(var(--muted))] font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/0.6)] hover:text-[hsl(var(--foreground))]',
                )}
              >
                <FileText className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                <span className="truncate">{page.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {!readOnly ? (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onAddPage} disabled={addingPage}>
          {addingPage ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}Nueva página
        </Button>
      ) : null}
    </div>
  )
}
