import { useMemo, useState } from 'react'
import {
  AttachmentsPanel, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, TextareaField, TextField,
} from '@runly/ui'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useUpdateHotspot } from '../hooks/useCanvasData.js'
import { CANVAS_COLORS } from '../lib/objectFactory.js'
import { hotspotColor } from './inspector/ObjectInspector.jsx'
import { HotspotIconPicker } from './HotspotIconPicker.jsx'
import { EntityLinksSection } from './inspector/EntityLinksSection.jsx'
import { Choice, ColorSwatches, FieldLabel, Section } from './inspector/fields.jsx'
import { HotspotViewer } from './HotspotViewer.jsx'

export const HOTSPOT_STATUSES = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'REVIEW', label: 'En revisión' },
  { value: 'RESOLVED', label: 'Resuelto' },
  { value: 'INACTIVE', label: 'Inactivo' },
]

// Standard attachments panel (multi-upload, lazy thumbnails, file-type
// icons, advanced viewer) wired to the hotspot's own attachment routes.
function AttachmentsSection({ boardId, hotspotId, canUpload = true, canRemove = true }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const config = useMemo(() => ({
    label: 'Archivos',
    listPath: `/canvas/boards/${boardId}/hotspots/:id/attachments`,
    addPath: `/canvas/boards/${boardId}/hotspots/:id/attachments`,
    removePath: `/canvas/boards/${boardId}/hotspots/:id/attachments/:docId`,
    upload: { endpoint: '/files/upload', moduleKey: 'runly.canvas', entityType: 'CanvasHotspot' },
    fields: { fileAssetId: 'fileAssetId', fileAsset: 'fileAsset', createdAt: 'createdAt' },
    signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
  }), [boardId])
  return (
    <Section title="Archivos">
      <AttachmentsPanel
        apiBaseUrl={getApiUrl()}
        token={session?.access_token}
        companyId={activeCompanyId}
        recordId={hotspotId}
        config={config}
        context="detail"
        readOnly={!canUpload}
        showHeading={false}
        showViewToggle
        canRemoveItem={() => canRemove}
        onError={(message) => message && toast.error(message)}
      />
    </Section>
  )
}

function HotspotForm({ boardId, pageId, hotspot, initialColor, links, onClose }) {
  const update = useUpdateHotspot(boardId, pageId)
  const [form, setForm] = useState({
    title: hotspot.title ?? '', description: hotspot.description ?? '', status: hotspot.status ?? 'ACTIVE', color: initialColor, icon: hotspot.icon ?? null,
  })
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const dirty = form.title !== (hotspot.title ?? '') || form.description !== (hotspot.description ?? '') || form.status !== (hotspot.status ?? 'ACTIVE') || form.color !== initialColor || form.icon !== (hotspot.icon ?? null)

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
          <div>
            <FieldLabel>Icono del pin</FieldLabel>
            <HotspotIconPicker value={form.icon} color={form.color} onChange={(value) => set('icon', value)} />
          </div>
          <ColorSwatches label="Color del pin" value={form.color} colors={CANVAS_COLORS} onChange={(value) => set('color', value)} />
        </div>
        <EntityLinksSection boardId={boardId} targetType="HOTSPOT" targetId={hotspot.id} links={links} />
        <AttachmentsSection boardId={boardId} hotspotId={hotspot.id} />
      </div>
      {/* flex-row overrides DialogFooter's stacked mobile layout: one row, shared width. */}
      <DialogFooter className="mt-0 shrink-0 flex-row border-t border-[hsl(var(--border))] px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose} className="flex-1 sm:flex-none">{dirty ? 'Cancelar' : 'Cerrar'}</Button>
        <Button type="submit" disabled={!dirty || update.isPending} className="flex-1 sm:flex-none">
          {update.isPending ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}Guardar
        </Button>
      </DialogFooter>
    </form>
  )
}

// Viewers and commenters get the read-only sheet: hotspot info, linked
// records and files (commenters may still attach files, as the API allows).
function HotspotReadOnly({ boardId, object, links, canAttach, onClose }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4">
        <DialogTitle>Hotspot</DialogTitle>
        <DialogDescription>Tienes acceso de solo lectura a este Board.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 py-5">
        <HotspotViewer hotspot={object.hotspot} color={hotspotColor(object)} />
        <EntityLinksSection boardId={boardId} targetType="HOTSPOT" targetId={object.hotspot.id} links={links} readOnly />
        <AttachmentsSection boardId={boardId} hotspotId={object.hotspot.id} canUpload={canAttach} canRemove={false} />
      </div>
      <DialogFooter className="mt-0 shrink-0 flex-row border-t border-[hsl(var(--border))] px-5 py-4">
        <Button type="button" variant="outline" onClick={onClose} className="flex-1 sm:flex-none">Cerrar</Button>
      </DialogFooter>
    </div>
  )
}

export function HotspotDialog({ boardId, pageId, object, links, onOpenChange, readOnly = false, canAttach = false }) {
  const hotspot = object?.hotspot
  return (
    <Dialog open={Boolean(object)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92dvh,760px)] flex-col gap-0 p-0 sm:max-w-lg">
        {hotspot && readOnly ? (
          <HotspotReadOnly boardId={boardId} object={object} links={links} canAttach={canAttach} onClose={() => onOpenChange(false)} />
        ) : hotspot ? (
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
