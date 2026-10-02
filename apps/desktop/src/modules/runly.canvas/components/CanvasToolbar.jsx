import { useState } from 'react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Separator,
  Tooltip, TooltipContent, TooltipTrigger, cn,
} from '@runly/ui'
import {
  ArrowUpRight, ChevronUp, Circle, Database, Diamond, Hand, ImagePlus, Library, Loader2, MapPin, Minus, MousePointer2,
  Plus, RulerDimensionLine, Square, Trash2, Triangle, Type,
} from 'lucide-react'
import { SHAPE_TOOLS } from '../lib/objectFactory.js'

export const SHAPES = {
  rectangle: { label: 'Rectángulo', shortcut: 'R', icon: Square },
  ellipse: { label: 'Elipse', shortcut: 'O', icon: Circle },
  triangle: { label: 'Triángulo', icon: Triangle },
  diamond: { label: 'Rombo', icon: Diamond },
  line: { label: 'Línea', shortcut: 'L', icon: Minus },
  arrow: { label: 'Flecha', shortcut: 'A', icon: ArrowUpRight },
}
// Compact (phone) "Formas" picker also offers Texto, so a single button
// covers every drawing tool that used to sit next to it in the full bar.
const SHAPES_WITH_TEXT = { ...SHAPES, text: { label: 'Texto', shortcut: 'T', icon: Type } }
const SHAPE_AND_TEXT_TOOLS = [...SHAPE_TOOLS, 'text']

// Buttons on the phone bottom bar are 40px (vs the icon size default, which
// shrinks to 36px at sm). Kept as a class string so every compact control
// stays the same size across the whole <768px range.
const COMPACT_SIZE = 'h-10 w-10 sm:h-10 sm:w-10'

