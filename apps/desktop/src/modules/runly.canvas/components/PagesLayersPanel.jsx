import { Button, cn } from '@runly/ui'
import { Database, Eye, EyeOff, FileText, Image, Loader2, Lock, LockOpen, MapPin, Plus, Shapes } from 'lucide-react'

// Layer names depend on the Board template ("Espacios", "Documento"…); the
// kind is what decides behaviour, so the panel always shows it.
const LAYER_KINDS = {
  background: { icon: Image, label: 'Fondo', help: 'aquí quedan los planos, imágenes y PDF que insertas; bloquéala para que no se muevan.' },
  vector: { icon: Shapes, label: 'Dibujo', help: 'formas, textos, flechas e imágenes.' },
  hotspot: { icon: MapPin, label: 'Puntos', help: 'hotspots con información, archivos y registros vinculados (doble clic para abrir).' },
  data: { icon: Database, label: 'Datos', help: 'formas conectadas a registros de Runly (inventario, vehículos…) que muestran su estado. Usa "Conectar a datos" en el inspector.' },
}
const KIND_ORDER = ['background', 'vector', 'hotspot', 'data']
export const layerKind = (layer) => (layer.type === 'vector' && layer.metadata?.mediaTarget ? 'background' : LAYER_KINDS[layer.type] ? layer.type : 'vector')

function SectionTitle({ children, action }) {
  return (
    <div className="flex h-9 items-center justify-between px-1">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">{children}</h2>
      {action}
    </div>
  )
}

function RowIconButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(event) => { event.stopPropagation(); onClick() }}
      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50 lg:h-7 lg:w-7"
    >
      {children}
    </button>
  )
}

export function PagesLayersPanel({ pages, activePageId, onPageChange, activeLayerId, onLayerChange, onAddPage, addingPage, onToggleLayer, onAddDataLayer, addingLayer = false, objectCounts, readOnly = false }) {
  const layers = pages.find((page) => page.id === activePageId)?.layers ?? []
  const kinds = new Set(layers.map(layerKind))
  const activeKind = layerKind(layers.find((layer) => layer.id === activeLayerId) ?? {})
  const missingData = !readOnly && layers.length > 0 && !kinds.has('data') && onAddDataLayer
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-3">
      <section aria-labelledby="canvas-pages-title">
        <SectionTitle action={readOnly ? null : (
          <Button type="button" size="icon" variant="ghost" onClick={onAddPage} disabled={addingPage} aria-label="Nueva página" className="h-9 w-9 lg:h-7 lg:w-7">
            {addingPage ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}
          </Button>
        )}>
          <span id="canvas-pages-title">Páginas</span>
        </SectionTitle>
        <ul className="space-y-0.5">
          {pages.map((page) => {
            const active = page.id === activePageId
            return (
              <li key={page.id}>
                <button
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onPageChange(page.id)}
                  className={cn(
                    'flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors lg:h-9',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                    active ? 'bg-[hsl(var(--muted))] font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/0.6)] hover:text-[hsl(var(--foreground))]',
                  )}
                >
                  <FileText className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                  <span className="truncate">{page.name}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <section aria-labelledby="canvas-layers-title">
        <SectionTitle><span id="canvas-layers-title">Capas</span></SectionTitle>
        {layers.length ? (
          <ul className="space-y-0.5">
            {layers.map((layer) => {
              const kind = LAYER_KINDS[layerKind(layer)], Icon = kind.icon, active = layer.id === activeLayerId
              const count = objectCounts?.[layer.id] ?? 0
              return (
                <li
                  key={layer.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-lg pr-1 transition-colors',
                    active ? 'bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted)/0.6)]',
                  )}
                >
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => onLayerChange(layer.id)}
                    className={cn(
                      'flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-sm lg:h-9',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                      active ? 'font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]',
                      !layer.visible && 'opacity-50',
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate">{layer.name}</span>
                      <span className="truncate text-[11px] font-normal text-[hsl(var(--muted-foreground))]">{kind.label}</span>
                    </span>
                    {count ? <span className="ml-auto text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{count}</span> : null}
                  </button>
                  {readOnly ? (
                    // Visibility and lock are shared board settings: read-only users only see them.
                    <span className="flex shrink-0 items-center gap-1 px-1.5 text-[hsl(var(--muted-foreground))]" aria-label={`${layer.visible ? 'Visible' : 'Oculta'}${layer.locked ? ', bloqueada' : ''}`}>
                      {layer.visible ? null : <EyeOff className="h-4 w-4" />}
                      {layer.locked ? <Lock className="h-4 w-4" /> : null}
                    </span>
                  ) : (
                    <>
                      <RowIconButton label={layer.visible ? `Ocultar ${layer.name}` : `Mostrar ${layer.name}`} onClick={() => onToggleLayer(layer, { visible: !layer.visible })}>
                        {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </RowIconButton>
                      <RowIconButton label={layer.locked ? `Desbloquear ${layer.name}` : `Bloquear ${layer.name}`} onClick={() => onToggleLayer(layer, { locked: !layer.locked })}>
                        {layer.locked ? <Lock className="h-4 w-4 text-[hsl(var(--foreground))]" /> : <LockOpen className="h-4 w-4" />}
                      </RowIconButton>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-1 text-xs text-[hsl(var(--muted-foreground))]">Esta página no tiene capas.</p>
        )}
        {missingData ? (
          <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={onAddDataLayer} disabled={addingLayer}>
            {addingLayer ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Database />}Agregar capa de datos
          </Button>
        ) : null}
      </section>

      <section aria-label="Tipos de capa" className="mt-auto space-y-1.5 rounded-xl bg-[hsl(var(--muted)/0.5)] p-3 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        <p>Los nombres cambian según la plantilla; el ícono y la etiqueta indican el <strong className="font-semibold text-[hsl(var(--foreground))]">tipo</strong> de cada capa:</p>
        {KIND_ORDER.filter((key) => kinds.has(key)).map((key) => {
          const { icon: KindIcon, label, help } = LAYER_KINDS[key]
          return (
            <p key={key} className={cn('flex gap-1.5', key === activeKind && 'text-[hsl(var(--foreground))]')}>
              <KindIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span><strong className="font-semibold text-[hsl(var(--foreground))]">{label}:</strong> {help}</span>
            </p>
          )
        })}
      </section>
    </div>
  )
}
