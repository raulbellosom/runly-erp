import { useState } from 'react'
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@runly/ui'

function TextForm({ initial, onSave, onClose }) {
  const [text, setText] = useState(initial)
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); onSave(text); onClose() }}
      className="flex flex-col"
    >
      <DialogHeader className="border-b border-[hsl(var(--border))] px-5 py-4"><DialogTitle>Editar texto</DialogTitle></DialogHeader>
      <div className="px-5 py-4">
        <Textarea
          aria-label="Texto"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) event.currentTarget.form.requestSubmit() }}
          rows={5}
          autoFocus
          placeholder="Escribe el texto…"
        />
        <p className="mt-1.5 text-xs text-[hsl(var(--muted-foreground))]">Ctrl + Enter para guardar.</p>
      </div>
      <DialogFooter className="mt-0 flex-row border-t border-[hsl(var(--border))] px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose} className="flex-1 sm:flex-none">Cancelar</Button>
        <Button type="submit" disabled={text === initial} className="flex-1 sm:flex-none">Guardar</Button>
      </DialogFooter>
    </form>
  )
}

export function TextEditDialog({ object, onSave, onOpenChange }) {
  return (
    <Dialog open={Boolean(object)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        {object ? <TextForm key={object.id} initial={object.properties?.text ?? ''} onSave={(text) => onSave(object, text)} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}
