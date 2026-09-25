import { runly } from '../../../lib/runly'
import { supabase } from '../../../lib/supabase'

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024

// Given Excalidraw's files map after an onChange, upload any entry that still
// has only a dataURL (freshly pasted/dropped) to the runly-notes bucket and
// return a persistable manifest:
//   { [fileId]: { mimeType, storageKey, url, created } }
// The persisted scene never carries dataURLs — only this manifest.
export async function syncNewImages({ files, manifest, noteId, token }) {
  const next = { ...manifest }
  const uploadedIds = []
  for (const [fileId, file] of Object.entries(files ?? {})) {
    if (next[fileId]?.url) continue // already uploaded
    const dataURL = file?.dataURL
    if (!dataURL || !dataURL.startsWith('data:')) continue
    const blob = dataURLtoBlob(dataURL)
    if (blob.size > MAX_IMAGE_BYTES) {
      throw new Error(`La imagen supera el limite de ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB`)
    }
    const mimeType = file.mimeType ?? blob.type ?? 'image/png'
    const ext = (mimeType.split('/')[1] ?? 'png').replace('+xml', '')
    const presign = await runly.notes.presignImage(
      { fileName: `canvas-${fileId}.${ext}`, mimeType, noteId },
      token,
    )
    const { error } = await supabase.storage
      .from('runly-notes')
      .uploadToSignedUrl(presign.objectKey, presign.uploadToken, blob, { contentType: mimeType })
    if (error) throw error
    next[fileId] = {
      mimeType,
      storageKey: presign.objectKey,
      url: presign.publicUrl,
      created: Date.now(),
    }
    uploadedIds.push(fileId)
  }
  return { manifest: next, uploadedIds }
}

export function pickManifest(manifest, ids) {
  const out = {}
  for (const id of ids) if (manifest[id]) out[id] = manifest[id]
  return out
}

// On load: fetch each manifest url and return an array shaped for
// excalidrawAPI.addFiles(): [{ id, mimeType, dataURL, created }].
export async function hydrateImages(manifest) {
  const entries = await Promise.all(
    Object.entries(manifest ?? {}).map(async ([fileId, meta]) => {
      if (!meta?.url) return null
      try {
        const res = await fetch(meta.url)
        if (!res.ok) return null
        const blob = await res.blob()
        const dataURL = await blobToDataURL(blob)
        return {
          id: fileId,
          mimeType: meta.mimeType ?? blob.type ?? 'image/png',
          dataURL,
          created: meta.created ?? Date.now(),
        }
      } catch {
        return null
      }
    }),
  )
  return entries.filter(Boolean)
}

export function dataURLtoBlob(dataURL) {
  const [head, b64] = dataURL.split(',')
  const mime = head.match(/data:(.*?);base64/)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}
