import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, TextField } from '@runly/ui'
import { useDeleteBoard, useRenameBoard } from '../hooks/useCanvasData.js'

// Rename and delete a Board — reused by the home card menu (BoardCard) and
// the editor's "Más" menu (EditorTopBar). Rename is a plain `Dialog` +
// `TextField`; delete requires typing the exact Board name to enable the
// destructive button, same precedent as ChannelDangerZoneTab.jsx
// (ConfirmDialog has no built-in way to gate its confirm button on typed
// text, so this builds the dialog directly, like that component does).
export function BoardActionsDialogs({ board, mode, onClose, onDeleted }) {
  const rename = useRenameBoard(), remove = useDeleteBoard()
  const [name, setName] = useState('')
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    if (mode === 'rename') setName(board?.name ?? '')
    if (mode !== 'delete') setConfirmText('')
  }, [mode, board?.id, board?.name])

  if (!board) return null
  const expectedName = (board.name ?? '').trim()
  const canConfirmDelete = expectedName.length > 0 && confirmText.trim() === expectedName

  async function submitRename() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      await rename.mutateAsync({ boardId: board.id, name: trimmed })
      onClose()
    } catch (error) { toast.error(error.message) }
  }

  async function submitDelete() {
    if (!canConfirmDelete) return
    try {
      await remove.mutateAsync(board.id)
      toast.success('Board eliminado')
      onClose()
      onDeleted?.()
    } catch (error) { toast.error(error.message) }
  }

  return (
    <>
      <Dialog open={mode === 'rename'} onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Renombrar Board</DialogTitle>
          </DialogHeader>
          <TextField
            id="canvas-rename-board-name"
            label="Nombre"
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 200))}
            onKeyDown={(event) => { if (event.key === 'Enter') submitRename() }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={rename.isPending}>Cancelar</Button>
            <Button onClick={submitRename} disabled={!name.trim() || rename.isPending}>
              {rename.isPending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === 'delete'} onOpenChange={(open) => { if (!open) onClose() }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Eliminar «{board.name}»</DialogTitle>
            <DialogDescription>
              Se eliminarán sus páginas, elementos, hotspots, versiones, comentarios, enlaces públicos y archivos. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-1">
            <Label htmlFor="canvas-delete-board-confirm">
              Escribe <span className="font-semibold">{board.name}</span> para confirmar
            </Label>
            <Input
              id="canvas-delete-board-confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              placeholder={board.name}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose} disabled={remove.isPending}>Cancelar</Button>
            <Button variant="destructive" onClick={submitDelete} disabled={!canConfirmDelete || remove.isPending}>
              {remove.isPending ? 'Eliminando…' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
