import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@runly/ui'
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

export function ScaleControl({ scale, canEdit, onCalibrate, onClear }) {
  const label = scale ? scaleLabel(scale) : 'Sin escala'
  if (!canEdit) {
    return (
      <div role="status" className="glass pointer-events-auto flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-medium shadow-lg">
        <Ruler className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))]" />{label}
      </div>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" className="glass pointer-events-auto h-9 gap-1.5 rounded-2xl px-3 text-xs font-medium shadow-lg">
          <Ruler className="h-3.5 w-3.5" />{label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onCalibrate}>Calibrar escala</DropdownMenuItem>
        {scale ? <DropdownMenuItem onSelect={onClear}>Quitar escala</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
