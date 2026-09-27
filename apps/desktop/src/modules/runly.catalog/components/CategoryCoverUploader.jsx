// apps/desktop/src/modules/runly.catalog/components/CategoryCoverUploader.jsx
import { useEffect, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { DistDropZone } from '@runly/ui'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { runly } from '../../../lib/runly.js'

/**
 * Single cover-image uploader for a catalog category — same upload/signed-url
 * pattern as ProductImageManager's cover slot, without the gallery.
 * Props: token, coverId (string|null), onChange(nextCoverId|null)
 */
export default function CategoryCoverUploader({ token, coverId, onChange }) {
  const [signedUrl, setSignedUrl] = useState(null)

  useEffect(() => {
    if (!coverId || !token) { setSignedUrl(null); return }
    runly.files.batchSignedUrls([coverId], token)
      .then(res => setSignedUrl(res?.data?.[coverId] ?? null))
      .catch(() => setSignedUrl(null))
  }, [coverId, token])

  const uploadMutation = useMutation({
    mutationFn: async (file) => {
      const form = new FormData()
      form.append('file', file)
      const res = await runly.files.upload(form, token)
      return res?.data ?? res
    },
    onError: err => toast.error(err?.message ?? 'Error al subir imagen'),
  })

  async function handleFile(file) {
    if (!file) return
    const asset = await uploadMutation.mutateAsync(file)
    onChange(asset.id)
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-widest text-[hsl(var(--muted-foreground))] mb-2">
        Imagen de portada (opcional)
      </p>
      <div className="flex items-center gap-3">
        <DistDropZone
          variant="avatar"
          accept="image/*"
          maxSizeMB={10}
          src={signedUrl}
          onFile={handleFile}
          isUploading={uploadMutation.isPending}
          fullScreenOverlay
          overlayLabel="Suelta la imagen aqui"
          overlayHint="Portada de la categoria"
          emptyLabel="Subir portada"
          className="w-20! h-20! rounded-2xl bg-[hsl(var(--muted))]/40 border-2 border-dashed border-[hsl(var(--border))]"
        />
        {coverId && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
          >
            <Trash2 className="h-3 w-3" /> Quitar
          </button>
        )}
      </div>
    </div>
  )
}
