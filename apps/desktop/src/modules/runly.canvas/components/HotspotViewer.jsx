import { Badge, IconGlyph } from '@runly/ui'

export const HOTSPOT_STATUS_LABELS = { ACTIVE: 'Activo', REVIEW: 'En revisión', RESOLVED: 'Resuelto', INACTIVE: 'Inactivo' }
const STATUS_VARIANT = { ACTIVE: 'default', REVIEW: 'outline', RESOLVED: 'secondary', INACTIVE: 'outline' }

// Read-only presentation of a hotspot: used for viewers inside Runly and on
// public board links.
export function HotspotViewer({ hotspot, color }) {
  const pin = color || hotspot?.color || '#ef4444'
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-white shadow-sm" style={{ backgroundColor: pin }} aria-hidden>
          {hotspot?.icon ? <IconGlyph name={hotspot.icon} className="h-6 w-6" strokeWidth={2.25} /> : <span className="h-3.5 w-3.5 rounded-full bg-white" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold leading-snug break-words">{hotspot?.title || 'Hotspot'}</h3>
          {hotspot?.status ? <Badge variant={STATUS_VARIANT[hotspot.status] ?? 'outline'} className="mt-1">{HOTSPOT_STATUS_LABELS[hotspot.status] ?? hotspot.status}</Badge> : null}
        </div>
      </div>
      {hotspot?.description ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[hsl(var(--foreground))]">{hotspot.description}</p>
      ) : (
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Este hotspot no tiene descripción.</p>
      )}
    </div>
  )
}
