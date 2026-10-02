import { useEffect, useState } from 'react'
import {
  Button, ConfirmDialog, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, EmptyState, Input, cn,
} from '@runly/ui'
import { Loader2, MapPin, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useGeocode } from '../hooks/useCanvasData.js'

// "Fondo de mapa": search an address/place (Nominatim, through the API
// proxy) and set it as the page's map background, or remove an existing one.
// `current` is the page's current background (only acted on when it is a
// map); `hasManualCalibration` warns that a prior manual scale will be
// replaced; `hasObjects` gates the removal confirmation.
export function MapLocationDialog({ open, onOpenChange, current, hasManualCalibration = false, hasObjects = false, onSave, onRemove, pending = false }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [pickedIndex, setPickedIndex] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const geocode = useGeocode()

  useEffect(() => {
    if (!open) return
    setQuery(''); setResults([]); setPickedIndex(null)
  }, [open])

  function search(event) {
    event.preventDefault()
    const q = query.trim()
    if (!q) return
    geocode.mutate(q, {
      onSuccess: (rows) => { setResults(rows); setPickedIndex(rows.length ? 0 : null) },
      onError: (error) => toast.error(error.message ?? 'No se pudo buscar la dirección.'),
    })
  }

  const picked = pickedIndex != null ? results[pickedIndex] : null
  const isMap = current?.type === 'map'

  function save() {
    if (!picked) return
    onSave({ type: 'map', origin: { lat: picked.lat, lng: picked.lng }, label: picked.label, bbox: picked.bbox ?? null })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent scrollable size="md" className="gap-0">
          <DialogHeader className="mb-0 border-b border-[hsl(var(--border))] pb-4">
            <DialogTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" />Fondo de mapa</DialogTitle>
            <DialogDescription>Busca una dirección o lugar; el mapa quedará como fondo de esta página con medidas en metros.</DialogDescription>
            {hasManualCalibration ? (
              <p className="text-xs text-[hsl(var(--muted-foreground))]">La escala manual de esta página se reemplazará por metros del mapa.</p>
            ) : null}
          </DialogHeader>
          <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-1 py-5">
            <form onSubmit={search} className="flex gap-2">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar dirección o lugar"
                autoFocus
              />
              <Button type="submit" variant="outline" disabled={geocode.isPending || !query.trim()}>
                {geocode.isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Search className="h-4 w-4" />}
                Buscar
              </Button>
            </form>
            {geocode.isError ? <p className="text-sm text-red-500">No se pudo buscar la dirección.</p> : null}
            {!geocode.isPending && geocode.isSuccess && !results.length ? <EmptyState title="Sin resultados" description="Intenta con otra dirección o un lugar más conocido cerca." /> : null}
            {results.length ? (
              <ul className="space-y-1">
                {results.map((result, index) => (
                  <li key={`${result.lat}-${result.lng}-${index}`}>
                    <button
                      type="button"
                      onClick={() => setPickedIndex(index)}
                      className={cn(
                        'w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                        index === pickedIndex
                          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.08)]'
                          : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--muted)/0.5)]',
                      )}
                    >
                      {result.label}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <DialogFooter className="mt-0 shrink-0 flex-row flex-wrap border-t border-[hsl(var(--border))] pt-4">
            {isMap ? (
              <Button
                type="button" variant="outline" className="flex-1 sm:flex-none" disabled={pending}
                onClick={() => (hasObjects ? setConfirmRemove(true) : onRemove())}
              >
                Quitar mapa
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="button" disabled={!picked || pending} className="flex-1 sm:flex-none" onClick={save}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}Usar este lugar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Quitar el mapa de esta página"
        description="Los elementos se quedan donde están, pero el mapa desaparece."
        confirmLabel="Quitar mapa"
        loading={pending}
        onConfirm={() => { setConfirmRemove(false); onRemove() }}
      />
    </>
  )
}
