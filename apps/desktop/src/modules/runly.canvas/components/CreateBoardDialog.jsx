import { useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Label, Textarea, cn } from '@runly/ui'
import { Loader2 } from 'lucide-react'
import { BOARD_TEMPLATES } from '../lib/boardMeta.js'

const EMPTY = { name: '', description: '', templateType: 'blank' }

export function CreateBoardDialog({ open, onOpenChange, onSubmit, pending }) {
  const [form, setForm] = useState(EMPTY)
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const close = (next) => { onOpenChange(next); if (!next) setForm(EMPTY) }

  async function submit(event) {
    event.preventDefault()
    if (pending || !form.name.trim()) return
    const ok = await onSubmit({ ...form, name: form.name.trim(), description: form.description.trim() || undefined })
    if (ok) setForm(EMPTY)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="flex max-h-[min(90dvh,720px)] flex-col gap-0 p-0 sm:max-w-lg">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="mb-0 shrink-0 px-5 pt-4 pb-2">
            <DialogTitle>Nuevo Board</DialogTitle>
            <DialogDescription>Un espacio visual para planos, mapas técnicos y diagramas conectados con Runly.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="canvas-board-name">Nombre <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="canvas-board-name" value={form.name} onChange={set('name')} placeholder="Ej. Planta baja — almacén" maxLength={200} required autoFocus autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-board-description">Descripción <span className="font-normal text-[hsl(var(--muted-foreground))]">(opcional)</span></Label>
              <Textarea id="canvas-board-description" value={form.description} onChange={set('description')} rows={2} placeholder="¿Para qué se usará este Board?" />
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Plantilla</legend>
              <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {BOARD_TEMPLATES.map(({ value, label, description, icon: Icon }) => {
                  const active = form.templateType === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setForm((current) => ({ ...current, templateType: value }))}
                      className={cn(
                        'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                        active ? 'border-primary bg-primary/8' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.6)]',
                      )}
                    >
                      <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-[hsl(var(--muted-foreground))]')} />
                      <span className="text-sm font-medium leading-tight">{label}</span>
                      <span className="text-xs leading-tight text-[hsl(var(--muted-foreground))]">{description}</span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
          </div>
          <DialogFooter className="mt-0 shrink-0 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancelar</Button>
            <Button type="submit" disabled={!form.name.trim() || pending}>
              {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
              {pending ? 'Creando…' : 'Crear Board'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
