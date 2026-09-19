import { Minus, Plus, Scan } from 'lucide-react'
import { Button } from '@runly/ui'
import { NOTE_ZOOM_MIN, NOTE_ZOOM_MAX, NOTE_ZOOM_STEP } from '../hooks/useNoteZoom.js'

export function ZoomControl({ zoom, onZoomChange, onFit }) {
  return (
    <div className="absolute bottom-4 right-4 z-30 flex items-center gap-1 rounded-full border border-border bg-card/95 backdrop-blur-sm shadow-sm px-1.5 py-1">
      {onFit && (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={onFit} title="Ajustar hoja al ancho" aria-label="Ajustar hoja al ancho">
          <Scan size={14} />
        </Button>
      )}
      <button
        type="button"
        onClick={() => onZoomChange(zoom - NOTE_ZOOM_STEP)}
        disabled={zoom <= NOTE_ZOOM_MIN}
        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Alejar"
      >
        <Minus size={14} />
      </button>
      <span className="text-xs font-medium text-muted-foreground w-10 text-center tabular-nums select-none">
        {zoom}%
      </span>
      <button
        type="button"
        onClick={() => onZoomChange(zoom + NOTE_ZOOM_STEP)}
        disabled={zoom >= NOTE_ZOOM_MAX}
        className="p-1.5 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
        title="Acercar"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
