import { Badge, Button } from '@runly/ui'
import { MousePointerClick, Trash2, Users } from 'lucide-react'

const TYPE_LABELS = { rectangle: 'Rectángulo', hotspot: 'Hotspot', ellipse: 'Elipse', line: 'Línea', arrow: 'Flecha', text: 'Texto' }

function Field({ label, children }) {
  return (
    <div className="min-w-0 rounded-lg bg-[hsl(var(--muted)/0.6)] px-2.5 py-2">
      <dt className="text-[11px] text-[hsl(var(--muted-foreground))]">{label}</dt>
      <dd className="truncate font-mono text-sm tabular-nums text-[hsl(var(--foreground))]">{children}</dd>
    </div>
  )
}

function SectionTitle({ children }) {
  return <h2 className="flex h-9 items-center px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{children}</h2>
}

export function BoardInspector({ selected, layerName, presence, onDelete }) {
  const t = selected?.transform ?? {}, g = selected?.geometry ?? {}
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-3">
      <section aria-labelledby="canvas-inspector-title">
        <SectionTitle><span id="canvas-inspector-title">Selección</span></SectionTitle>
        {selected ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="truncate text-sm font-medium">{TYPE_LABELS[selected.type] ?? selected.type}</span>
              {layerName ? <Badge variant="outline" className="shrink-0">{layerName}</Badge> : null}
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <Field label="X">{Math.round(t.x ?? 0)}</Field>
              <Field label="Y">{Math.round(t.y ?? 0)}</Field>
              <Field label="Ancho">{Math.round(g.width ?? 0)}</Field>
              <Field label="Alto">{Math.round(g.height ?? 0)}</Field>
              <Field label="Rotación">{Math.round(t.rotation ?? 0)}°</Field>
              <Field label="Revisión">{selected.revision}</Field>
            </dl>
            {onDelete ? (
              <Button type="button" variant="outline" className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={onDelete}>
                <Trash2 />Eliminar objeto
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-4 py-6 text-center">
            <MousePointerClick className="h-5 w-5 text-[hsl(var(--muted-foreground))]" />
            <p className="text-sm text-[hsl(var(--muted-foreground))]">Selecciona un objeto en el lienzo para ver sus propiedades.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="canvas-presence-title">
        <SectionTitle><span id="canvas-presence-title">En este Board</span></SectionTitle>
        {presence.length ? (
          <ul className="space-y-1">
            {presence.map((user) => (
              <li key={user.id} className="flex items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm">
                <span className="relative flex h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                <span className="truncate">{user.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 px-1 text-sm text-[hsl(var(--muted-foreground))]"><Users className="h-4 w-4" />Solo tú por ahora.</p>
        )}
      </section>
    </div>
  )
}
