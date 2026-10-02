import { useState } from 'react'
import { toast } from 'sonner'
import { ActionMenu, Button, ConfirmDialog, Input, cn } from '@runly/ui'
import { FileText, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useDeletePage, useUpdatePage } from '../../hooks/useCanvasData.js'

// Content of the "Páginas" accordion item: a height-capped, scrollable list
// (pages can outnumber what fits before layers) plus the existing "add page"
// action. The active page stays visible via the accordion trigger's own
// label (built by the caller), not inside this list. Editors additionally
// get a per-row menu to rename (inline Input, same row) or delete (disabled
// when it is the only page — a Board must keep at least one).
export function PagesSection({ boardId, pages, activePageId, onPageChange, onAddPage, addingPage, readOnly }) {
  const updatePage = useUpdatePage(boardId), deletePage = useDeletePage(boardId)
  const [renamingId, setRenamingId] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  function startRename(page) { setRenamingId(page.id); setRenameValue(page.name) }
  function cancelRename() { setRenamingId(null); setRenameValue('') }
  function commitRename(page) {
    const trimmed = renameValue.trim().slice(0, 200)
    cancelRename()
    if (!trimmed || trimmed === page.name) return
    updatePage.mutate({ pageId: page.id, data: { name: trimmed } }, { onError: (error) => toast.error(error.message) })
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    const wasActive = deleteTarget.id === activePageId
    const remaining = pages.filter((page) => page.id !== deleteTarget.id)
    try {
      await deletePage.mutateAsync(deleteTarget.id)
      setDeleteTarget(null)
      if (wasActive && remaining[0]) onPageChange(remaining[0].id)
    } catch (error) { toast.error(error.message) }
  }

  return (
    <div className="space-y-2">
      <ul className="max-h-48 space-y-0.5 overflow-y-auto overscroll-contain">
        {pages.map((page) => {
          const active = page.id === activePageId
          const renaming = renamingId === page.id
          return (
            <li key={page.id} className="group relative flex items-center">
              {renaming ? (
                <Input
                  autoFocus
                  value={renameValue}
                  maxLength={200}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onBlur={() => commitRename(page)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); commitRename(page) }
                    else if (event.key === 'Escape') { event.preventDefault(); cancelRename() }
                  }}
                  className="h-11 flex-1 lg:h-9"
                />
              ) : (
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onPageChange(page.id)}
                  className={cn(
                    'flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors lg:h-9',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                    !readOnly && 'pr-9',
                    active ? 'bg-[hsl(var(--muted))] font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/0.6)] hover:text-[hsl(var(--foreground))]',
                  )}
                >
                  <FileText className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                  <span className="truncate">{page.name}</span>
                </button>
              )}
              {!readOnly && !renaming ? (
                <div className="absolute right-1 top-1/2 z-10 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
                  <ActionMenu
                    label="Más opciones de página"
                    items={[
                      { label: 'Renombrar', icon: Pencil, onClick: () => startRename(page) },
                      { label: 'Eliminar', icon: Trash2, onClick: () => setDeleteTarget(page), disabled: pages.length <= 1, variant: 'destructive' },
                    ]}
                  />
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
      {!readOnly ? (
        <Button type="button" variant="outline" size="sm" className="w-full" onClick={onAddPage} disabled={addingPage}>
          {addingPage ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}Nueva página
        </Button>
      ) : null}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title={`Eliminar «${deleteTarget?.name ?? ''}»`}
        description="Se eliminarán sus capas y elementos."
        confirmLabel="Eliminar"
        loading={deletePage.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
