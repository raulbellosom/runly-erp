import { useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, SelectField, TextField } from '@runly/ui'
import { Loader2 } from 'lucide-react'

const UNIT_OPTIONS = [
  { value: 'm', label: 'Metros (m)' },
  { value: 'cm', label: 'Centímetros (cm)' },
  { value: 'mm', label: 'Milímetros (mm)' },
  { value: 'ft', label: 'Pies (ft)' },
]

// Opens after dragging a line of known length: the user types what that line
// really measures and the page's scale is derived from pixels / that value.
export function CalibrateDialog({ open, onOpenChange, pixels, onSave, pending = false }) {
  const [length, setLength] = useState(''), [unit, setUnit] = useState('m')
  const parsed = Number(String(length).replace(',', '.'))
  const valid = Number.isFinite(parsed) && parsed > 0

  function handleOpenChange(next) {
    if (!next) { setLength(''); setUnit('m') }
    onOpenChange(next)
  }

  function save(event) {
    event.preventDefault()
    if (!valid) return
    onSave(parsed, unit)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={save}>
          <DialogHeader>
            <DialogTitle>Calibrar escala</DialogTitle>
            <DialogDescription>La línea mide {Math.round(pixels ?? 0)} px en el lienzo. Indica cuánto mide en la realidad.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <TextField
              label="Longitud real"
              inputMode="decimal"
              autoFocus
              value={length}
              onChange={(event) => setLength(event.target.value)}
              placeholder="Ej. 5"
            />
            <SelectField label="Unidad" options={UNIT_OPTIONS} value={unit} onValueChange={setUnit} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={!valid || pending}>
              {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
