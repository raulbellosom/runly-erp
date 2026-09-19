const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024

async function embedPublicImage(image) {
  const src = image.getAttribute('src')
  if (!src || src.startsWith('data:')) return
  try {
    const response = await fetch(src, { credentials: 'omit', signal: AbortSignal.timeout(10000) })
    if (!response.ok) return
    const blob = await response.blob()
    if (!blob.type.startsWith('image/') || blob.size > MAX_INLINE_IMAGE_BYTES) return
    image.src = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    // Preserve the public image URL when CORS or connectivity prevents embedding.
  }
}

export function getNoteClipboardContent(sheet, coverUrl) {
  const editor = sheet?.querySelector('.tiptap')?.editor
  if (!editor) throw new Error('Espera a que termine de cargar la nota.')
  // The live editor includes realtime edits. Its HTML serializer excludes
  // resize handles, preview buttons, low-resolution placeholders and toolbars.
  const html = editor.getHTML()
  const text = editor.getText({ blockSeparator: '\n\n' })
  const document = new DOMParser().parseFromString(html, 'text/html')
  if (coverUrl) {
    const cover = document.createElement('img')
    cover.src = coverUrl
    cover.alt = 'Portada de la nota'
    document.body.prepend(cover)
  }
  // Preserve authored image widths when pasting into another rich text editor.
  for (const image of document.images) {
    const width = Number(image.getAttribute('data-width'))
    if (width > 0 && width <= 100) image.style.width = `${width}%`
    image.style.maxWidth = '100%'
    image.style.height = 'auto'
  }
  return { text, document }
}

export async function copyNoteContent(sheet, { coverUrl } = {}) {
  const { text, document } = getNoteClipboardContent(sheet, coverUrl)
  const clipboard = navigator.clipboard
  if (!clipboard?.writeText) throw new Error('Este navegador no permite copiar contenido. Usa una conexión HTTPS.')
  if (!clipboard.write || typeof ClipboardItem === 'undefined' || ClipboardItem.supports?.('text/html') === false) {
    await clipboard.writeText(text)
    return { rich: false }
  }
  const htmlBlob = Promise.all([...document.images].map(embedPublicImage)).then(() =>
    new Blob([document.body.innerHTML], { type: 'text/html' }),
  )
  try {
    // Start write during the click gesture; Safari accepts asynchronous Blob
    // promises but rejects clipboard calls made after awaiting image downloads.
    await clipboard.write([new ClipboardItem({
      'text/html': htmlBlob,
      'text/plain': new Blob([text], { type: 'text/plain' }),
    })])
    return { rich: true }
  } catch {
    await clipboard.writeText(text)
    return { rich: false }
  }
}
