import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { screenToWorld } from '../engine/viewport.js'
import { openPdfFromUrl, renderPdfPageCanvas } from '../lib/media.js'
import { neededBucket, sharpCandidates } from '../lib/sharpPdf.js'

const unwrap = (response) => response?.data ?? response
const DEBOUNCE_MS = 250
const MAX_CACHE = 12

// Module-level so switching pages (which remounts the editor's data hooks)
// does not re-fetch or re-render what was already sharpened this session.
const docCache = new Map() // sourceFileId -> Promise<pdfDoc>
const failedSources = new Set() // sourceFileId: CORS/network failure, don't retry
const renderCache = new Map() // `${fileId}@${bucket}` -> canvas, insertion-ordered (LRU)
const pending = new Set() // keys currently rendering, to avoid duplicate work

function cacheGet(key) {
  if (!renderCache.has(key)) return null
  const value = renderCache.get(key)
  renderCache.delete(key); renderCache.set(key, value) // refresh recency
  return value
}
function cacheSet(key, value) {
  renderCache.delete(key); renderCache.set(key, value)
  if (renderCache.size > MAX_CACHE) renderCache.delete(renderCache.keys().next().value)
}
async function loadDoc(sourceFileId, token) {
  if (!docCache.has(sourceFileId)) {
    docCache.set(sourceFileId, (async () => {
      const urls = unwrap(await runly.files.batchSignedUrls([sourceFileId], token)) ?? {}
      const url = urls[sourceFileId]
      if (!url) throw new Error('No se pudo firmar el PDF original')
      return openPdfFromUrl(url)
    })())
  }
  return docCache.get(sourceFileId)
}
const pdfPagesIn = (rows) => rows.filter((row) => row.type === 'image' && row.properties?.sourceFileId && row.properties?.page)

// Re-renders visible PDF page images from their source PDF at a
// zoom-dependent resolution and overrides the matching entries of `images`
// (the editor's stored-raster map) so they read sharper when zoomed in.
// Exports and thumbnails render straight from the stored images and are
// unaffected (see lib/renderScene.js).
export function useSharpPdfImages({ rows, viewport, size, images }) {
  const token = useAuth().session?.access_token
  const [version, setVersion] = useState(0)
  const timerRef = useRef(0), mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])

  useEffect(() => {
    clearTimeout(timerRef.current)
    if (!size.width || !size.height) return undefined
    timerRef.current = setTimeout(() => {
      const a = screenToWorld({ x: 0, y: 0 }, viewport), b = screenToWorld({ x: size.width, y: size.height }, viewport)
      const bounds = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
      for (const object of sharpCandidates(rows, bounds)) {
        const bucket = neededBucket(object, viewport.zoom)
        if (!bucket) continue
        const { fileId, sourceFileId, page, naturalWidth, naturalHeight } = object.properties
        const key = `${fileId}@${bucket}`
        if (renderCache.has(key) || pending.has(key) || failedSources.has(sourceFileId)) continue
        pending.add(key)
        ;(async () => {
          try {
            const doc = await loadDoc(sourceFileId, token)
            const longest = Math.max(naturalWidth, naturalHeight ?? naturalWidth)
            const canvas = await renderPdfPageCanvas(doc, page, longest * bucket)
            cacheSet(key, canvas)
            if (mountedRef.current) setVersion((value) => value + 1)
          } catch {
            failedSources.add(sourceFileId)
          } finally {
            pending.delete(key)
          }
        })()
      }
    }, DEBOUNCE_MS)
    return () => clearTimeout(timerRef.current)
  }, [rows, viewport, size, token])

  return useMemo(() => {
    if (!images?.size) return images
    const overrides = new Map(images)
    for (const object of pdfPagesIn(rows)) {
      const needed = neededBucket(object, viewport.zoom)
      if (!needed) continue
      for (let bucket = needed; bucket >= 2; bucket /= 2) {
        const cached = cacheGet(`${object.properties.fileId}@${bucket}`)
        if (cached) { overrides.set(object.properties.fileId, cached); break }
      }
    }
    return overrides
    // `version` bumps once an in-flight render lands, to recompute overrides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, rows, viewport.zoom, version])
}
