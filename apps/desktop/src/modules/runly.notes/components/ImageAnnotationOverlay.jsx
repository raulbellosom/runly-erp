import { NodeViewWrapper } from '@tiptap/react'
import { useContext, useEffect, useRef, useState } from 'react'
import {
  Pencil, Trash2, Crop as CropIcon, Check,
  PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Popover, PopoverTrigger, PopoverContent, ConfirmDialog } from '@runly/ui'
import { withImageVariant } from '../../../lib/imageVariants.js'
import { useBlockDragReorder } from '../hooks/useBlockDragReorder.js'
import { useImageAnnotationDrawing } from '../hooks/useImageAnnotationDrawing.jsx'
import { isInsideTableCell } from '../lib/tableContext.js'
import {
  cropToViewBox, effectiveNaturalSize,
  normalizeRotation, rotateAnnotations,
} from '../lib/imageCrop.js'
import { clampImageWidthPct, computeCornerResize } from '../lib/imageSize.js'
import { useRotatedFillSize } from '../hooks/useRotatedFillSize.js'
import { ImageCropModal } from './ImageCropModal.jsx'
import { ImageEditModal } from './ImageEditModal.jsx'
import { NoteImagePreviewButton } from './NoteImagePreviewButton.jsx'
import { NoteInteractionContext } from './NoteInteractionContext.js'
import { NoteBlockDragHandle } from './NoteBlockDragHandle.jsx'

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#1a1a1a', '#ffffff']
const TOOLS = [
  { id: 'pen', label: 'Lapiz', icon: PenLine },
  { id: 'arrow', label: 'Flecha', icon: ArrowUpRight },
  { id: 'rect', label: 'Recuadro', icon: Square },
  { id: 'text', label: 'Texto', icon: Type },
]

