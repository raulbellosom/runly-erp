import { NodeViewWrapper } from '@tiptap/react'
import { useContext, useRef, useState, useEffect } from 'react'
import { NoteInteractionContext } from './NoteInteractionContext.js'
import { X } from 'lucide-react'
import { ConfirmDialog } from '@runly/ui'
import { NoteBlockDragHandle } from './NoteBlockDragHandle.jsx'
import { useBlockDragReorder } from '../hooks/useBlockDragReorder.js'
import { isInsideTableCell } from '../lib/tableContext.js'
import {
  parseStrokes, parseErased, newStrokeId, mergeDrawing, createKnownDrawing, addToDrawing, eraseFromDrawing,
} from '../lib/drawingStrokes.js'

const COLORS = ['#1a1a1a', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ffffff']
const BACKGROUNDS = ['#ffffff', '#f3f4f6', '#fef9c3', '#dbeafe', '#dcfce7', '#1a1a1a']
const SIZES = [2, 4, 8, 14, 20]

// S Pen / stylus barrel button reported while the tip is down (W3C "eraser" bit).
const PEN_ERASER_BUTTONS = 32

export function DrawingCanvas({ node, updateAttributes, editor, deleteNode, getPos: getNodePos }) {
  const { viewing } = useContext(NoteInteractionContext)
  const canvasRef = useRef(null)
  const blockRef = useRef(null)
  // The one pointer currently drawing. Any other pointer (a resting palm, a
  // second finger) is ignored instead of hijacking the stroke in progress.
  const activePointer = useRef(null)
  const currentStroke = useRef(null)
  const strokesRef = useRef(parseStrokes(node.attrs.strokes))
  const knownRef = useRef(createKnownDrawing())
  // Ids of strokes this user drew, newest last — "Deshacer" only removes your own.
  const myStrokeIds = useRef([])
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState('#1a1a1a')
  const [size, setSize] = useState(4)
  const [strokeCount, setStrokeCount] = useState(strokesRef.current.length)
  const [confirmClose, setConfirmClose] = useState(false)
  // Once a stylus is used here, fingers scroll the note and only the pen draws
  // (palm rejection, like Samsung Notes).
  const [penMode, setPenMode] = useState(false)

  const editable = !viewing

  function publish(strokes, erased) {
    updateAttributes({ strokes: JSON.stringify(strokes), erased: JSON.stringify(erased) })
  }

  // Every attribute change (ours or a collaborator's) is merged with what this
  // client already knows, so a concurrent write can't drop anyone's strokes.
  useEffect(() => {
    const remote = parseStrokes(node.attrs.strokes)
    const remoteErased = parseErased(node.attrs.erased)
    const merged = mergeDrawing(knownRef.current, remote, remoteErased)
    strokesRef.current = merged.strokes
    setStrokeCount(merged.strokes.length)
    redraw()
    if (merged.changed && editable) publish(merged.strokes, merged.erased)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.attrs.strokes, node.attrs.erased])

  function redraw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    strokesRef.current.forEach(s => paintStroke(ctx, s))
    // A collaborator's update can land mid-stroke; keep the stroke in progress.
    if (currentStroke.current) paintStroke(ctx, currentStroke.current)
  }

  function segmentWidth(stroke, a, b) {
    if (a.p == null || b.p == null) return stroke.size
    // Pressure 0..1 (0.5 = "normal"): thinner when light, thicker when firm.
    return Math.max(0.5, stroke.size * (0.35 + (a.p + b.p) * 0.65))
  }

  function paintSegments(ctx, stroke, from) {
    const pts = stroke.points
    ctx.save()
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = stroke.tool === 'eraser' ? 'rgba(0,0,0,1)' : stroke.color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = Math.max(1, from); i < pts.length; i++) {
      ctx.beginPath()
      ctx.lineWidth = segmentWidth(stroke, pts[i - 1], pts[i])
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
      ctx.lineTo(pts[i].x, pts[i].y)
      ctx.stroke()
    }
    ctx.restore()
  }

  function paintStroke(ctx, stroke) {
    if (!stroke.points?.length) return
    if (stroke.points.length === 1) {
      // A tap is a dot, not nothing.
      paintSegments(ctx, { ...stroke, points: [stroke.points[0], stroke.points[0]] }, 1)
      return
    }
    paintSegments(ctx, stroke, 1)
  }

  function pointFrom(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / rect.width
    const scaleY = canvasRef.current.height / rect.height
    const point = {
      x: Math.round((e.clientX - rect.left) * scaleX * 10) / 10,
      y: Math.round((e.clientY - rect.top) * scaleY * 10) / 10,
    }
    if (e.pointerType === 'pen' && e.pressure > 0) point.p = Math.round(e.pressure * 100) / 100
    return point
  }

  function onPointerDown(e) {
    if (e.pointerType === 'pen' && !penMode) setPenMode(true)
    // Palm rejection: with a stylus in use, touches never draw.
    if (e.pointerType === 'touch' && penMode) return
    if (activePointer.current !== null) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    e.preventDefault()
    activePointer.current = e.pointerId
    try { canvasRef.current.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    const erasing = tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & PEN_ERASER_BUTTONS))
    currentStroke.current = {
      id: newStrokeId(),
      tool: erasing ? 'eraser' : 'pen',
      color,
      size: erasing ? Math.max(size, 14) : size,
      points: [pointFrom(e)],
    }
    paintStroke(canvasRef.current.getContext('2d'), currentStroke.current)
  }

  function onPointerMove(e) {
    if (e.pointerId !== activePointer.current || !currentStroke.current) return
    e.preventDefault()
    const stroke = currentStroke.current
    const from = stroke.points.length
    // Coalesced events carry the intermediate stylus samples the browser
    // batched into this frame — without them fast handwriting turns jagged.
    const events = typeof e.nativeEvent.getCoalescedEvents === 'function'
      ? e.nativeEvent.getCoalescedEvents()
      : []
    for (const ev of events.length ? events : [e]) stroke.points.push(pointFrom(ev))
    paintSegments(canvasRef.current.getContext('2d'), stroke, from)
  }

  function onPointerEnd(e) {
    if (e.pointerId !== activePointer.current) return
    activePointer.current = null
    const stroke = currentStroke.current
    currentStroke.current = null
    if (!stroke) return
    myStrokeIds.current.push(stroke.id)
    const next = addToDrawing(knownRef.current, strokesRef.current, stroke)
    strokesRef.current = next.strokes
    setStrokeCount(next.strokes.length)
    publish(next.strokes, next.erased)
  }

  function eraseIds(ids) {
    const next = eraseFromDrawing(knownRef.current, strokesRef.current, ids)
    strokesRef.current = next.strokes
    setStrokeCount(next.strokes.length)
    redraw()
    publish(next.strokes, next.erased)
  }

  function undoLast() {
    const live = new Set(strokesRef.current.map(s => s.id))
    while (myStrokeIds.current.length && !live.has(myStrokeIds.current.at(-1))) myStrokeIds.current.pop()
    const id = myStrokeIds.current.pop()
    if (id) eraseIds([id])
  }

  function clearAll() {
    eraseIds(strokesRef.current.map(s => s.id))
  }

  const inTableCell = typeof getNodePos === 'function' && isInsideTableCell(editor.state, getNodePos())
  const drag = useBlockDragReorder({
    editor,
    getPos: getNodePos,
    getBoxEl: () => blockRef.current,
    getFrameEl: () => blockRef.current,
    editable: editable && !inTableCell,
    isEditing: false,
  })

  return (
    <NodeViewWrapper className="note-block relative my-4 select-none">
      {editable && !inTableCell && <NoteBlockDragHandle label="Mover dibujo" drag={drag} placement="gutter" />}
      <div ref={blockRef} className="border border-[hsl(var(--border))] rounded-xl overflow-hidden shadow-sm">
        {editable && (
          <div className="flex items-center gap-2 px-3 py-2 bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))] flex-wrap">
            <button onClick={() => setTool('pen')} className={`px-2 py-1 text-xs rounded font-medium ${tool === 'pen' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)]'}`}>Lapiz</button>
            <button onClick={() => setTool('eraser')} className={`px-2 py-1 text-xs rounded font-medium ${tool === 'eraser' ? 'bg-[hsl(var(--muted-foreground)/0.2)]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)]'}`}>Borrador</button>
            <div className="h-4 w-px bg-[hsl(var(--border))]" />
            <div className="flex gap-1">
              {COLORS.map(c => (
                <button key={c} onClick={() => { setTool('pen'); setColor(c) }}
                  className={`w-5 h-5 rounded-full border-2 ${color === c && tool === 'pen' ? 'border-amber-500 scale-110' : 'border-transparent'}`}
                  style={{ backgroundColor: c === '#ffffff' ? '#f3f4f6' : c }} />
              ))}
            </div>
            <div className="h-4 w-px bg-[hsl(var(--border))]" />
            <div className="flex gap-1 items-center">
              {SIZES.map(s => (
                <button key={s} onClick={() => setSize(s)} className={`flex items-center justify-center w-6 h-6 rounded ${size === s ? 'bg-amber-100 dark:bg-amber-900/40' : 'hover:bg-[hsl(var(--muted-foreground)/0.1)]'}`}>
                  <div className="rounded-full bg-[hsl(var(--foreground))]" style={{ width: Math.min(s, 14), height: Math.min(s, 14) }} />
                </button>
              ))}
            </div>
            <div className="h-4 w-px bg-[hsl(var(--border))]" />
            <div className="flex gap-1 items-center">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">Fondo</span>
              {BACKGROUNDS.map(bg => (
                <button key={bg} onClick={() => updateAttributes({ backgroundColor: bg })}
                  aria-label={`Fondo ${bg}`}
                  className={`w-5 h-5 rounded-full border-2 ${node.attrs.backgroundColor === bg ? 'border-amber-500 scale-110' : 'border-[hsl(var(--border))]'}`}
                  style={{ backgroundColor: bg }} />
              ))}
            </div>
            <div className="ml-auto flex gap-1">
              <button onClick={undoLast} disabled={strokeCount === 0} className="px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted-foreground)/0.1)] rounded disabled:opacity-30">Deshacer</button>
              <button onClick={clearAll} disabled={strokeCount === 0} className="px-2 py-1 text-xs text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded disabled:opacity-30">Limpiar</button>
              <button onClick={() => setConfirmClose(true)} title="Eliminar lienzo de dibujo" aria-label="Eliminar lienzo de dibujo"
                className="flex items-center justify-center w-6 h-6 text-[hsl(var(--muted-foreground))] hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
        <canvas
          ref={canvasRef}
          width={node.attrs.canvasWidth}
          height={node.attrs.canvasHeight}
          onPointerDown={editable ? onPointerDown : undefined}
          onPointerMove={editable ? onPointerMove : undefined}
          onPointerUp={editable ? onPointerEnd : undefined}
          onPointerCancel={editable ? onPointerEnd : undefined}
          onLostPointerCapture={editable ? onPointerEnd : undefined}
          style={{
            // In pen mode fingers pan the note; the stylus still draws.
            touchAction: editable && !penMode ? 'none' : 'pan-x pan-y',
            display: 'block',
            width: '100%',
            cursor: editable ? (tool === 'eraser' ? 'cell' : 'crosshair') : 'default',
            backgroundColor: node.attrs.backgroundColor,
          }}
        />
      </div>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Eliminar lienzo de dibujo"
        description="Se eliminara este lienzo y todo lo dibujado en el de la nota. Esta accion se puede deshacer con Ctrl+Z."
        confirmLabel="Eliminar"
        onConfirm={() => { setConfirmClose(false); deleteNode?.() }}
      />
    </NodeViewWrapper>
  )
}
