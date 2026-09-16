import { useEffect, useState } from 'react'
import { useCurrentEditor } from '@tiptap/react'
import { Table2, GripVertical } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, useCoarsePointer } from '@runly/ui'
import { getTableMenuActions, tableMenuSections } from '../lib/tableMenuActions.js'
import { findTableAtSelection } from '../lib/dragReorder.js'
import { useBlockDragReorder } from '../hooks/useBlockDragReorder.js'

// Shared table handle. Mobile keeps the existing fixed bottom-left circular
// button — a tap still opens the options sheet, and press-and-hold now also
// arms a drag. Desktop gets a small grip handle positioned at the table's
// own top-left corner instead — press-and-drag with the mouse to reorder;
// the toolbar's existing "Tabla" dropdown (NoteToolbar.jsx) remains how
// options are reached on desktop, unchanged.
// See docs/superpowers/specs/2026-09-16-notes-table-drag-reorder-design.md.
export function TableFloatingMenu() {
  const { editor } = useCurrentEditor()
  const isCoarsePointer = useCoarsePointer()
  const [open, setOpen] = useState(false)
  const [handleRect, setHandleRect] = useState(null)

  const inTable = Boolean(editor?.isActive('table'))

  useEffect(() => {
    if (!editor || isCoarsePointer || !inTable) {
      setHandleRect(null)
      return
    }
    function recompute() {
      const info = findTableAtSelection(editor.state)
      const dom = info ? editor.view.nodeDOM(info.pos) : null
      setHandleRect(dom?.getBoundingClientRect ? dom.getBoundingClientRect() : null)
    }
    recompute()
    editor.on('selectionUpdate', recompute)
    editor.on('update', recompute)
    window.addEventListener('scroll', recompute, true)
    window.addEventListener('resize', recompute)
    return () => {
      editor.off('selectionUpdate', recompute)
      editor.off('update', recompute)
      window.removeEventListener('scroll', recompute, true)
      window.removeEventListener('resize', recompute)
    }
  }, [editor, isCoarsePointer, inTable])

  function getTableEl() {
    const info = editor ? findTableAtSelection(editor.state) : null
    return info ? editor.view.nodeDOM(info.pos) : null
  }

  const { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, wasDragRef } = useBlockDragReorder({
    editor,
    editable: editor?.isEditable ?? false,
    isEditing: false,
    getPos: () => (editor ? findTableAtSelection(editor.state)?.pos ?? null : null),
    getBoxEl: getTableEl,
    getFrameEl: getTableEl,
  })

  if (!editor || !inTable) return null

  function openSheet() {
    if (wasDragRef.current) {
      wasDragRef.current = false
      return
    }
    setOpen(true)
  }

  return (
    <>
      {isCoarsePointer ? (
        <button
          onClick={openSheet}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          aria-label="Opciones de tabla"
          title="Opciones de tabla"
          className="fixed z-20 flex items-center justify-center w-12 h-12 rounded-full bg-amber-500 text-white shadow-lg active:scale-95 transition-transform"
          style={{ left: '1rem', bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))', touchAction: 'none' }}
        >
          <Table2 className="w-5 h-5" />
        </button>
      ) : handleRect ? (
        <button
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          aria-label="Arrastrar para mover la tabla"
          title="Arrastra para mover la tabla"
          className="fixed z-20 flex items-center justify-center w-6 h-6 rounded bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] shadow-sm text-[hsl(var(--muted-foreground))] cursor-grab active:cursor-grabbing"
          style={{ top: `${handleRect.top - 10}px`, left: `${handleRect.left - 28}px`, touchAction: 'none' }}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Opciones de tabla</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-1">
            {tableMenuSections(getTableMenuActions(editor)).map((section, si) => (
              <div key={section.group}>
                {si > 0 && <div className="my-1 border-t border-border" />}
                {section.items.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => { action.onClick(); setOpen(false) }}
                    className={[
                      'w-full text-left px-3 py-2.5 text-sm rounded-lg transition-colors',
                      action.destructive
                        ? 'text-destructive hover:bg-destructive/10'
                        : 'text-foreground hover:bg-muted',
                    ].join(' ')}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
