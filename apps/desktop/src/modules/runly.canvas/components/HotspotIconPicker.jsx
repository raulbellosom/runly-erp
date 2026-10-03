import { useState } from 'react'
import {
  Button, Dialog, DialogContent, DialogHeader, DialogTitle, IconGlyph, IconLibraryPanel, Popover, PopoverContent, PopoverTrigger, cn, iconLabel, useIsMobile,
} from '@runly/ui'
import { ChevronDown, X } from 'lucide-react'

// Same look as @runly/ui text fields (FIELD_BASE + FIELD_NORMAL).
const FIELD = 'w-full rounded-lg border border-input bg-card px-3.5 text-foreground glass-subtle outline-none transition-all duration-150 hover:border-muted-foreground/50 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20'
const SEARCH_HINT = 'Buscar: extintor, camara, agua, wifi…'

// Combobox-style field: the trigger looks like a select (pin preview, icon
// name, chevron); the library opens in a popover on desktop and in a bottom
// sheet on phones, so the surrounding form never shifts.
export function HotspotIconPicker({ value, color = '#ef4444', onChange }) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const choose = (name) => { onChange(name); setOpen(false) }
  const label = value ? iconLabel(value) : 'Sin icono'

  const trigger = (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Icono del pin: ${label}. Cambiar`}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(FIELD, 'flex min-h-11 cursor-pointer items-center gap-2.5 pl-1.5 text-left sm:min-h-10')}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white shadow-sm" style={{ backgroundColor: color }} aria-hidden>
        {value ? <IconGlyph name={value} className="h-4 w-4" strokeWidth={2.25} /> : <span className="h-2.5 w-2.5 rounded-full bg-white" />}
      </span>
      <span className={cn('min-w-0 flex-1 truncate text-sm', !value && 'text-[hsl(var(--muted-foreground))]')}>{value ? label : 'Elegir icono…'}</span>
      <ChevronDown className={cn('h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform', open && 'rotate-180')} aria-hidden />
    </button>
  )

  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1">
        {isMobile ? (
          <>
            {trigger}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent className="gap-3 p-4">
                <DialogHeader><DialogTitle>Icono del pin</DialogTitle></DialogHeader>
                <IconLibraryPanel value={value} color={color} onChoose={choose} placeholder={SEARCH_HINT} gridClassName="max-h-[45dvh]" />
              </DialogContent>
            </Dialog>
          </>
        ) : (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="w-[min(24rem,calc(100vw-2rem))] border border-[hsl(var(--border))] p-3" style={{ background: 'hsl(var(--card))' }}>
              <IconLibraryPanel value={value} color={color} onChoose={choose} placeholder={SEARCH_HINT} gridClassName="max-h-72" />
            </PopoverContent>
          </Popover>
        )}
      </div>
      {value ? (
        <Button type="button" size="icon" variant="ghost" aria-label="Quitar icono" title="Quitar icono" onClick={() => onChange(null)} className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"><X /></Button>
      ) : null}
    </div>
  )
}
