import { GripVertical } from 'lucide-react'
import { Button } from '@runly/ui'

export function NoteBlockDragHandle({ label, drag }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      contentEditable={false}
      draggable={false}
      data-note-drag-handle
      data-html2canvas-ignore
      aria-label={label}
      title={`${label}: arrastra el sujetador`}
      className="h-9 w-9 shrink-0 cursor-grab active:cursor-grabbing bg-background/95 text-muted-foreground shadow-sm"
      style={{ touchAction: 'none', userSelect: 'none', WebkitTouchCallout: 'none' }}
      onPointerDown={drag.onHandlePointerDown}
      onPointerMove={e => { e.stopPropagation(); drag.onPointerMove(e) }}
      onPointerUp={e => { e.stopPropagation(); drag.onPointerUp(e) }}
      onPointerCancel={e => { e.stopPropagation(); drag.onPointerCancel(e) }}
      onMouseDown={e => e.preventDefault()}
      onClick={e => { e.preventDefault(); e.stopPropagation(); drag.wasDragRef.current = false }}
      onContextMenu={e => e.preventDefault()}
    >
      <GripVertical size={18} />
    </Button>
  )
}
