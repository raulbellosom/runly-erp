import { Fragment, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, ErrorState, Input, Label, Textarea, cn } from '@runly/ui'
import { Check, Loader2 } from 'lucide-react'
import { useCanvasTemplates } from '../hooks/useCanvasData.js'
import { templateIcon } from '../lib/boardMeta.js'
import { TemplatePreview } from './TemplatePreview.jsx'
import { TemplateCardSkeleton } from './skeletons.jsx'

const EMPTY = { name: '', description: '', templateType: 'blank' }
const HEADING = 'text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]'

function TemplateDetail({ template, className }) {
  return (
    <div className={cn('rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] p-3', className)}>
      <p className={HEADING}>Úsala cuando…</p>
      <p className="mt-1 text-sm">{template.useWhen}</p>
      <p className={cn(HEADING, 'mt-3')}>Incluye</p>
      <ul className="mt-1 space-y-1">
        {template.includes.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />{item}</li>
        ))}
      </ul>
    </div>
  )
}

export function CreateBoardDialog({ open, onOpenChange, onSubmit, pending }) {
  const [form, setForm] = useState(EMPTY)
  const templates = useCanvasTemplates()
  const list = templates.data ?? []
  const selected = list.find((item) => item.key === form.templateType) ?? list[0] ?? null
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  const close = (next) => { onOpenChange(next); if (!next) setForm(EMPTY) }

  async function submit(event) {
    event.preventDefault()
    if (pending || !selected || !form.name.trim()) return
    const ok = await onSubmit({ ...form, templateType: selected.key, name: form.name.trim(), description: form.description.trim() || undefined })
    if (ok) setForm(EMPTY)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent scrollable size="xl" className="gap-0 p-0 md:p-0 md:pt-0!">
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="mb-0 shrink-0 px-5 pt-4 pb-2">
            <DialogTitle>Nuevo Board</DialogTitle>
            <DialogDescription>Elige una plantilla: cada una prepara capas, cuadrícula y herramientas para su uso.</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Plantilla</legend>
              {templates.isError ? (
                <ErrorState title="No se pudieron cargar las plantillas" description={templates.error?.message} onRetry={() => templates.refetch()} />
              ) : templates.isLoading ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <TemplateCardSkeleton key={index} />)}</div>
              ) : (
                <div role="radiogroup" aria-label="Plantilla" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {list.map((template) => {
                    const active = selected?.key === template.key, Icon = templateIcon(template.icon)
                    return (
                      <Fragment key={template.key}>
                        <button
                          type="button" role="radio" aria-checked={active}
                          onClick={() => setForm((current) => ({ ...current, templateType: template.key }))}
                          className={cn(
                            'flex cursor-pointer flex-col items-start gap-1.5 rounded-xl border p-2.5 text-left transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                            active ? 'border-primary bg-primary/8' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.6)]',
                          )}
                        >
                          <TemplatePreview preview={template.preview} grid={template.settings.grid.enabled} className="aspect-120/68 w-full rounded-lg bg-[hsl(var(--muted)/0.5)]" />
                          <span className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                            <Icon className={cn('h-3.5 w-3.5', active ? 'text-primary' : 'text-[hsl(var(--muted-foreground))]')} aria-hidden />{template.label}
                          </span>
                          <span className="text-xs leading-tight text-[hsl(var(--muted-foreground))]">{template.description}</span>
                        </button>
                        {active ? <TemplateDetail template={template} className="sm:hidden" /> : null}
                      </Fragment>
                    )
                  })}
                </div>
              )}
              {selected ? <TemplateDetail template={selected} className="hidden sm:block" /> : null}
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-board-name">Nombre <span className="text-destructive" aria-hidden>*</span></Label>
              <Input id="canvas-board-name" value={form.name} onChange={set('name')} placeholder={selected?.namePlaceholder ?? 'Ej. Planta baja — almacén'} maxLength={200} required autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="canvas-board-description">Descripción <span className="font-normal text-[hsl(var(--muted-foreground))]">(opcional)</span></Label>
              <Textarea id="canvas-board-description" value={form.description} onChange={set('description')} rows={2} placeholder="¿Para qué se usará este Board?" />
            </div>
          </div>
          <DialogFooter className="mt-0 shrink-0 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => close(false)}>Cancelar</Button>
            <Button type="submit" disabled={!form.name.trim() || !selected || pending}>
              {pending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
              {pending ? 'Creando…' : 'Crear Board'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
