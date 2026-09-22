import { useState, useEffect, useMemo } from 'react'
import {
  useAttachmentsController,
  resolveAttachmentFileType,
  AdvancedFileViewer,
} from '@runly/ui'
import {
  Download,
  ExternalLink,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  ImageIcon,
  Loader2,
} from 'lucide-react'

// ── File type icon map ────────────────────────────────────────────────────────

const KIND_ICON = {
  image:       FileImage,
  pdf:         FileType2,
  word:        FileText,
  spreadsheet: FileSpreadsheet,
  archive:     FileArchive,
  file:        File,
}

function FileKindIcon({ kind, className = 'h-5 w-5' }) {
  const Icon = KIND_ICON[kind] ?? File
  return <Icon className={className} />
}

function formatBytes(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 0) return ''
  if (v < 1024) return `${v} B`
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`
  return `${(v / (1024 * 1024)).toFixed(1)} MB`
}

// ── Image thumbnail ───────────────────────────────────────────────────────────

function ImageTile({ file, thumbnailUrl, loading, onClick }) {
  const [imgErr, setImgErr] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative group aspect-square rounded-lg overflow-hidden border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.4)] hover:border-[hsl(var(--primary)/0.6)] transition-colors"
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground))]" />
        </div>
      )}

      {thumbnailUrl && !imgErr ? (
        <img
          src={thumbnailUrl}
          alt={file.fileName}
          onError={() => setImgErr(true)}
          className="w-full h-full object-cover"
        />
      ) : !loading ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <ImageIcon className="h-8 w-8 text-[hsl(var(--muted-foreground))]" />
        </div>
      ) : null}

      {/* Hover overlay with filename */}
      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1 translate-y-full group-hover:translate-y-0 transition-transform">
        <p className="text-xs text-white truncate">{file.fileName}</p>
      </div>
    </button>
  )
}

// ── File list row ─────────────────────────────────────────────────────────────

function FileRow({ file, kind, onOpen, onDownload }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-[hsl(var(--border)/0.5)] last:border-0">
      <div className="h-8 w-8 shrink-0 rounded-md bg-[hsl(var(--muted)/0.5)] flex items-center justify-center text-[hsl(var(--muted-foreground))]">
        <FileKindIcon kind={kind} className="h-4 w-4" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{file.fileName}</p>
        {file.sizeBytes != null && (
          <p className="text-xs text-[hsl(var(--muted-foreground))]">{formatBytes(file.sizeBytes)}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onOpen}
          title="Abrir"
          className="flex h-7 w-7 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onDownload}
          title="Descargar"
          className="flex h-7 w-7 items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))] transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function InventoryFileGallery({ item, token, companyId = null, apiBaseUrl, config }) {
  const controller = useAttachmentsController({
    apiBaseUrl,
    token,
    companyId,
    recordId: item.id,
    config,
    context: 'detail',
    readOnly: true,
  })

  const {
    associatedItems,
    loading,
    viewerItem,
    closeViewer,
    openAssociated,
    downloadAssociated,
    resolveSignedUrl,
  } = controller

  const viewerFiles = useMemo(
    () =>
      associatedItems.map((f) => ({
        ...f,
        id: f.fileAssetId ?? f.id,
        originalName: f.fileName ?? 'Archivo',
      })),
    [associatedItems],
  )
  const viewerIndex = Math.max(
    0,
    viewerItem ? associatedItems.findIndex((f) => f.id === viewerItem.id) : 0,
  )

  // Split into images and other files
  const { images, others } = useMemo(() => {
    const imgs = []
    const rest = []
    for (const f of associatedItems) {
      const { kind } = resolveAttachmentFileType({ mimeType: f.mimeType, fileName: f.fileName })
      if (kind === 'image') imgs.push({ ...f, kind })
      else rest.push({ ...f, kind })
    }
    return { images: imgs, others: rest }
  }, [associatedItems])

  // Eagerly fetch thumbnail signed URLs for images
  const [thumbnails, setThumbnails] = useState({})
  const [thumbLoading, setThumbLoading] = useState(false)

  useEffect(() => {
    if (!images.length) { setThumbnails({}); return }
    let cancelled = false
    setThumbLoading(true)
    Promise.all(
      images.map(async img => {
        try {
          const url = await resolveSignedUrl(img.fileAssetId)
          return [img.fileAssetId, url]
        } catch {
          return [img.fileAssetId, null]
        }
      })
    ).then(entries => {
      if (cancelled) return
      setThumbnails(Object.fromEntries(entries))
      setThumbLoading(false)
    })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.map(i => i.fileAssetId).join(',')])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando archivos...
      </div>
    )
  }

  if (!associatedItems.length) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin archivos adjuntos.</p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Image gallery */}
      {images.length > 0 && (
        <div>
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2 uppercase tracking-wide">
            Imagenes ({images.length})
          </p>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {images.map(img => (
              <ImageTile
                key={img.id}
                file={img}
                thumbnailUrl={thumbnails[img.fileAssetId]}
                loading={thumbLoading && !thumbnails[img.fileAssetId]}
                onClick={() => openAssociated(img)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other files list */}
      {others.length > 0 && (
        <div>
          {images.length > 0 && (
            <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] mb-2 uppercase tracking-wide">
              Archivos ({others.length})
            </p>
          )}
          <div>
            {others.map(f => (
              <FileRow
                key={f.id}
                file={f}
                kind={f.kind}
                onOpen={() => openAssociated(f)}
                onDownload={() => downloadAssociated(f)}
              />
            ))}
          </div>
        </div>
      )}

      {/* File viewer (lightbox for images / PDF viewer) */}
      {viewerItem && (
        <AdvancedFileViewer
          open={Boolean(viewerItem)}
          onOpenChange={(open) => !open && closeViewer()}
          files={viewerFiles}
          activeIndex={viewerIndex}
          onIndexChange={(nextIndex) => {
            const target = associatedItems[nextIndex]
            if (target) openAssociated(target)
          }}
          onResolveSignedUrl={(file) => {
            if (file?.signedUrl) return file.signedUrl
            if (!file?.fileAssetId) return null
            return resolveSignedUrl(file.fileAssetId)
          }}
        />
      )}
    </div>
  )
}
