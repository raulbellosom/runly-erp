import { useState } from 'react'
import { Copy, Check, Share2, FileDown, Image as ImageIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

// Accessible action row for a public (anonymous, no-auth) note/canvas page:
// copy link, native share sheet when available, and raster download(s).
// Shared by PublicNoteScreen and PublicCanvasView so both note types get the
// same controls instead of only being reachable from inside the app.
export function PublicNoteToolbar({ title, publicUrl, onDownloadPdf, onDownloadImage, imageLabel = 'JPG' }) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(null) // 'pdf' | 'image' | null

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('No se pudo copiar el enlace')
    }
  }

  async function handleShare() {
    try {
      await navigator.share({ title: title || 'Nota', url: publicUrl })
    } catch {
      // User cancelled the share sheet — not an error.
    }
  }

  async function handleDownload(kind, fn) {
    if (!fn || busy) return
    setBusy(kind)
    try {
      await fn()
    } catch (err) {
      toast.error(err?.message ?? 'No se pudo descargar')
    } finally {
      setBusy(null)
    }
  }

  const btnClass =
    'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button type="button" onClick={handleCopy} className={btnClass} title={publicUrl}>
        {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
        {copied ? 'Copiado' : 'Copiar enlace'}
      </button>
      {typeof navigator !== 'undefined' && navigator.share && (
        <button type="button" onClick={handleShare} className={btnClass}>
          <Share2 size={13} />
          Compartir
        </button>
      )}
      {onDownloadPdf && (
        <button
          type="button"
          onClick={() => handleDownload('pdf', onDownloadPdf)}
          disabled={busy === 'pdf'}
          className={btnClass}
        >
          {busy === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <FileDown size={13} />}
          PDF
        </button>
      )}
      {onDownloadImage && (
        <button
          type="button"
          onClick={() => handleDownload('image', onDownloadImage)}
          disabled={busy === 'image'}
          className={btnClass}
        >
          {busy === 'image' ? <Loader2 size={13} className="animate-spin" /> : <ImageIcon size={13} />}
          {imageLabel}
        </button>
      )}
    </div>
  )
}