function parseCrop(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function ImageAnnotationOverlay({ node, updateAttributes, editor, getPos, deleteNode }) {
  const { viewing } = useContext(NoteInteractionContext)
  const svgRef = useRef(null)
  const boxRef = useRef(null) // the sized img+svg container — resize math + click-outside
  const frameRef = useRef(null) // the image frame only (no control chrome) — measured/cloned for drag reorder
  const rotWrapRef = useRef(null) // sized/positioned per crop; useRotatedFillSize measures this
  const resizeRef = useRef(null) // { pointerId, startX, startY, startWidthPx, startHeightPx, containerWidthPx }

  const [mode, setMode] = useState('view') // 'view' | 'edit'
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#ef4444')
  const [lineWidth, setLineWidth] = useState(3)
  const [cropOpen, setCropOpen] = useState(false)
  const [natural, setNatural] = useState(null) // { w, h }
  const [selected, setSelected] = useState(false) // click-to-select for resize (Word/PPT style)
  const [liveWidthPct, setLiveWidthPct] = useState(null) // resize drag preview
  const [liveAspectRatio, setLiveAspectRatio] = useState(null) // resize drag preview
  const [fullLoaded, setFullLoaded] = useState(false) // full-resolution <img> onLoad fired
  const [editModalOpen, setEditModalOpen] = useState(false) // table-cell images edit via modal instead of inline mode
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const annotations = JSON.parse(node.attrs.annotations || '[]')
  const crop = parseCrop(node.attrs.crop)
  const rotation = normalizeRotation(node.attrs.rotation)
  // Context already combines permission and view mode. editor.isEditable
  // updates in an effect and can still hold the previous mode during render.
  const editable = !viewing
  const isEditing = editable && mode === 'edit'
  const inTableCell = typeof getPos === 'function' && isInsideTableCell(editor.state, getPos())
  // null = full width, for images inserted before this attribute existed.
  const widthPct = node.attrs.width == null ? 100 : clampImageWidthPct(node.attrs.width)
  // Identity crop when unset — cropToViewBox/elementFracToImageSpace treat
  // {0,0,1,1} exactly like null, so every downstream calculation (drawing,
  // rendering) can use one shape unconditionally.
  const effectiveCrop = crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const effNat = effectiveNaturalSize(natural, rotation)
  const fillSize = useRotatedFillSize(rotWrapRef, rotation, effNat?.w, effNat?.h)
  const drag = useBlockDragReorder({
    editor, getPos, editable: editable && !inTableCell, isEditing,
    getBoxEl: () => boxRef.current,
    getFrameEl: () => frameRef.current,
  })
  const {
    onPointerDown: onDragPointerDown,
    onPointerMove: onDragPointerMove,
    onPointerUp: onDragPointerUp,
    onPointerCancel: onDragPointerCancel,
    wasDragRef,
  } = drag

  const {
    draft, textInput, onDrawPointerDown, onDrawPointerMove, onDrawPointerUp,
    commitTextInput, cancelTextInput, cancelDraft, removeAnnotation, renderAnnotation, renderDraft,
  } = useImageAnnotationDrawing({ svgRef, crop, annotations, tool, color, lineWidth, isEditing, updateAttributes })

  // Toggling the whole note from edit to view mode (the note-level Ver/Editar
  // button, not this image's own mode) never runs exitEditMode — the note can
  // switch to view-only while an image is mid-annotation. Without this,
  // `mode` stays stuck at 'edit' and switching the note back to edit mode
  // immediately re-enters the annotation toolbar instead of showing the
  // normal Editar/Eliminar controls.
  useEffect(() => {
    if (editable) return
    cancelDraft()
    cancelTextInput()
    setMode('view')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable])

  // Deselect when clicking outside the image (Word/PPT-style click-away).
  useEffect(() => {
    if (!selected) return
    function onDocPointerDown(e) {
      if (!boxRef.current?.contains(e.target)) setSelected(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [selected])

  // A tap/click anywhere in this node view's own DOM (the image itself, its
  // pill/handle controls) must never let ProseMirror run its default
  // mousedown handling — that's what creates a NodeSelection AND focuses the
  // surrounding contentEditable, which mobile browsers always answer by
  // opening the on-screen keyboard even though nothing here is meant to be
  // typed into (and once open, dismissing it leaves the image "selected"
  // with no clean way back — the reported loop). ProseMirror's own view.dom
  // mousedown listener bails out whenever event.defaultPrevented is already
  // true (prosemirror-view's eventBelongsToView checks this before its own
  // handlers run), so preventing default here — a descendant, which fires
  // first during the bubble phase — is enough. Real form controls (buttons,
  // the Texto annotation's <input>) are left alone so their native
  // focus/caret behavior keeps working; `click` still fires normally either
  // way since only `mousedown`'s default is touched, not `pointerdown`.
  function onBoxMouseDown(e) {
    const target = e.target
    const isFormControl =
      target instanceof HTMLElement &&
      (['INPUT', 'BUTTON', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)
    if (!isFormControl) e.preventDefault()
  }

  // ── click-to-resize (Word/PowerPoint-style corner handle) ────────────────
  function onImageClick() {
    if (wasDragRef.current) {
      wasDragRef.current = false
      return
    }
    if (!editable || mode !== 'view') return
    setSelected(true)
  }

  function onResizePointerDown(e) {
    if (!editable) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const rect = boxRef.current.getBoundingClientRect()
    const containerWidthPx = rect.width / (widthPct / 100)
    resizeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startWidthPx: rect.width,
      startHeightPx: rect.height,
      containerWidthPx,
    }
    setLiveWidthPct(widthPct)
    setLiveAspectRatio(node.attrs.aspectRatio ?? (effNat ? effNat.w / effNat.h : rect.width / rect.height))
  }

  function onResizePointerMove(e) {
    const r = resizeRef.current
    if (!r || r.pointerId !== e.pointerId) return
    const { widthPct: newWidthPct, aspectRatio } = computeCornerResize({
      startWidthPx: r.startWidthPx,
      startHeightPx: r.startHeightPx,
      containerWidthPx: r.containerWidthPx,
      deltaX: e.clientX - r.startX,
      deltaY: e.clientY - r.startY,
    })
    setLiveWidthPct(newWidthPct)
    setLiveAspectRatio(aspectRatio)
  }

  function onResizePointerUp(e) {
    const r = resizeRef.current
    if (!r || r.pointerId !== e.pointerId) return
    resizeRef.current = null
    const finalWidthPct = liveWidthPct
    const finalAspectRatio = liveAspectRatio
    setLiveWidthPct(null)
    setLiveAspectRatio(null)
    if (finalWidthPct != null) {
      updateAttributes({ width: finalWidthPct, aspectRatio: finalAspectRatio })
    }
  }

  function exitEditMode() {
    cancelDraft()
    cancelTextInput()
    setMode('view')
  }

  const src = withImageVariant(node.attrs.src, 'content')
  const lqipSrc = withImageVariant(node.attrs.src, 'lqip')
  const ActiveToolIcon = TOOLS.find((t) => t.id === tool)?.icon ?? PenLine
  const displayWidthPct = liveWidthPct ?? widthPct
  // Outer box: controls the resizable width, carries the selection ring and
  // the pill/handle controls — never clipped, so they're never cut off.
  // WebkitTouchCallout suppresses iOS Safari's own native long-press menu
  // on the <img> ("Save Image"/"Copy"/etc, inherited by descendants) while
  // editable — without it, that native menu races the press-and-hold drag
  // timer below (useBlockDragReorder, LONG_PRESS_MS) and usually wins,
  // which is what made long-press-to-reorder feel like it "let go" instead
  // of arming a drag. Read-only/public views keep the native menu (a
  // reasonable way to save a shared image), since nothing there needs the
  // press-and-hold gesture.
  const wrapperStyle = {
    userSelect: 'none',
    width: `${displayWidthPct}%`,
    ...(editable ? { WebkitTouchCallout: 'none' } : null),
  }
  // Frame: clips to the crop window (overflow-hidden always — harmless when
  // effectiveCrop is the identity {0,0,1,1}, no crop set), so a cropped
  // image can't hide controls that sit just outside its edges. Sized via
  // the ROTATED effective natural aspect; falls back to the crop rect's own
  // aspect before the image has loaded (self-corrects once it has).
  const displayAspectRatio = liveAspectRatio ?? node.attrs.aspectRatio ?? null
  const frameStyle = {
    aspectRatio: displayAspectRatio
      ? String(displayAspectRatio)
      : effNat
      ? String((effectiveCrop.w * effNat.w) / (effectiveCrop.h * effNat.h))
      : String(effectiveCrop.w / effectiveCrop.h),
  }
  // Rotation wrapper: positioned/sized per the crop window exactly like the
  // old crop-only <img> was, but now holding a raw, unrotated <img> that
  // useRotatedFillSize sizes (in px, measured) to exactly fill this wrapper
  // once rotated — CSS percentages alone can't express "width = my parent's
  // height", which a 90/270 rotation needs.
  const rotWrapStyle = {
    position: 'absolute',
    width: `${100 / effectiveCrop.w}%`,
    left: `${(-effectiveCrop.x / effectiveCrop.w) * 100}%`,
    top: `${(-effectiveCrop.y / effectiveCrop.h) * 100}%`,
    aspectRatio: effNat ? String(effNat.w / effNat.h) : undefined,
  }
  const imgStyle = fillSize
    ? {
        position: 'absolute',
        top: '50%',
        left: '50%',
        width: `${fillSize.width}px`,
        height: `${fillSize.height}px`,
        maxWidth: 'none',
        transform: rotation ? `translate(-50%, -50%) rotate(${rotation}deg)` : 'translate(-50%, -50%)',
      }
    : { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0 }

  return (
    <NodeViewWrapper className="group/img relative my-2 block w-full">
      {editable && !inTableCell && !isEditing && (
        <div contentEditable={false} className="mb-1 flex" data-html2canvas-ignore>
          <NoteBlockDragHandle label="Mover imagen" drag={drag} />
        </div>
      )}
      <div
        ref={boxRef}
        onClick={onImageClick}
        onMouseDown={onBoxMouseDown}
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onPointerCancel={onDragPointerCancel}
        // Android/Chrome's long-press-on-image context menu ("Download
        // image", "Open image in new tab"...) is a real, preventable
        // contextmenu event — the WebkitTouchCallout style above only
        // covers iOS Safari's equivalent. Both compete with and otherwise
        // usually win over the press-and-hold reorder gesture below.
        onContextMenu={editable ? (e) => e.preventDefault() : undefined}
        className={[
          'relative',
          selected && mode === 'view' ? 'ring-2 ring-amber-500 ring-offset-1 rounded-b' : '',
        ].join(' ')}
        style={wrapperStyle}
      >
        {isEditing && (
          // Single row that never wraps — a wrapping multi-row toolbar used
          // to push the image itself down on narrow screens. Every button
          // also preventDefaults its pointerdown so tapping it can't shift
          // ProseMirror's selection into the document and pop the mobile
          // keyboard (see docs/superpowers/specs/2026-09-16-notes-mobile-image-editing-fixes-design.md).
          <div className="flex items-center flex-nowrap gap-1 py-1.5 px-2 bg-[hsl(var(--muted))] border border-[hsl(var(--border))] rounded-t text-xs overflow-hidden">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  title="Herramienta"
                  onPointerDown={(e) => e.preventDefault()}
                  className="flex items-center justify-center w-9 h-9 rounded shrink-0 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)]"
                >
                  <ActiveToolIcon className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-1 w-36" side="bottom" align="start">
                {TOOLS.map((t) => (
                  <button
                    key={t.id}
                    onPointerDown={(e) => e.preventDefault()}
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
                <button
                  title="Color"
                  onPointerDown={(e) => e.preventDefault()}
                  className="flex items-center justify-center w-9 h-9 rounded shrink-0 hover:bg-[hsl(var(--muted-foreground)/0.1)]"
                >
                  <span
                    className="w-5 h-5 rounded-full border-2 border-[hsl(var(--border))]"
                    style={{ backgroundColor: color === '#ffffff' ? '#f3f4f6' : color }}
                  />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-2 w-auto" side="bottom" align="start">
                <div className="grid grid-cols-4 gap-1.5">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => setColor(c)}
                      className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-amber-500 scale-110' : 'border-transparent'}`}
                      style={{ backgroundColor: c === '#ffffff' ? '#f3f4f6' : c }}
                    />
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            <button
              title="Recortar"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setCropOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded shrink-0 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)]"
            >
              <CropIcon className="w-3.5 h-3.5" />
            </button>

            <Popover>
              <PopoverTrigger asChild>
                <button
                  title="Mas opciones"
                  onPointerDown={(e) => e.preventDefault()}
                  className="flex items-center justify-center w-9 h-9 rounded shrink-0 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)]"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-1 w-44" side="bottom" align="start">
                <div className="px-2 py-1.5 text-[11px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                  Grosor
                </div>
                <div className="px-2 pb-1.5">
                  <Select value={String(lineWidth)} onValueChange={(v) => setLineWidth(Number(v))}>
                    <SelectTrigger className="h-9 w-full px-2 py-0 text-xs">
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
                </div>
                {annotations.length > 0 && (
                  <>
                    <div className="my-1 border-t border-[hsl(var(--border))]" />
                    <button
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => updateAttributes({ annotations: '[]' })}
                      className="w-full text-left text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 px-2.5 py-1.5 rounded"
                    >
                      Limpiar
                    </button>
                  </>
                )}
              </PopoverContent>
            </Popover>

            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={exitEditMode}
              className="ml-auto flex items-center gap-1 px-3 h-9 rounded font-semibold bg-amber-500 hover:bg-amber-600 text-white shrink-0"
            >
              <Check className="w-3.5 h-3.5" /> Listo
            </button>
          </div>
        )}

        <div ref={frameRef} className="relative rounded-b overflow-hidden" style={frameStyle}>
          <div ref={rotWrapRef} style={rotWrapStyle}>
            {/* Tiny blurred placeholder — loads almost instantly (a few
                hundred bytes) and shares the full image's aspect ratio, so
                it corrects the frame size for legacy images that have no
                stored aspectRatio, well before the full image arrives. */}
            <img
              src={lqipSrc}
              alt=""
              aria-hidden="true"
              draggable={false}
              onLoad={(e) => setNatural((prev) => prev ?? { w: e.target.naturalWidth, h: e.target.naturalHeight })}
              style={{
                ...imgStyle,
                filter: 'blur(16px)',
                transform: imgStyle.transform ? `${imgStyle.transform} scale(1.15)` : undefined,
              }}
            />
            <img
              src={src}
              alt={node.attrs.alt ?? ''}
              draggable={false}
              onLoad={(e) => { setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight }); setFullLoaded(true) }}
              style={{
                ...imgStyle,
                opacity: fillSize && fullLoaded ? 1 : 0,
                transition: 'opacity 200ms ease',
              }}
            />
          </div>
          <svg
            ref={svgRef}
            viewBox={cropToViewBox(crop)}
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full"
            style={{
              touchAction: 'none',
              pointerEvents: isEditing ? 'auto' : 'none',
              cursor: isEditing ? (tool === 'text' ? 'text' : 'crosshair') : 'default',
            }}
            onPointerDown={isEditing ? onDrawPointerDown : undefined}
            onPointerMove={isEditing ? onDrawPointerMove : undefined}
            onPointerUp={isEditing ? onDrawPointerUp : undefined}
            onPointerCancel={isEditing ? onDrawPointerUp : undefined}
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

        {!isEditing && (
          <div
            // Top-right: keeps the primary "Editar imagen" affordance in view
            // above the fold on a tall image, clear of the corner resize
            // handles. The separate grip and press-and-hold on the image
            // both support reordering.
            className="absolute top-2 right-2 flex items-center gap-1.5"
          >
            <NoteImagePreviewButton src={node.attrs.src} alt={node.attrs.alt} />
            {editable && (inTableCell ? (
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={() => setEditModalOpen(true)}
                aria-label="Editar imagen"
                title="Editar imagen"
                className="flex items-center justify-center w-8 h-8 bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={() => setMode('edit')}
                aria-label="Editar imagen"
                title="Editar imagen"
                // Icon-only on narrow/touch screens — the text label only
                // widens the tap target without adding clarity there; the
                // pencil alone already matches every other icon-only control
                // in this toolbar (Recortar, Herramienta, Color...).
                className="flex items-center justify-center gap-1.5 text-xs font-medium bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg w-8 h-8 sm:w-auto sm:px-2.5 sm:py-1.5 shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Editar imagen</span>
              </button>
            ))}
            {editable && typeof deleteNode === 'function' && (
              <button
                onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                onClick={() => setConfirmDeleteOpen(true)}
                aria-label="Eliminar imagen"
                title="Eliminar imagen"
                className="flex items-center justify-center w-8 h-8 bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg shadow-sm hover:bg-red-50 dark:hover:bg-red-950/30 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {editable && mode === 'view' && selected && (
          // Free 4-corner resize — all 4 anchor at the fixed top-left corner
          // (the node lives in document flow, not a free canvas), so every
          // handle shares the same onResizePointer* math; the cursor style
          // is just a visual hint matching each corner's diagonal.
          <>
            {[
              { pos: 'top-left', posClass: 'left-0 top-0', cursor: 'cursor-nwse-resize' },
              { pos: 'top-right', posClass: 'right-0 top-0', cursor: 'cursor-nesw-resize' },
              { pos: 'bottom-left', posClass: 'left-0 bottom-0', cursor: 'cursor-nesw-resize' },
              { pos: 'bottom-right', posClass: 'right-0 bottom-0', cursor: 'cursor-nwse-resize' },
            ].map(({ pos, posClass, cursor }) => (
              <button
                key={pos}
                aria-label="Cambiar tamaño de la imagen"
                title="Arrastra para cambiar el tamaño"
                onPointerDown={onResizePointerDown}
                onPointerMove={onResizePointerMove}
                onPointerUp={onResizePointerUp}
                onPointerCancel={onResizePointerUp}
                // 44px hit area (Apple/Android minimum touch target), same
                // trick as ImageCropModal's corner handles — visually just
                // the dot.
                className={`absolute ${posClass} w-11 h-11 -m-5 flex items-center justify-center ${cursor}`}
                style={{ touchAction: 'none' }}
              >
                <span className="w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-white dark:border-[hsl(var(--background))] shadow" />
              </button>
            ))}
          </>
        )}
      </div>

      {cropOpen && (
        <ImageCropModal
          open={cropOpen}
          onOpenChange={setCropOpen}
          src={src}
          crop={crop}
          rotation={rotation}
          onApply={({ crop: nextCrop, rotation: nextRotation }) => {
            // Rotation is a NODE-level concept (affects the image everywhere
            // it renders, not just this modal session), so stored
            // annotations — defined in the image's own rotated fraction
            // space — must be re-expressed in the NEW rotation to stay
            // visually aligned with the image content.
            const delta = normalizeRotation(nextRotation - rotation)
            const rotatedAnnotations = delta === 0 ? annotations : rotateAnnotations(annotations, delta)
            updateAttributes({
              crop: nextCrop,
              rotation: nextRotation,
              annotations: JSON.stringify(rotatedAnnotations),
              // A prior manual corner-resize freezes the frame's aspect ratio
              // in this attribute, which otherwise keeps overriding the new
              // crop's own shape — the image would visibly not change size
              // after cropping (e.g. cropping to 1:1 while a wide aspectRatio
              // is still stored). The new crop defines the frame's shape now.
              aspectRatio: null,
            })
            setCropOpen(false)
          }}
        />
      )}

      {editModalOpen && (
        <ImageEditModal
          open={editModalOpen}
          onOpenChange={setEditModalOpen}
          src={src}
          alt={node.attrs.alt}
          annotations={annotations}
          crop={crop}
          rotation={rotation}
          updateAttributes={updateAttributes}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title="Eliminar imagen"
        description="Se eliminara esta imagen y sus anotaciones de la nota. Esta accion se puede deshacer con Ctrl+Z."
        confirmLabel="Eliminar"
        onConfirm={() => { setConfirmDeleteOpen(false); deleteNode?.() }}
      />
    </NodeViewWrapper>
  )
}
