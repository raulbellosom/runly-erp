import { NodeViewWrapper } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import {
  GripVertical, Pencil, Crop as CropIcon, Check,
  PenLine, ArrowUpRight, Square, Type, MoreHorizontal,
} from 'lucide-react'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Popover, PopoverTrigger, PopoverContent } from '@runly/ui'
import { findDropPosition, moveNode } from '../lib/dragReorder.js'
import { withImageVariant } from '../../../lib/imageVariants.js'
import {
  cropToViewBox, elementFracToImageSpace, effectiveNaturalSize,
  normalizeRotation, rotateAnnotations,
} from '../lib/imageCrop.js'
import { clampImageWidthPct, computeCornerResize } from '../lib/imageSize.js'
import { useRotatedFillSize } from '../hooks/useRotatedFillSize.js'
import { ImageCropModal } from './ImageCropModal.jsx'

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#1a1a1a', '#ffffff']
const TOOLS = [
  { id: 'pen', label: 'Lapiz', icon: PenLine },
  { id: 'arrow', label: 'Flecha', icon: ArrowUpRight },
  { id: 'rect', label: 'Recuadro', icon: Square },
  { id: 'text', label: 'Texto', icon: Type },
]
const W = 1000
const H = 1000

function parseCrop(raw) {
  if (!raw) return null
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function ImageAnnotationOverlay({ node, updateAttributes, editor, getPos }) {
  const svgRef = useRef(null)
  const boxRef = useRef(null) // the sized img+svg container — resize math + click-outside
  const rotWrapRef = useRef(null) // sized/positioned per crop; useRotatedFillSize measures this
  const dragRef = useRef(null) // { pointerId, dropPos } — image reorder
  const drawRef = useRef(null) // { pointerId } — annotation drawing
  const resizeRef = useRef(null) // { pointerId, startX, startY, startWidthPx, startHeightPx, containerWidthPx }

  const [mode, setMode] = useState('view') // 'view' | 'edit'
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#ef4444')
  const [lineWidth, setLineWidth] = useState(3)
  const [draft, setDraft] = useState(null)
  const [textInput, setTextInput] = useState(null) // { screenX, screenY, svgX, svgY }
  const [dropIndicator, setDropIndicator] = useState(null) // { top, left, width }
  const [cropOpen, setCropOpen] = useState(false)
  const [natural, setNatural] = useState(null) // { w, h }
  const [selected, setSelected] = useState(false) // click-to-select for resize (Word/PPT style)
  const [liveWidthPct, setLiveWidthPct] = useState(null) // resize drag preview
  const [liveAspectRatio, setLiveAspectRatio] = useState(null) // resize drag preview

  const annotations = JSON.parse(node.attrs.annotations || '[]')
  const crop = parseCrop(node.attrs.crop)
  const rotation = normalizeRotation(node.attrs.rotation)
  const editable = editor?.isEditable !== false
  const isEditing = editable && mode === 'edit'
  // null = full width, for images inserted before this attribute existed.
  const widthPct = node.attrs.width == null ? 100 : clampImageWidthPct(node.attrs.width)
  // Identity crop when unset — cropToViewBox/elementFracToImageSpace treat
  // {0,0,1,1} exactly like null, so every downstream calculation (drawing,
  // rendering) can use one shape unconditionally.
  const effectiveCrop = crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const effNat = effectiveNaturalSize(natural, rotation)
  const fillSize = useRotatedFillSize(rotWrapRef, rotation)

  // Deselect when clicking outside the image (Word/PPT-style click-away).
  useEffect(() => {
    if (!selected) return
    function onDocPointerDown(e) {
      if (!boxRef.current?.contains(e.target)) setSelected(false)
    }
    document.addEventListener('pointerdown', onDocPointerDown, true)
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true)
  }, [selected])

  // ── image reorder drag handle (mouse + touch via Pointer Events) ─────────
  function getIndicatorRect(view, pos) {
    const { doc } = view.state
    const dom = pos < doc.content.size ? view.nodeDOM(pos) : null
    if (dom?.getBoundingClientRect) {
      const rect = dom.getBoundingClientRect()
      return { top: rect.top, left: rect.left, width: rect.width }
    }
    let lastDom = null
    doc.forEach((_n, offset) => {
      lastDom = view.nodeDOM(offset) ?? lastDom
    })
    if (lastDom?.getBoundingClientRect) {
      const rect = lastDom.getBoundingClientRect()
      return { top: rect.bottom, left: rect.left, width: rect.width }
    }
    const containerRect = view.dom.getBoundingClientRect()
    return { top: containerRect.top, left: containerRect.left, width: containerRect.width }
  }

  function onHandlePointerDown(e) {
    if (!editable || typeof getPos !== 'function') return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, dropPos: null }
  }
  function onHandlePointerMove(e) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    const view = editor.view
    const dropPos = findDropPosition(view, e.clientY)
    dragRef.current.dropPos = dropPos
    setDropIndicator(getIndicatorRect(view, dropPos))
  }
  function onHandlePointerUp(e) {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    const { dropPos } = dragRef.current
    dragRef.current = null
    setDropIndicator(null)
    if (dropPos !== null) moveNode(editor, getPos(), dropPos)
  }

  // ── click-to-resize (Word/PowerPoint-style corner handle) ────────────────
  function onImageClick() {
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

  // ── annotation drawing (Pointer Events) ─────────────────────────────────
  function getPoint(e) {
    const rect = svgRef.current.getBoundingClientRect()
    const frac = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    }
    return elementFracToImageSpace(frac, crop)
  }

  function onDrawPointerDown(e) {
    if (!isEditing || textInput) return
    e.preventDefault()
    const p = getPoint(e)
    if (tool === 'text') {
      const rect = svgRef.current.getBoundingClientRect()
      setTextInput({
        svgX: p.x,
        svgY: p.y,
        screenX: e.clientX - rect.left,
        screenY: e.clientY - rect.top,
      })
      return
    }
    svgRef.current.setPointerCapture(e.pointerId)
    drawRef.current = { pointerId: e.pointerId }
    if (tool === 'pen') setDraft({ type: 'path', color, lineWidth, points: [p] })
    else setDraft({ type: tool, color, lineWidth, start: p, end: p })
  }

  function onDrawPointerMove(e) {
    if (!drawRef.current || drawRef.current.pointerId !== e.pointerId) return
    const p = getPoint(e)
    setDraft((d) => {
      if (!d) return d
      if (d.type === 'path') {
        const last = d.points[d.points.length - 1]
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return d
        return { ...d, points: [...d.points, p] }
      }
      return { ...d, end: p }
    })
  }

  function onDrawPointerUp(e) {
    if (!drawRef.current || drawRef.current.pointerId !== e.pointerId) return
    drawRef.current = null
    const d = draft
    setDraft(null)
    if (!d) return
    if (d.type === 'path' && d.points.length < 2) return
    updateAttributes({
      annotations: JSON.stringify([...annotations, { ...d, id: Date.now() }]),
    })
  }

  function commitTextInput(text) {
    if (text?.trim()) {
      const ann = {
        type: 'text',
        id: Date.now(),
        color,
        lineWidth,
        text: text.trim(),
        svgX: textInput.svgX,
        svgY: textInput.svgY,
      }
      updateAttributes({ annotations: JSON.stringify([...annotations, ann]) })
    }
    setTextInput(null)
  }

  function removeAnnotation(id) {
    updateAttributes({
      annotations: JSON.stringify(annotations.filter((a) => a.id !== id)),
    })
  }

  function exitEditMode() {
    setDraft(null)
    setTextInput(null)
    setMode('view')
  }

  // ── rendering ──────────────────────────────────────────────────────────
  function renderAnnotation(ann) {
    const clickable = isEditing ? 'cursor-pointer' : ''
    if (ann.type === 'path') {
      const pts = (ann.points || []).map((p) => `${p.x * W},${p.y * H}`).join(' ')
      return (
        <g key={ann.id} onClick={() => isEditing && removeAnnotation(ann.id)} className={clickable}>
          <polyline
            points={pts}
            fill="none"
            stroke={ann.color}
            strokeWidth={ann.lineWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {isEditing && (
            <polyline points={pts} fill="none" stroke="transparent" strokeWidth={Math.max(ann.lineWidth + 12, 16)} />
          )}
        </g>
      )
    }
    if (ann.type === 'arrow') {
      const x1 = ann.start.x * W
      const y1 = ann.start.y * H
      const x2 = ann.end.x * W
      const y2 = ann.end.y * H
      return (
        <g key={ann.id} onClick={() => isEditing && removeAnnotation(ann.id)} className={clickable}>
          <defs>
            <marker id={`ah-${ann.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={ann.color} />
            </marker>
          </defs>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={ann.color}
            strokeWidth={ann.lineWidth}
            markerEnd={`url(#ah-${ann.id})`}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )
    }
    if (ann.type === 'rect') {
      const x = Math.min(ann.start.x, ann.end.x) * W
      const y = Math.min(ann.start.y, ann.end.y) * H
      const w = Math.abs(ann.end.x - ann.start.x) * W
      const h = Math.abs(ann.end.y - ann.start.y) * H
      return (
        <rect
          key={ann.id}
          x={x}
          y={y}
          width={w}
          height={h}
          stroke={ann.color}
          strokeWidth={ann.lineWidth}
          fill="none"
          vectorEffect="non-scaling-stroke"
          onClick={() => isEditing && removeAnnotation(ann.id)}
          className={clickable}
        />
      )
    }
    if (ann.type === 'text') {
      return (
        <text
          key={ann.id}
          x={ann.svgX * W}
          y={ann.svgY * H}
          fill={ann.color}
          fontSize={ann.lineWidth * 8 + 12}
          fontWeight="bold"
          fontFamily="sans-serif"
          onClick={() => isEditing && removeAnnotation(ann.id)}
          className={`select-none ${clickable}`}
        >
          {ann.text}
        </text>
      )
    }
    return null
  }

  function renderDraft() {
    if (!draft) return null
    if (draft.type === 'path') {
      const pts = draft.points.map((p) => `${p.x * W},${p.y * H}`).join(' ')
      return (
        <polyline
          points={pts}
          fill="none"
          stroke={draft.color}
          strokeWidth={draft.lineWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    if (draft.type === 'arrow') {
      return (
        <line
          x1={draft.start.x * W}
          y1={draft.start.y * H}
          x2={draft.end.x * W}
          y2={draft.end.y * H}
          stroke={draft.color}
          strokeWidth={draft.lineWidth}
          strokeDasharray="6 3"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    if (draft.type === 'rect') {
      const x = Math.min(draft.start.x, draft.end.x) * W
      const y = Math.min(draft.start.y, draft.end.y) * H
      const w = Math.abs(draft.end.x - draft.start.x) * W
      const h = Math.abs(draft.end.y - draft.start.y) * H
      return (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          stroke={draft.color}
          strokeWidth={draft.lineWidth}
          fill="none"
          strokeDasharray="6 3"
          vectorEffect="non-scaling-stroke"
        />
      )
    }
    return null
  }

  const src = withImageVariant(node.attrs.src, 'content')
  const ActiveToolIcon = TOOLS.find((t) => t.id === tool)?.icon ?? PenLine
  const displayWidthPct = liveWidthPct ?? widthPct
  // Outer box: controls the resizable width, carries the selection ring and
  // the pill/handle controls — never clipped, so they're never cut off.
  const wrapperStyle = { userSelect: 'none', width: `${displayWidthPct}%` }
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
      <div
        ref={boxRef}
        onClick={onImageClick}
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

        <div className="relative rounded-b overflow-hidden" style={frameStyle}>
          <div ref={rotWrapRef} style={rotWrapStyle}>
            <img
              src={src}
              alt={node.attrs.alt ?? ''}
              style={imgStyle}
              draggable={false}
              onLoad={(e) => setNatural({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
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
                if (e.key === 'Escape') setTextInput(null)
              }}
              onBlur={(e) => commitTextInput(e.target.value)}
            />
          )}
        </div>

        {editable && mode === 'view' && (
          <div
            // Top-right: keeps the primary "Editar imagen" affordance in view
            // above the fold on a tall image, and clear of the bottom-right
            // resize handle.
            className={`absolute top-2 right-2 flex items-center gap-1.5 opacity-100 transition-opacity ${
              selected ? 'sm:opacity-100' : 'sm:opacity-0 sm:group-hover/img:opacity-100'
            }`}
          >
            <button
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setMode('edit')}
              className="flex items-center gap-1.5 text-xs font-medium bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Editar imagen
            </button>
            <button
              title="Arrastrar para mover la imagen"
              className="flex items-center justify-center w-8 h-8 rounded-lg bg-[hsl(var(--background)/0.9)] backdrop-blur-sm border border-[hsl(var(--border))] shadow-sm text-[hsl(var(--muted-foreground))] cursor-grab active:cursor-grabbing"
              style={{ touchAction: 'none' }}
              onPointerDown={onHandlePointerDown}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerUp}
              onPointerCancel={onHandlePointerUp}
            >
              <GripVertical className="w-4 h-4" />
            </button>
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

      {dropIndicator && (
        <div
          className="fixed h-0.5 bg-amber-500 rounded-full z-50 pointer-events-none"
          style={{ top: dropIndicator.top, left: dropIndicator.left, width: dropIndicator.width }}
        />
      )}

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
            })
            setCropOpen(false)
          }}
        />
      )}
    </NodeViewWrapper>
  )
}
