import { useRef, useState } from 'react'
import {
  Crop as CropIcon, Check, PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Popover, PopoverTrigger, PopoverContent,
} from '@runly/ui'
import { cropToViewBox } from '../lib/imageCrop.js'
import { useImageAnnotationDrawing } from '../hooks/useImageAnnotationDrawing.jsx'
import { ImageCropModal } from './ImageCropModal.jsx'

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#1a1a1a', '#ffffff']
const TOOLS = [
  { id: 'pen', label: 'Lapiz', icon: PenLine },
  { id: 'arrow', label: 'Flecha', icon: ArrowUpRight },
  { id: 'rect', label: 'Recuadro', icon: Square },
  { id: 'text', label: 'Texto', icon: Type },
]

// Full-size annotation editor for images that don't have room for the
// inline overlay's controls — currently, any image inside a table cell.
// Hosts the exact same tool/color/crop/annotation capabilities as
// ImageAnnotationOverlay's inline edit mode, via the shared
// useImageAnnotationDrawing hook, just laid out with room to breathe
// instead of squeezed into a table cell's width. See
// docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md.
export function ImageEditModal({ open, onOpenChange, src, alt, annotations, crop, rotation, updateAttributes }) {
  const svgRef = useRef(null)
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#ef4444')
  const [lineWidth, setLineWidth] = useState(3)
  const [cropOpen, setCropOpen] = useState(false)

  const {
    draft, textInput, onDrawPointerDown, onDrawPointerMove, onDrawPointerUp,
    commitTextInput, cancelTextInput, removeAnnotation, renderAnnotation, renderDraft,
  } = useImageAnnotationDrawing({
    svgRef, crop, annotations, tool, color, lineWidth, isEditing: true, updateAttributes,
  })

  const ActiveToolIcon = TOOLS.find((t) => t.id === tool)?.icon ?? PenLine
  const viewBox = cropToViewBox(crop)
  const [, , vbWidth, vbHeight] = viewBox.split(' ')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Editar imagen</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
                <ActiveToolIcon className="w-3.5 h-3.5" /> Herramienta
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-1 w-36" side="bottom" align="start">
              {TOOLS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTool(t.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-medium ${
                    tool === t.id
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))]'
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" /> {t.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
                <span
                  className="w-4 h-4 rounded-full border-2 border-[hsl(var(--border))]"
                  style={{ backgroundColor: color === '#ffffff' ? '#f3f4f6' : color }}
                />
                Color
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-2 w-auto" side="bottom" align="start">
              <div className="grid grid-cols-4 gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-amber-500 scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: c === '#ffffff' ? '#f3f4f6' : c }}
                  />
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Select value={String(lineWidth)} onValueChange={(v) => setLineWidth(Number(v))}>
            <SelectTrigger className="h-9 w-auto min-w-20 px-3 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 6, 8].map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w}px
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <button
            onClick={() => setCropOpen(true)}
            className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]"
          >
            <CropIcon className="w-3.5 h-3.5" /> Recortar
          </button>

          {annotations.length > 0 && (
            <button
              onClick={() => updateAttributes({ annotations: '[]' })}
              className="flex items-center gap-1.5 px-3 h-9 rounded-lg text-xs font-medium border border-[hsl(var(--border))] text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <MoreHorizontal className="w-3.5 h-3.5" /> Limpiar
            </button>
          )}
        </div>

        <div
          className="relative w-full max-h-[60dvh] rounded-lg overflow-hidden bg-[hsl(var(--muted))]"
          style={{ aspectRatio: `${vbWidth}/${vbHeight}` }}
        >
          <img src={src} alt={alt ?? ''} draggable={false} className="absolute inset-0 w-full h-full object-contain" />
          <svg
            ref={svgRef}
            viewBox={viewBox}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{
              touchAction: 'none',
              cursor: tool === 'text' ? 'text' : 'crosshair',
            }}
            onPointerDown={onDrawPointerDown}
            onPointerMove={onDrawPointerMove}
            onPointerUp={onDrawPointerUp}
            onPointerCancel={onDrawPointerUp}
          >
            {annotations.map(renderAnnotation)}
            {renderDraft()}
          </svg>

          {textInput && (
            <input
              autoFocus
              type="text"
              placeholder="Escribe una anotacion..."
              className="absolute bg-[hsl(var(--background))] text-[hsl(var(--foreground))] border border-amber-400 dark:border-amber-600 rounded px-2 py-1 text-sm shadow-lg outline-none z-10"
              style={{ left: textInput.screenX, top: textInput.screenY, minWidth: 180 }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTextInput(e.target.value)
                if (e.key === 'Escape') cancelTextInput()
              }}
              onBlur={(e) => commitTextInput(e.target.value)}
            />
          )}
        </div>

        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            className="flex items-center gap-1.5 px-4 h-10 rounded-lg font-semibold bg-amber-500 hover:bg-amber-600 text-white"
          >
            <Check className="w-4 h-4" /> Listo
          </button>
        </DialogFooter>

        {cropOpen && (
          <ImageCropModal
            open={cropOpen}
            onOpenChange={setCropOpen}
            src={src}
            crop={crop}
            rotation={rotation}
            onApply={({ crop: nextCrop, rotation: nextRotation }) => {
              updateAttributes({ crop: nextCrop, rotation: nextRotation })
              setCropOpen(false)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
