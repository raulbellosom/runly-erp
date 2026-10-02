import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SelectField, TextField } from '@runly/ui'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../../../../auth/AuthProvider.jsx'
import { runly } from '../../../../lib/runly.js'
import { objectLabel } from '../../lib/objectFactory.js'
import { normalizeObjects } from '../../lib/libraryImport/normalize.js'
import { useLibraries } from '../../hooks/useLibraries.js'

const NEW_LIBRARY = '__new__'

// "Guardar en biblioteca" from the quick-actions menu and the inspector
// (spec §8): saves the current selection as one new library item, relative
// to its own bounding box (normalizeObjects), so it re-centers anywhere on
// insert. Target is an existing editable library or a brand new personal one.
export function SaveToLibraryDialog({ open, onOpenChange, rows = [] }) {
  const { session } = useAuth()
  const token = session?.access_token
  const client = useQueryClient()
  const libraries = useLibraries()
  const [libraryId, setLibraryId] = useState('')
  const [newName, setNewName] = useState('')
  const [itemName, setItemName] = useState('')
  const [saving, setSaving] = useState(false)

  const editable = (libraries.data ?? []).filter((library) => library.canEdit)
  const options = [
    ...editable.map((library) => ({ value: library.id, label: library.name })),
    { value: NEW_LIBRARY, label: 'Nueva biblioteca…' },
  ]
  const defaultItemName = rows.length === 1 ? objectLabel(rows[0]) : 'Selección'
  const valid = rows.length > 0 && itemName.trim().length > 0 && (libraryId !== NEW_LIBRARY || newName.trim().length > 0)

  function handleOpenChange(next) {
    if (next) { setLibraryId(editable[0]?.id ?? NEW_LIBRARY); setNewName(''); setItemName(defaultItemName) }
    onOpenChange(next)
  }

  async function save(event) {
    event.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    try {
      let targetId = libraryId
      if (targetId === NEW_LIBRARY) {
        const created = await runly.canvas.createLibrary({ name: newName.trim(), scope: 'PERSONAL' }, token)
        targetId = created.id
      }
      const normalized = normalizeObjects(rows)
      await runly.canvas.addLibraryItems(targetId, [{ name: itemName.trim(), kind: 'objects', payload: normalized, width: normalized.width, height: normalized.height }], token)
      client.invalidateQueries({ queryKey: ['canvas', 'libraries'] })
      client.invalidateQueries({ queryKey: ['canvas', 'libraries', targetId, 'items'] })
      toast.success('Guardado en la biblioteca')
      onOpenChange(false)
    } catch (error) {
      toast.error(error?.message ?? 'No se pudo guardar el elemento.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Guardar en biblioteca</DialogTitle>
            <DialogDescription>
              {rows.length === 1 ? 'Guarda este elemento para reutilizarlo en otros Boards.' : `Guarda estos ${rows.length} elementos juntos como uno solo.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <SelectField label="Biblioteca destino" options={options} value={libraryId} onValueChange={setLibraryId} />
            {libraryId === NEW_LIBRARY ? (
              <TextField label="Nombre de la biblioteca" value={newName} onChange={(event) => setNewName(event.target.value)} autoFocus maxLength={200} placeholder="Ej. Mi kit de señalética" />
            ) : null}
            <TextField label="Nombre del elemento" value={itemName} onChange={(event) => setItemName(event.target.value)} maxLength={200} placeholder="Ej. Letrero de salida" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
