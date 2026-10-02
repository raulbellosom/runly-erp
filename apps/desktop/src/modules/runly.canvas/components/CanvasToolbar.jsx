import { useState } from 'react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Separator, Tooltip, TooltipContent, TooltipTrigger, cn,
} from '@runly/ui'
import { ArrowUpRight, ChevronUp, Circle, Database, Diamond, Hand, ImagePlus, Loader2, MapPin, Minus, MousePointer2, Square, Trash2, Triangle, Type } from 'lucide-react'
import { SHAPE_TOOLS } from '../lib/objectFactory.js'

export const SHAPES = {
  rectangle: { label: 'Rectángulo', shortcut: 'R', icon: Square },
  ellipse: { label: 'Elipse', shortcut: 'O', icon: Circle },
  triangle: { label: 'Triángulo', icon: Triangle },
  diamond: { label: 'Rombo', icon: Diamond },
  line: { label: 'Línea', shortcut: 'L', icon: Minus },
  arrow: { label: 'Flecha', shortcut: 'A', icon: ArrowUpRight },
}

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

// One button remembers the last shape used; its menu lists every shape.
function ShapePicker({ tool, onToolChange }) {
  const [lastShape, setLastShape] = useState('rectangle')
  const current = SHAPE_TOOLS.includes(tool) ? tool : lastShape
  const meta = SHAPES[current], Icon = meta.icon
  const choose = (value) => { setLastShape(value); onToolChange(value) }
  return (
    <div className="flex items-center">
      <ToolButton label={meta.label} shortcut={meta.shortcut} active={SHAPE_TOOLS.includes(tool)} onClick={() => choose(current)} className="rounded-r-none">
        <Icon />
      </ToolButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" aria-label="Más formas" className="h-11 w-6 rounded-l-none rounded-r-lg px-0 text-[hsl(var(--muted-foreground))] sm:h-9 sm:w-5">
            <ChevronUp className="size-3.5!" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" className="min-w-44">
          {SHAPE_TOOLS.map((value) => {
            const { label, shortcut, icon: ItemIcon } = SHAPES[value]
            return (
              <DropdownMenuItem key={value} onSelect={() => choose(value)} className={cn('gap-2.5', tool === value && 'font-semibold')}>
                <ItemIcon className="h-4 w-4" />{label}
                {shortcut ? <span className="ml-auto font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{shortcut}</span> : null}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function CanvasToolbar({ tool, onToolChange, canDelete, onDelete, onInsertMedia, onInsertData, inserting, readOnly = false }) {
  if (readOnly) {
    return (
      <div role="toolbar" aria-label="Herramientas del lienzo" className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5 shadow-lg">
        <ToolButton label="Seleccionar" shortcut="V" active={tool === 'select'} onClick={() => onToolChange('select')}><MousePointer2 /></ToolButton>
        <ToolButton label="Mover vista" shortcut="H" active={tool === 'pan'} onClick={() => onToolChange('pan')}><Hand /></ToolButton>
        <span className="px-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">Solo lectura · toca un hotspot para verlo</span>
      </div>
    )
  }
  return (
    <div role="toolbar" aria-label="Herramientas del lienzo" className="glass pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1.5 shadow-lg sm:gap-1">
      <ToolButton label="Seleccionar" shortcut="V" active={tool === 'select'} onClick={() => onToolChange('select')}><MousePointer2 /></ToolButton>
      <ToolButton label="Mover vista" shortcut="H" active={tool === 'pan'} onClick={() => onToolChange('pan')} className="max-sm:hidden"><Hand /></ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-6 sm:mx-1" />
      <ShapePicker tool={tool} onToolChange={onToolChange} />
      <ToolButton label="Texto" shortcut="T" active={tool === 'text'} onClick={() => onToolChange('text')}><Type /></ToolButton>
      <ToolButton label="Hotspot" shortcut="P" active={tool === 'hotspot'} onClick={() => onToolChange('hotspot')}><MapPin /></ToolButton>
      <ToolButton label="Insertar imagen o PDF" shortcut="I" onClick={onInsertMedia} disabled={inserting}>
        {inserting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ImagePlus />}
      </ToolButton>
      <ToolButton label="Insertar datos" onClick={onInsertData} disabled={inserting}><Database /></ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-6 sm:mx-1" />
      <ToolButton label="Eliminar selección" shortcut="Supr" disabled={!canDelete} onClick={onDelete} className="hover:bg-destructive/10 hover:text-destructive">
        <Trash2 />
      </ToolButton>
    </div>
  )
}
