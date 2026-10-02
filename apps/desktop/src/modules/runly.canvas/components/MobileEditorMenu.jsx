import { useState } from 'react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, cn,
} from '@runly/ui'
import { Download, History, MoreHorizontal, PanelLeft, PanelRight, Pencil, Share2, Trash2 } from 'lucide-react'
import { canEditBoard } from '../lib/roles.js'

const EXPORT_FORMATS = [
  { format: 'png', label: 'Imagen PNG' },
  { format: 'pdf', label: 'PDF' },
]

// Phone top bar (see EditorTopBar) has no room for nine separate buttons, so
// panel toggles, share, versions, export and the Board danger-zone actions
// all collapse into this single "Más opciones" overflow menu.
export function MobileEditorMenu({
  leftOpen, onToggleLeft, rightOpen, onToggleRight, onShare, onVersions, onExport, exportDisabled,
  myRole, onRenameBoard, onDeleteBoard,
}) {
  const [exporting, setExporting] = useState(false)
  const runExport = async (format) => {
    setExporting(true)
    try { await onExport(format) } finally { setExporting(false) }
  }
  const showRename = canEditBoard(myRole) && onRenameBoard
  const showDelete = myRole === 'OWNER' && onDeleteBoard

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button" size="icon" variant="ghost" aria-label="Más opciones"
          className="h-10 w-10 shrink-0 rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem onSelect={onToggleLeft} className={cn('gap-2.5', leftOpen && 'font-semibold')}>
          <PanelLeft className="h-4 w-4" />Páginas y capas
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleRight} className={cn('gap-2.5', rightOpen && 'font-semibold')}>
          <PanelRight className="h-4 w-4" />Propiedades
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onShare} className="gap-2.5"><Share2 className="h-4 w-4" />Compartir</DropdownMenuItem>
        <DropdownMenuItem onSelect={onVersions} className="gap-2.5"><History className="h-4 w-4" />Versiones</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="gap-2.5"><Download className="h-4 w-4" />Exportar</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {EXPORT_FORMATS.map(({ format, label }) => (
              <DropdownMenuItem key={format} disabled={exportDisabled || exporting} onSelect={() => runExport(format)}>{label}</DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {showRename || showDelete ? <DropdownMenuSeparator /> : null}
        {showRename ? <DropdownMenuItem onSelect={onRenameBoard} className="gap-2.5"><Pencil className="h-4 w-4" />Renombrar Board</DropdownMenuItem> : null}
        {showDelete ? (
          <DropdownMenuItem onSelect={onDeleteBoard} className="gap-2.5 text-destructive focus:text-destructive">
            <Trash2 className="h-4 w-4" />Eliminar Board
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
