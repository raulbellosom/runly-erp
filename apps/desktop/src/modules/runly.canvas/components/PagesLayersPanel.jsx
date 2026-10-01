import { Button, cn } from '@runly/ui'
import { Database, Eye, EyeOff, FileText, Image, Loader2, Lock, LockOpen, MapPin, Plus, Shapes } from 'lucide-react'

const LAYER_ICONS = { vector: Shapes, hotspot: MapPin, data: Database, background: Image }

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

export function PagesLayersPanel({ pages, activePageId, onPageChange, activeLayerId, onLayerChange, onAddPage, addingPage, onToggleLayer, objectCounts }) {
  const layers = pages.find((page) => page.id === activePageId)?.layers ?? []
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain p-3">
      <section aria-labelledby="canvas-pages-title">
        <SectionTitle action={(
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
              const Icon = LAYER_ICONS[layer.type] ?? Shapes, active = layer.id === activeLayerId
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
                    <span className="truncate">{layer.name}</span>
                    {count ? <span className="ml-auto text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{count}</span> : null}
                  </button>
                  <RowIconButton label={layer.visible ? `Ocultar ${layer.name}` : `Mostrar ${layer.name}`} onClick={() => onToggleLayer(layer, { visible: !layer.visible })}>
                    {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                  </RowIconButton>
                  <RowIconButton label={layer.locked ? `Desbloquear ${layer.name}` : `Bloquear ${layer.name}`} onClick={() => onToggleLayer(layer, { locked: !layer.locked })}>
                    {layer.locked ? <Lock className="h-4 w-4 text-[hsl(var(--foreground))]" /> : <LockOpen className="h-4 w-4" />}
                  </RowIconButton>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-1 text-xs text-[hsl(var(--muted-foreground))]">Esta página no tiene capas.</p>
        )}
      </section>
    </div>
  )
}