export function ToolButton({ label, shortcut, active, className, side = 'top', children, ...props }) {
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
      <TooltipContent side={side} className="flex items-center gap-2">
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

// Phone variant of ShapePicker: a single 40px button (no split chevron)
// whose face shows the last shape or text tool chosen; tapping it always
// opens the grid instead of re-applying that tool, since screen space is
// too tight for a second hit target.
function CompactShapePicker({ tool, onToolChange }) {
  const [lastShape, setLastShape] = useState('rectangle')
  const current = SHAPE_AND_TEXT_TOOLS.includes(tool) ? tool : lastShape
  const meta = SHAPES_WITH_TEXT[current], Icon = meta.icon
  const choose = (value) => { setLastShape(value); onToolChange(value) }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button" size="icon" variant="ghost" aria-label="Formas"
              aria-pressed={SHAPE_AND_TEXT_TOOLS.includes(tool)}
              className={cn('rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]', COMPACT_SIZE,
                SHAPE_AND_TEXT_TOOLS.includes(tool) && 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground')}
            >
              <Icon />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Formas</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" className="min-w-44">
        {SHAPE_AND_TEXT_TOOLS.map((value) => {
          const { label, shortcut, icon: ItemIcon } = SHAPES_WITH_TEXT[value]
          return (
            <DropdownMenuItem key={value} onSelect={() => choose(value)} className={cn('gap-2.5', tool === value && 'font-semibold')}>
              <ItemIcon className="h-4 w-4" />{label}
              {shortcut ? <span className="ml-auto font-mono text-[10px] text-[hsl(var(--muted-foreground))]">{shortcut}</span> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Phone variant that tucks the rarer actions (media/data/library insert and
// measure) behind one "Insertar" button, so the bar never needs more than
// five 40px targets to fit inside a 360px-wide screen.
function CompactInsertMenu({ onInsertMedia, onInsertData, onToggleLibrary, onMeasure, inserting }) {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" aria-label="Insertar" disabled={inserting} className={cn('rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]', COMPACT_SIZE)}>
              {inserting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Plus />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Insertar</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="center" className="min-w-48">
        <DropdownMenuItem onSelect={onInsertMedia} disabled={inserting} className="gap-2.5"><ImagePlus className="h-4 w-4" />Imagen o PDF</DropdownMenuItem>
        <DropdownMenuItem onSelect={onInsertData} disabled={inserting} className="gap-2.5"><Database className="h-4 w-4" />Datos de Runly</DropdownMenuItem>
        <DropdownMenuItem onSelect={onToggleLibrary} className="gap-2.5"><Library className="h-4 w-4" />Biblioteca</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onMeasure} className="gap-2.5"><RulerDimensionLine className="h-4 w-4" />Medir</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function CanvasToolbar({ tool, onToolChange, canDelete, onDelete, onInsertMedia, onInsertData, onToggleLibrary, libraryOpen, inserting, readOnly = false, compact = false }) {
  if (readOnly) {
    return (
      <div role="toolbar" aria-label="Herramientas del lienzo" className="glass pointer-events-auto flex items-center gap-1 rounded-2xl p-1.5 shadow-lg">
        <ToolButton label="Seleccionar" shortcut="V" active={tool === 'select'} onClick={() => onToolChange('select')} className={compact ? COMPACT_SIZE : undefined}><MousePointer2 /></ToolButton>
        <ToolButton label="Mover vista" shortcut="H" active={tool === 'pan'} onClick={() => onToolChange('pan')} className={compact ? COMPACT_SIZE : 'max-sm:hidden'}><Hand /></ToolButton>
        <ToolButton label="Medir" shortcut="M" active={tool === 'measure'} onClick={() => onToolChange('measure')} className={compact ? COMPACT_SIZE : undefined}><RulerDimensionLine /></ToolButton>
        <span className="px-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">
          {compact ? 'Solo lectura' : 'Solo lectura · toca un hotspot para verlo'}
        </span>
      </div>
    )
  }
  if (compact) {
    return (
      <div role="toolbar" aria-label="Herramientas del lienzo" className="glass pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1.5 shadow-lg">
        <ToolButton label="Seleccionar" shortcut="V" active={tool === 'select'} onClick={() => onToolChange('select')} className={COMPACT_SIZE}><MousePointer2 /></ToolButton>
        {/* Pan with one finger without risking moving elements. */}
        <ToolButton label="Mover vista" shortcut="H" active={tool === 'pan'} onClick={() => onToolChange('pan')} className={COMPACT_SIZE}><Hand /></ToolButton>
        <CompactShapePicker tool={tool} onToolChange={onToolChange} />
        <ToolButton label="Hotspot" shortcut="P" active={tool === 'hotspot'} onClick={() => onToolChange('hotspot')} className={COMPACT_SIZE}><MapPin /></ToolButton>
        <CompactInsertMenu
          onInsertMedia={onInsertMedia} onInsertData={onInsertData} onToggleLibrary={onToggleLibrary}
          onMeasure={() => onToolChange('measure')} inserting={inserting}
        />
        {canDelete ? (
          <ToolButton label="Eliminar selección" shortcut="Supr" onClick={onDelete} className={cn(COMPACT_SIZE, 'hover:bg-destructive/10 hover:text-destructive')}>
            <Trash2 />
          </ToolButton>
        ) : null}
      </div>
    )
  }
  return (
    <div role="toolbar" aria-label="Herramientas del lienzo" className="glass pointer-events-auto flex items-center gap-0.5 rounded-2xl p-1.5 shadow-lg sm:gap-1">
      <ToolButton label="Seleccionar" shortcut="V" active={tool === 'select'} onClick={() => onToolChange('select')}><MousePointer2 /></ToolButton>
      <ToolButton label="Mover vista" shortcut="H" active={tool === 'pan'} onClick={() => onToolChange('pan')} className="max-sm:hidden"><Hand /></ToolButton>
      <ToolButton label="Medir" shortcut="M" active={tool === 'measure'} onClick={() => onToolChange('measure')}><RulerDimensionLine /></ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-6 sm:mx-1" />
      <ShapePicker tool={tool} onToolChange={onToolChange} />
      <ToolButton label="Texto" shortcut="T" active={tool === 'text'} onClick={() => onToolChange('text')}><Type /></ToolButton>
      <ToolButton label="Hotspot" shortcut="P" active={tool === 'hotspot'} onClick={() => onToolChange('hotspot')}><MapPin /></ToolButton>
      <ToolButton label="Insertar imagen o PDF" shortcut="I" onClick={onInsertMedia} disabled={inserting}>
        {inserting ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <ImagePlus />}
      </ToolButton>
      <ToolButton label="Insertar datos" onClick={onInsertData} disabled={inserting}><Database /></ToolButton>
      <ToolButton label="Biblioteca" active={libraryOpen} onClick={onToggleLibrary}><Library /></ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-6 sm:mx-1" />
      <ToolButton label="Eliminar selección" shortcut="Supr" disabled={!canDelete} onClick={onDelete} className="hover:bg-destructive/10 hover:text-destructive">
        <Trash2 />
      </ToolButton>
    </div>
  )
}
