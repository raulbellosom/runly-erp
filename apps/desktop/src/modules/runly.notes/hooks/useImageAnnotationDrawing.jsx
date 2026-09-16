import { useRef, useState } from 'react'
import { elementFracToImageSpace } from '../lib/imageCrop.js'

const W = 1000
const H = 1000

// Pen/arrow/rect/text annotation drawing over an image's SVG overlay —
// shared by the inline edit mode (ImageAnnotationOverlay.jsx) and the
// table-cell modal (ImageEditModal.jsx) so the drawing math and SVG
// rendering aren't duplicated between them. See
// docs/superpowers/specs/2026-09-17-notes-table-cell-image-modal-design.md.
export function useImageAnnotationDrawing({ svgRef, crop, annotations, tool, color, lineWidth, isEditing, updateAttributes }) {
  const drawRef = useRef(null) // { pointerId }
  const [draft, setDraft] = useState(null)
  const [textInput, setTextInput] = useState(null) // { screenX, screenY, svgX, svgY }

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

  function cancelTextInput() {
    setTextInput(null)
  }

  function cancelDraft() {
    drawRef.current = null
    setDraft(null)
  }

  function removeAnnotation(id) {
    updateAttributes({
      annotations: JSON.stringify(annotations.filter((a) => a.id !== id)),
    })
  }

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

  return {
    draft, textInput, onDrawPointerDown, onDrawPointerMove, onDrawPointerUp,
    commitTextInput, cancelTextInput, cancelDraft, removeAnnotation, renderAnnotation, renderDraft,
  }
}
