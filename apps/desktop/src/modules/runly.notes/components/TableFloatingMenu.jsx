import { useState } from 'react'
import { useCurrentEditor } from '@tiptap/react'
import { Table2 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, useCoarsePointer } from '@runly/ui'
import { getTableMenuActions, tableMenuSections } from '../lib/tableMenuActions.js'
import { findTableAtSelection } from '../lib/dragReorder.js'
import { useBlockDragReorder } from '../hooks/useBlockDragReorder.js'

// Mobile table options. Dedicated grips beside every table are rendered by
// TableDragHandles; this existing button also keeps its long-press gesture.
export function TableFloatingMenu() {
  const { editor } = useCurrentEditor()
  const isCoarsePointer = useCoarsePointer()
  const [open, setOpen] = useState(false)

  const inTable = Boolean(editor?.isActive('table'))

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

  if (!editor || !inTable || !isCoarsePointer) return null

  function openSheet() {
    if (wasDragRef.current) {
      wasDragRef.current = false
      return
    }
    setOpen(true)
  }

  return (
    <>
      <button
        onClick={openSheet}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        // A mobile browser's own long-press context menu otherwise races
        // (and usually wins over) the press-and-hold drag timer in
        // useBlockDragReorder — see the matching fix + comment on
        // ImageAnnotationOverlay.jsx's boxRef.
        onContextMenu={(e) => e.preventDefault()}
        aria-label="Opciones de tabla"
        title="Opciones de tabla"
        className="fixed z-20 flex items-center justify-center w-12 h-12 rounded-full bg-amber-500 text-white shadow-lg active:scale-95 transition-transform"
        style={{
          left: '1rem',
          bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
          touchAction: 'none',
          WebkitTouchCallout: 'none',
          userSelect: 'none',
        }}
      >
        <Table2 className="w-5 h-5" />
      </button>
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
