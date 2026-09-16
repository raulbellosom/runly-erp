import { useState } from 'react'
import { useCurrentEditor } from '@tiptap/react'
import { Table2 } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, useCoarsePointer } from '@runly/ui'
import { getTableMenuActions, tableMenuSections } from '../lib/tableMenuActions.js'

// Touch-only replacement for the desktop toolbar's inline "Tabla" popover
// (NoteToolbar.jsx), which is easy to lose inside the horizontally-scrolling
// mobile toolbar. Renders nothing on a fine-pointer (mouse/trackpad) device —
// the existing toolbar popover keeps working there unchanged.
export function TableFloatingMenu() {
  const { editor } = useCurrentEditor()
  const isCoarsePointer = useCoarsePointer()
  const [open, setOpen] = useState(false)

  if (!editor || !isCoarsePointer || !editor.isActive('table')) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Opciones de tabla"
        title="Opciones de tabla"
        className="fixed z-20 flex items-center justify-center w-12 h-12 rounded-full bg-amber-500 text-white shadow-lg active:scale-95 transition-transform"
        style={{ left: '1rem', bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
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
