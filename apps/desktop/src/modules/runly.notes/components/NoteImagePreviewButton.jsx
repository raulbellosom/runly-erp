import { useState } from 'react'
import { Expand } from 'lucide-react'
import { AdvancedFileViewer, Button } from '@runly/ui'

const resolveImageUrl = (file) => file.url

export function NoteImagePreviewButton({ src, alt }) {
  const [open, setOpen] = useState(false)
  if (!src) return null

  return (
    <span contentEditable={false} onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 bg-background/95 shadow-sm"
        aria-label="Ver imagen"
        title="Ver imagen"
        data-html2canvas-ignore
        onMouseDown={e => e.preventDefault()}
        onClick={() => {
          if (document.activeElement?.isContentEditable) document.activeElement.blur()
          setOpen(true)
        }}
      >
        <Expand size={16} />
      </Button>
      {open && (
        <AdvancedFileViewer
          open
          onOpenChange={setOpen}
          files={[{ id: src, url: src, originalName: alt || 'Imagen de la nota', mimeType: 'image/png' }]}
          activeIndex={0}
          onIndexChange={() => {}}
          onResolveSignedUrl={resolveImageUrl}
          zIndex={100}
        />
      )}
    </span>
  )
}
