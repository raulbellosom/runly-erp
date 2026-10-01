import { useState } from 'react'
import {
  Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, FileUploader, TextareaField, TextField,
} from '@runly/ui'
import { ExternalLink, FileText, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { useAttachmentMutations, useAttachments, useUpdateHotspot } from '../hooks/useCanvasData.js'
import { CANVAS_COLORS } from '../lib/objectFactory.js'
import { hotspotColor } from './inspector/ObjectInspector.jsx'
import { EntityLinksSection } from './inspector/EntityLinksSection.jsx'
import { Choice, ColorSwatches, Section } from './inspector/fields.jsx'

export const HOTSPOT_STATUSES = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'REVIEW', label: 'En revisión' },
  { value: 'RESOLVED', label: 'Resuelto' },
  { value: 'INACTIVE', label: 'Inactivo' },
]

function AttachmentsSection({ boardId, hotspotId }) {
  const { session } = useAuth()
  const attachments = useAttachments(boardId, 'HOTSPOT', hotspotId)
  const { add, remove } = useAttachmentMutations(boardId, 'HOTSPOT', hotspotId)
  const rows = attachments.data ?? []

  async function open(attachment) {
    try {
      const response = await runly.files.getSignedUrl(attachment.fileAssetId, session?.access_token)
      const url = response?.data?.signedUrl ?? response?.signedUrl
      if (url) window.open(url, '_blank', 'noopener')
    } catch (error) { toast.error(error.message) }
  }

  return (
    <Section title="Archivos">
      {rows.length ? (
        <ul className="space-y-1">
          {rows.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] py-1.5 pl-2.5 pr-1">
              <FileText className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
              <span className="min-w-0 flex-1 truncate text-sm">{attachment.label ?? 'Archivo'}</span>
              <Button type="button" size="icon" variant="ghost" aria-label="Abrir archivo" onClick={() => open(attachment)} className="h-9 w-9 sm:h-7 sm:w-7"><ExternalLink className="h-3.5 w-3.5" /></Button>
              <Button type="button" size="icon" variant="ghost" aria-label="Quitar archivo" disabled={remove.isPending} onClick={() => remove.mutate(attachment.id, { onError: (error) => toast.error(error.message) })} className="h-9 w-9 hover:text-destructive sm:h-7 sm:w-7">
                {remove.isPending && remove.variables === attachment.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <FileUploader
        maxSizeMB={25}
        onUpload={(file) => add.mutateAsync(file)}
        onChange={() => toast.success('Archivo agregado')}
        hint="Fotos, fichas técnicas, manuales o cualquier documento de este punto."
        emptyLabel="Adjuntar archivo"
      />
    </Section>
  )
}

function HotspotForm({ boardId, pageId, hotspot, initialColor, links, onClose }) {
  const update = useUpdateHotspot(boardId, pageId)
  const [form, setForm] = useState({
    title: hotspot.title ?? '', description: hotspot.description ?? '', status: hotspot.status ?? 'ACTIVE', color: initialColor,
  })
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const dirty = form.title !== (hotspot.title ?? '') || form.description !== (hotspot.description ?? '') || form.status !== (hotspot.status ?? 'ACTIVE') || form.color !== initialColor

  async function save(event) {
    event.preventDefault()
    if (!form.title.trim()) return toast.error('El título es requerido.')
    try {
      await update.mutateAsync({ hotspotId: hotspot.id, data: { ...form, title: form.title.trim() } })
      toast.success('Hotspot guardado')
      onClose()
    } catch (error) { toast.error(error.message) }
  }

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4">
        <DialogTitle>Hotspot</DialogTitle>
        <DialogDescription>Describe este punto y conéctalo con registros y archivos de Runly.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
        <div className="space-y-4">
          <TextField label="Título" required value={form.title} onChange={(event) => set('title', event.target.value)} maxLength={300} placeholder="Ej. Tablero eléctrico principal" />
          <TextareaField label="Descripción" value={form.description} onChange={(event) => set('description', event.target.value)} rows={3} placeholder="Notas, ubicación exacta, instrucciones…" />
          <Choice label="Estado" value={form.status} options={HOTSPOT_STATUSES} onChange={(value) => set('status', value)} />
          <ColorSwatches label="Color del pin" value={form.color} colors={CANVAS_COLORS} onChange={(value) => set('color', value)} />
        </div>
        <EntityLinksSection boardId={boardId} targetType="HOTSPOT" targetId={hotspot.id} links={links} />
        <AttachmentsSection boardId={boardId} hotspotId={hotspot.id} />
      </div>
      <DialogFooter className="shrink-0 border-t border-[hsl(var(--border))] px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose}>{dirty ? 'Cancelar' : 'Cerrar'}</Button>
        <Button type="submit" disabled={!dirty || update.isPending}>
          {update.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}Guardar
        </Button>
      </DialogFooter>
    </form>
  )
}

export function HotspotDialog({ boardId, pageId, object, links, onOpenChange }) {
  const hotspot = object?.hotspot
  return (
    <Dialog open={Boolean(object)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,760px)] flex-col gap-0 p-0 sm:max-w-lg">
        {hotspot ? (
          <HotspotForm key={hotspot.id} boardId={boardId} pageId={pageId} hotspot={hotspot} initialColor={hotspotColor(object)} links={links} onClose={() => onOpenChange(false)} />
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <DialogTitle className="text-base">Preparando hotspot…</DialogTitle>
            <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground))]" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
