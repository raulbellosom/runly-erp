import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SelectField, TextField } from '@runly/ui'
import { Loader2 } from 'lucide-react'

// Rename one element of a library (tile context menu or F2).
export function RenameItemDialog({ item, onOpenChange, onSubmit, pending }) {
  const [name, setName] = useState('')
  useEffect(() => { if (item) setName(item.name ?? '') }, [item])
  const valid = name.trim().length > 0 && name.trim() !== item?.name
  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={(event) => { event.preventDefault(); if (valid) onSubmit(name.trim()) }}>
          <DialogHeader>
            <DialogTitle>Renombrar elemento</DialogTitle>
            <DialogDescription>El nombre sirve para encontrarlo con la búsqueda de la biblioteca.</DialogDescription>
          </DialogHeader>
          <TextField label="Nombre" value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={200} onFocus={(event) => event.target.select()} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!valid || pending}>{pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}Guardar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// Create or rename a library. Fields are filled from `library` whenever the
// dialog opens (the parent opens it by prop, so onOpenChange never fires).
export function LibraryFormDialog({ open, onOpenChange, library, canManage, onSubmit, pending }) {
  const [name, setName] = useState('')
  const [scope, setScope] = useState('PERSONAL')

  useEffect(() => {
    if (open) { setName(library?.name ?? ''); setScope(library?.scope ?? 'PERSONAL') }
  }, [open, library])

  const valid = name.trim().length > 0
  function submit(event) {
    event.preventDefault()
    if (valid) onSubmit({ name: name.trim(), scope })
  }
  const scopeOptions = [{ value: 'PERSONAL', label: 'Personal: solo tú la ves' }, ...(canManage ? [{ value: 'COMPANY', label: 'Empresa: todo el equipo la ve' }] : [])]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{library ? 'Renombrar biblioteca' : 'Nueva biblioteca'}</DialogTitle>
            <DialogDescription>{library ? 'El nombre se actualiza para todos los que la usan.' : 'Una biblioteca vacía para guardar elementos de tus Boards.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TextField label="Nombre" value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={200} placeholder="Ej. Redes y conectividad" />
            {library ? null : <SelectField label="Quién la ve" value={scope} onValueChange={setScope} options={scopeOptions} />}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!valid || pending}>{pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}{library ? 'Guardar' : 'Crear biblioteca'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
