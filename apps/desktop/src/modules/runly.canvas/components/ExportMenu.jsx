import { useState } from 'react'
import {
  Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger, cn,
} from '@runly/ui'
import { Download, Loader2 } from 'lucide-react'

const FORMATS = [
  { format: 'png', label: 'Imagen PNG' },
  { format: 'pdf', label: 'PDF' },
]

// Exports the current page to PNG or PDF. `onExport(format)` should return
// a promise; the trigger shows a spinner and both items stay disabled while
// it is pending so a second click cannot start a duplicate export.
export function ExportMenu({ disabled, onExport }) {
  const [busy, setBusy] = useState(false)
  const run = async (format) => {
    setBusy(true)
    try { await onExport(format) } finally { setBusy(false) }
  }
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Exportar"
              disabled={disabled || busy}
              className={cn('rounded-lg text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')}
            >
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Download />}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Exportar</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end">
        {FORMATS.map(({ format, label }) => (
          <DropdownMenuItem key={format} disabled={disabled || busy} onSelect={() => run(format)}>{label}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
