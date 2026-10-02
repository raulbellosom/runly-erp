import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
  Tooltip, TooltipContent, TooltipTrigger, cn,
} from '@runly/ui'
import { Ruler } from 'lucide-react'
import { formatLength } from '../lib/measure.js'

// Scale label: "1 m = 42 px" when a meter maps to at least 1 px, otherwise
// the inverse ("1 px = 2 cm") so the number shown is never below 1. Exported
// so the PDF export (lib/exportPage.js via hooks/useExportPage.js) can show
// the same text in its header.
export function scaleLabel(scale) {
  const perPixel = 1 / scale.scale
  if (perPixel >= 1) return `1 ${scale.unit} = ${Math.round(perPixel)} px`
  return `1 px = ${formatLength(1, scale)}`
}

// Icon-only button inside the zoom stack: the current scale is its tooltip
// and the menu header; a dot marks a page that has a scale (or a map).
export function ScaleControl({ scale, canEdit, onCalibrate, onClear, hasMap = false, onMap, side = 'left' }) {
  const label = hasMap ? 'Mapa · metros' : scale ? scaleLabel(scale) : 'Sin escala'
  const calibrated = hasMap || Boolean(scale)
  const icon = (
    <span className="relative">
      <Ruler className="h-4 w-4" />
      {calibrated ? <span aria-hidden className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-primary" /> : null}
    </span>
  )
  const buttonClass = cn('h-9 w-11 rounded-lg px-0', calibrated ? 'text-[hsl(var(--foreground))]' : 'text-[hsl(var(--muted-foreground))]')

  if (!canEdit) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span role="status" aria-label={`Escala: ${label}`} className={cn('inline-flex items-center justify-center', buttonClass)}>{icon}</span>
        </TooltipTrigger>
        <TooltipContent side={side}>Escala: {label}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" aria-label={`Escala: ${label}`} className={buttonClass}>{icon}</Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>Escala: {label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side={side} align="start">
        <DropdownMenuLabel className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Escala: {label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!hasMap ? <DropdownMenuItem onSelect={onCalibrate}>Calibrar escala</DropdownMenuItem> : null}
        {!hasMap && scale ? <DropdownMenuItem onSelect={onClear}>Quitar escala</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={onMap}>Fondo de mapa…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
