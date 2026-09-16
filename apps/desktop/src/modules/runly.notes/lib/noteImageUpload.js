import { toast } from 'sonner'
import { ReactRenderer } from '@tiptap/react'
import { runly } from '../../../lib/runly.js'
import { supabase } from '../../../lib/supabase.js'
import { computeInitialImageWidthPct } from './imageSize.js'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

// Reads natural pixel dimensions from a local File via a throwaway object
// URL — no network round-trip, resolves as soon as the browser decodes the
// image header. Never rejects: unreadable dimensions just fall back to the
// flat default scale in computeInitialImageWidthPct.
function getImageNaturalSize(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const done = (size) => {
      URL.revokeObjectURL(url)
      resolve(size)
    }
    img.onload = () => done({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight })
    img.onerror = () => done({ naturalWidth: 0, naturalHeight: 0 })
    img.src = url
  })
}

// The note's content column width in px, read live from the ProseMirror DOM
// (minus its own horizontal padding) so the initial scale is correct on
// whatever screen size the image is actually being inserted on.
function getContentColumnWidthPx(editor) {
  const dom = editor?.view?.dom
  if (!dom) return null
  const rect = dom.getBoundingClientRect()
  const style = window.getComputedStyle(dom)
  const paddingX = parseFloat(style.paddingLeft || '0') + parseFloat(style.paddingRight || '0')
  const width = rect.width - paddingX
  return width > 0 ? width : null
}

// Shared upload+insert flow for in-body note images — used by both the
// toolbar's "Insertar imagen" button and the slash command menu's "Imagen"
// item, so there is a single place that talks to /notes/presign-image and
// the runly-notes bucket.
export async function uploadAndInsertNoteImage(file, { editor, noteId, token }) {
  if (!file || !token) return
  if (!file.type.startsWith('image/')) {
    toast.error('Selecciona un archivo de imagen valido.')
    return
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error('La imagen no puede superar 20 MB.')
    return
  }
  try {
    const [presign, naturalSize] = await Promise.all([
      runly.notes.presignImage({ fileName: file.name, mimeType: file.type, noteId }, token),
      getImageNaturalSize(file),
    ])
    const { error } = await supabase.storage
      .from('runly-notes')
      .uploadToSignedUrl(presign.objectKey, presign.uploadToken, file)
    if (error) throw error
    // Inserted at a scale computed from the image's own dimensions — a tall
    // image (e.g. a phone screenshot) is scaled down further than a normal
    // landscape one, so it's fully visible without much scrolling right
    // away. The resize handle (ImageAnnotationOverlay) lets the user grow
    // it from here.
    const width = computeInitialImageWidthPct({
      naturalWidth: naturalSize.naturalWidth,
      naturalHeight: naturalSize.naturalHeight,
      columnWidthPx: getContentColumnWidthPx(editor),
    })
    editor.chain().focus().insertContent({
      type: 'image',
      attrs: { src: presign.publicUrl, alt: file.name, width },
    }).run()
  } catch (err) {
    toast.error(err?.message ?? 'No se pudo subir la imagen.')
  }
}

function isCoarsePointerDevice() {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
}

// Opens a native file picker and runs uploadAndInsertNoteImage on the chosen
// file. Used where there's no persistent <input type="file"> element to
// reuse (e.g. the slash command menu). On a touch device, offers the same
// camera-vs-gallery choice as the toolbar's image button instead.
export function pickAndUploadNoteImage({ editor, noteId, token }) {
  if (isCoarsePointerDevice()) {
    pickViaSourceSheet({ editor, noteId, token })
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  input.onchange = () => {
    const file = input.files?.[0]
    if (file) uploadAndInsertNoteImage(file, { editor, noteId, token })
    input.remove()
  }
  document.body.appendChild(input)
  input.click()
}

// Mounts a detached ImageSourceSheet (open by default) so the slash command
// — which runs outside any note screen's own component tree — can still
// offer the camera-vs-gallery choice already used by NoteToolbar.jsx.
// `@runly/ui` is imported dynamically (not at module top level) so this
// module stays importable from the plain Node test runner, which has no JSX
// loader for the rest of the @runly/ui component tree.
async function pickViaSourceSheet({ editor, noteId, token }) {
  const { ImageSourceSheet } = await import('@runly/ui')
  const host = document.createElement('div')
  document.body.appendChild(host)

  function cleanup() {
    renderer.destroy()
    host.remove()
  }

  const renderer = new ReactRenderer(ImageSourceSheet, {
    editor,
    props: {
      open: true,
      onOpenChange: (next) => { if (!next) cleanup() },
      onPickFile: (file) => {
        uploadAndInsertNoteImage(file, { editor, noteId, token })
        cleanup()
      },
    },
  })
  host.appendChild(renderer.element)
}
