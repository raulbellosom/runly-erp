import { Button, cn } from '@runly/ui'
import { ChevronRight, Eye, EyeOff, Lock, LockOpen } from 'lucide-react'
import { LAYER_KINDS, layerKind } from '../../lib/layerKinds.js'

// Layer rows are deliberately not sortable. The main control selects the
// layer and expands its elements, while visibility and lock remain explicit.
export function LayerItem({ layer, active, expanded, onActivate, onToggleVisible, onToggleLocked, count, readOnly }) {
  const kind = LAYER_KINDS[layerKind(layer)], Icon = kind.icon

  return (
    <li className={cn('group flex min-h-11 items-center gap-0.5 rounded-xl border border-transparent pr-1 transition-colors [@media(hover:hover)]:min-h-10', active ? 'border-[hsl(var(--border))] bg-[hsl(var(--muted))]' : 'hover:bg-[hsl(var(--muted)/0.6)]')}>
      <button
        type="button"
        aria-pressed={active}
        aria-expanded={expanded}
        aria-label={`${active ? '' : `Seleccionar ${layer.name} y `}${expanded ? 'contraer' : 'expandir'} sus elementos`}
        onClick={onActivate}
        className={cn(
          'flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 self-stretch rounded-xl px-2.5 py-1.5 text-left text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
          active ? 'font-medium text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]',
          !layer.visible && 'opacity-50',
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', active && 'text-primary')} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-tight">
          <span className="truncate" title={layer.name}>{layer.name}</span>
          <span className="truncate text-[11px] font-normal text-[hsl(var(--muted-foreground))]">{kind.label}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{count}</span>
        <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform', expanded && 'rotate-90')} />
      </button>
      {readOnly ? (
        <span className="flex shrink-0 items-center gap-1 px-1.5 text-[hsl(var(--muted-foreground))]" aria-label={`${layer.visible ? 'Visible' : 'Oculta'}${layer.locked ? ', bloqueada' : ''}`}>
          {layer.visible ? null : <EyeOff className="h-4 w-4" />}
          {layer.locked ? <Lock className="h-4 w-4" /> : null}
        </span>
      ) : (
        <>
          <Button type="button" variant="ghost" size="icon" aria-label={layer.visible ? `Ocultar ${layer.name}` : `Mostrar ${layer.name}`} onClick={(event) => { event.stopPropagation(); onToggleVisible() }} className="h-11 w-11 shrink-0 [@media(hover:hover)]:h-8 [@media(hover:hover)]:w-8">
            {layer.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label={layer.locked ? `Desbloquear ${layer.name}` : `Bloquear ${layer.name}`} onClick={(event) => { event.stopPropagation(); onToggleLocked() }} className="h-11 w-11 shrink-0 [@media(hover:hover)]:h-8 [@media(hover:hover)]:w-8">
            {layer.locked ? <Lock className="h-4 w-4 text-[hsl(var(--foreground))]" /> : <LockOpen className="h-4 w-4" />}
          </Button>
        </>
      )}
    </li>
  )
}
