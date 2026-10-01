import { Button, Separator, Tooltip, TooltipContent, TooltipTrigger, cn } from '@runly/ui'
import { Hand, MapPin, MousePointer2, Square, Trash2 } from 'lucide-react'

export const CANVAS_TOOLS = [
  { value: 'select', label: 'Seleccionar', shortcut: 'V', icon: MousePointer2 },
  { value: 'pan', label: 'Mover vista', shortcut: 'H', icon: Hand },
  { value: 'rectangle', label: 'Rectángulo', shortcut: 'R', icon: Square },
  { value: 'hotspot', label: 'Hotspot', shortcut: 'P', icon: MapPin },
]

export function ToolButton({ label, shortcut, active, className, children, ...props }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={shortcut ? `${label} (${shortcut})` : label}
          aria-pressed={active}
          className={cn(
            'rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
            active && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
            className,
          )}
          {...props}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        {label}
        {shortcut ? <kbd className="rounded border border-[hsl(var(--border))] px-1 font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{shortcut}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

export function CanvasToolbar({ tool, onToolChange, canDelete, onDelete }) {
  return (
    <div role="toolbar" aria-label="Herramientas del lienzo" className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5 shadow-lg">
      {CANVAS_TOOLS.map(({ value, label, shortcut, icon: Icon }) => (
        <ToolButton key={value} label={label} shortcut={shortcut} active={tool === value} onClick={() => onToolChange(value)}>
          <Icon />
        </ToolButton>
      ))}
      <Separator orientation="vertical" className="mx-1 h-6" />
      <ToolButton
        label="Eliminar selección"
        shortcut="Supr"
        disabled={!canDelete}
        onClick={onDelete}
        className="hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 />
      </ToolButton>
    </div>
  )
}
