import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Skeleton, cn } from '@runly/ui'
import { Check, Loader2 } from 'lucide-react'
import { renderPdfThumbnail } from '../lib/media.js'

function PageThumb({ doc, number, selected, onToggle }) {
  const [src, setSrc] = useState(null)
  useEffect(() => {
    let cancelled = false
    renderPdfThumbnail(doc, number).then((url) => { if (!cancelled) setSrc(url) }).catch(() => {})
    return () => { cancelled = true }
  }, [doc, number])
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`Página ${number}`}
      onClick={onToggle}
      className={cn(
        'relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 p-2 transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
        selected ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-[hsl(var(--muted)/0.6)]',
      )}
    >
      <span className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md border border-[hsl(var(--border))] bg-white">
        {src ? <img src={src} alt="" className="max-h-full max-w-full object-contain" /> : <Skeleton className="h-full w-full" />}
      </span>
      <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">Página {number}</span>
      {selected ? <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="h-3 w-3" strokeWidth={3} /></span> : null}
    </button>
  )
}

// Lets the user pick which pages of a multi-page PDF go onto the board.
export function PdfPagesDialog({ pdf, onConfirm, onCancel, busy }) {
  const [selected, setSelected] = useState(() => new Set([1]))
  const total = pdf?.doc.numPages ?? 0
  const toggle = (number) => setSelected((current) => {
    const next = new Set(current)
    if (next.has(number)) next.delete(number); else next.add(number)
    return next
  })
  return (
    <Dialog open={Boolean(pdf)} onOpenChange={(open) => { if (!open && !busy) onCancel() }}>
      <DialogContent className="flex max-h-[min(92dvh,760px)] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4">
          <DialogTitle>Insertar PDF</DialogTitle>
          <DialogDescription>{pdf?.file.name} · {total} páginas. Elige cuáles colocar en el lienzo.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {pdf ? Array.from({ length: total }, (_, index) => index + 1).map((number) => (
              <PageThumb key={number} doc={pdf.doc} number={number} selected={selected.has(number)} onToggle={() => toggle(number)} />
            )) : null}
          </div>
        </div>
        <DialogFooter className="mt-0 shrink-0 items-center border-t border-[hsl(var(--border))] px-5 py-4 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(selected.size === total ? new Set() : new Set(Array.from({ length: total }, (_, i) => i + 1)))}>
            {selected.size === total ? 'Quitar selección' : 'Seleccionar todas'}
          </Button>
          <div className="flex w-full flex-row gap-2 sm:w-auto">
            <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="flex-1 sm:flex-none">Cancelar</Button>
            <Button type="button" disabled={!selected.size || busy} onClick={() => onConfirm([...selected].sort((a, b) => a - b))} className="flex-1 sm:flex-none">
              {busy ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : null}
              Insertar {selected.size} {selected.size === 1 ? 'página' : 'páginas'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
