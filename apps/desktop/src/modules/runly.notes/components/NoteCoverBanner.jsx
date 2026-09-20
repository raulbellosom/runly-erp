import { useState } from 'react'
import { ImagePlus, Image as ImageIcon, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ImageSourceSheet, useCoarsePointer } from '@runly/ui'
import { runly } from '../../../lib/runly'
import { supabase } from '../../../lib/supabase'
import { withImageVariant } from '../../../lib/imageVariants.js'
import { NoteImagePreviewButton } from './NoteImagePreviewButton.jsx'

const MAX_BANNER_BYTES = 20 * 1024 * 1024

// Cover/banner image for a note — reuses the same presign-image + runly-notes
// bucket flow as in-body images (NoteToolbar.jsx), but persists the result on
// note.cover_url instead of inserting a TipTap node.
export function NoteCoverBanner({ coverUrl, editable, noteId, token, onChange, onRemove }) {
  const [uploading, setUploading] = useState(false)
  // If the Supabase image-transform endpoint (/render/image/public/) can't
  // serve the `banner` variant, fall back to the original object URL so a
  // transform failure never leaves the cover blank. Keyed by URL so a new
  // cover retries the transform.
  const [failedUrl, setFailedUrl] = useState(null)
  const imgFallback = failedUrl === coverUrl
  const isCoarsePointer = useCoarsePointer()
  const [coverSheetOpen, setCoverSheetOpen] = useState(false)

  if (!coverUrl && !editable) return null

  async function handleFile(file) {
    if (!file || !token) return
    if (!file.type.startsWith('image/')) {
      toast.error('Selecciona un archivo de imagen valido.')
      return
    }
    if (file.size > MAX_BANNER_BYTES) {
      toast.error('La imagen no puede superar 20 MB.')
      return
    }
    setUploading(true)
    try {
      const presign = await runly.notes.presignImage(
        { fileName: file.name, mimeType: file.type, noteId },
        token,
      )
      const { error } = await supabase.storage
        .from('runly-notes')
        .uploadToSignedUrl(presign.objectKey, presign.uploadToken, file)
      if (error) throw error
      // Only persist after the upload is confirmed — never optimistically.
      onChange(presign.publicUrl)
    } catch (err) {
      toast.error(err?.message ?? 'No se pudo subir la portada.')
    } finally {
      setUploading(false)
    }
  }

  const coverSheet = (
    <ImageSourceSheet open={coverSheetOpen} onOpenChange={setCoverSheetOpen} onPickFile={handleFile} />
  )

  if (!coverUrl) {
    return (
      <div className="note-sheet-inset pt-4">
        {isCoarsePointer ? (
          <button
            type="button"
            disabled={uploading}
            onClick={() => setCoverSheetOpen(true)}
            className={[
              'inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground rounded-lg px-2.5 py-1.5 transition-colors',
              uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted hover:text-foreground',
            ].join(' ')}
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            Agregar portada
          </button>
        ) : (
          <label
            className={[
              'inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground rounded-lg px-2.5 py-1.5 cursor-pointer transition-colors',
              uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted hover:text-foreground',
            ].join(' ')}
          >
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
            Agregar portada
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={e => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) handleFile(file)
              }}
            />
          </label>
        )}
        {coverSheet}
      </div>
    )
  }

  return (
    <div className="relative group/cover w-full aspect-[3/1] overflow-hidden bg-muted">
      <img
        key={coverUrl}
        src={imgFallback ? coverUrl : withImageVariant(coverUrl, 'banner')}
        alt=""
        className="w-full h-full object-cover"
        draggable={false}
        onError={() => setFailedUrl(coverUrl)}
      />
      <div className="absolute top-2 right-2">
        <NoteImagePreviewButton src={coverUrl} alt="Portada de la nota" />
      </div>
      {editable && (
        <div className="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover/cover:opacity-100 transition-opacity">
          {isCoarsePointer ? (
            <button
              type="button"
              disabled={uploading}
              onClick={() => setCoverSheetOpen(true)}
              className={[
                'flex items-center gap-1.5 text-xs font-medium bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2.5 py-1.5 shadow-sm transition-colors',
                uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted',
              ].join(' ')}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              Cambiar portada
            </button>
          ) : (
            <label
              className={[
                'flex items-center gap-1.5 text-xs font-medium bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2.5 py-1.5 cursor-pointer shadow-sm transition-colors',
                uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted',
              ].join(' ')}
            >
              {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImageIcon className="w-3.5 h-3.5" />}
              Cambiar portada
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                onChange={e => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) handleFile(file)
                }}
              />
            </label>
          )}
          <button
            onClick={onRemove}
            className="flex items-center gap-1.5 text-xs font-medium bg-background/90 backdrop-blur-sm border border-border rounded-lg px-2.5 py-1.5 shadow-sm hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Quitar
          </button>
        </div>
      )}
      {coverSheet}
    </div>
  )
}
