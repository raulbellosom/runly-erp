import { GripVertical } from 'lucide-react'
import { Button, cn } from '@runly/ui'

// placement="gutter": a slim grip in the sheet's left padding beside the
// block (parent must be `relative note-block`), revealed on hover like a
// classic block handle, so it never takes a row of its own above the block.
// placement="inline": a regular button inside the block's own chrome (tables,
// whose scrolling wrapper would clip anything outside it).
export function NoteBlockDragHandle({ label, drag, placement = 'inline' }) {
  const gutter = placement === 'gutter'
  return (
    <Button
      type="button"
      variant={gutter ? 'ghost' : 'outline'}
      size="icon"
      contentEditable={false}
      draggable={false}
      data-note-drag-handle={gutter ? 'gutter' : 'inline'}
      data-html2canvas-ignore
      aria-label={label}
      title={`${label}: arrastra el sujetador`}
      className={cn(
        'shrink-0 cursor-grab active:cursor-grabbing text-muted-foreground',
        gutter
          ? 'note-block-grip absolute top-0 z-10 h-7 rounded-md p-0 hover:bg-muted hover:text-foreground'
          : 'h-9 w-9 bg-background/95 shadow-sm',
      )}
      style={{
        touchAction: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
        ...(gutter ? {
          left: 'calc(-1 * var(--note-sheet-padding, 2rem))',
          width: 'var(--note-sheet-padding, 2rem)',
        } : null),
      }}
      onPointerDown={drag.onHandlePointerDown}
      onPointerMove={e => { e.stopPropagation(); drag.onPointerMove(e) }}
      onPointerUp={e => { e.stopPropagation(); drag.onPointerUp(e) }}
      onPointerCancel={e => { e.stopPropagation(); drag.onPointerCancel(e) }}
      onMouseDown={e => e.preventDefault()}
      onClick={e => { e.preventDefault(); e.stopPropagation(); drag.wasDragRef.current = false }}
      onContextMenu={e => e.preventDefault()}
    >
      <GripVertical size={gutter ? 16 : 18} />
    </Button>
  )
}
