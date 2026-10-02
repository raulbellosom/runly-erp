import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { chunk } from '../lib/dataBindings.js'
import { parseExcalidrawLibrary } from '../lib/libraryImport/excalidraw.js'
import { libraryBaseName, librarySourceKind } from '../lib/libraryImport/formats.js'
import { normalizeObjects } from '../lib/libraryImport/normalize.js'
import { sanitizeSvgText, svgSize } from '../lib/libraryImport/svg.js'

function useToken() { return useAuth().session?.access_token }
const unwrap = (response) => response?.data ?? response
const librariesKey = ['canvas', 'libraries']
// Exported so LibraryPanel's useQueries (one items fetch per library, run
// outside any single hook call) shares the exact same cache entries as
// useLibraryItems/useLibraryItemMutations below.
export const libraryItemsKey = (libraryId) => ['canvas', 'libraries', libraryId, 'items']
const MAX_ZIP_SVGS = 300
const MAX_SVG_BYTES = 2 * 1024 * 1024

// Reusable element libraries — queries/mutations (spec:
// docs/superpowers/specs/2026-10-02-canvas-libraries-design.md). The import
// flow (importFiles) lives here too since it orchestrates the same
// mutations across several files/zip entries in one user action.
export function useLibraries() {
  const token = useToken()
  return useQuery({ queryKey: librariesKey, queryFn: async () => unwrap(await runly.canvas.listLibraries(token)) ?? [], enabled: Boolean(token) })
}

export function useLibraryItems(libraryId, enabled = true) {
  const token = useToken()
  return useQuery({
    queryKey: libraryItemsKey(libraryId),
    queryFn: async () => unwrap(await runly.canvas.listLibraryItems(libraryId, token)) ?? [],
    enabled: Boolean(token && libraryId && enabled),
  })
}

export function useLibraryMutations() {
  const token = useToken(), client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: librariesKey })
  const create = useMutation({ mutationFn: (data) => runly.canvas.createLibrary(data, token), onSuccess: refresh })
  const update = useMutation({ mutationFn: ({ libraryId, data }) => runly.canvas.updateLibrary(libraryId, data, token), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (libraryId) => runly.canvas.deleteLibrary(libraryId, token), onSuccess: refresh })
  return { create, update, remove }
}

export function useLibraryItemMutations(libraryId) {
  const token = useToken(), client = useQueryClient()
  const refresh = () => { client.invalidateQueries({ queryKey: libraryItemsKey(libraryId) }); client.invalidateQueries({ queryKey: librariesKey }) }
  const addItems = useMutation({ mutationFn: (items) => runly.canvas.addLibraryItems(libraryId, items, token), onSuccess: refresh })
  const renameItem = useMutation({ mutationFn: ({ itemId, name }) => runly.canvas.renameLibraryItem(libraryId, itemId, { name }, token), onSuccess: refresh })
  const removeItem = useMutation({ mutationFn: (itemId) => runly.canvas.deleteLibraryItem(libraryId, itemId, token), onSuccess: refresh })
  return { addItems, renameItem, removeItem }
}

export function useLibraryImport() {
  const token = useToken(), client = useQueryClient()
  const [importing, setImporting] = useState(false)

  async function uploadToLibrary(file, libraryId) {
    const form = new FormData()
    form.append('file', file)
    form.append('moduleKey', 'runly.canvas')
    form.append('entityType', 'CanvasLibrary')
    form.append('entityId', libraryId)
    return unwrap(await runly.files.upload(form, token))
  }

  async function importExcalidrawFile(file, counts) {
    let json
    try { json = JSON.parse(await file.text()) } catch { counts.skipped += 1; return [] }
    const { items, skipped } = parseExcalidrawLibrary(json, libraryBaseName(file.name))
    counts.skipped += skipped
    const built = []
    for (const item of items) {
      if (!item.objects.length) { counts.skipped += 1; continue }
      const normalized = normalizeObjects(item.objects)
      built.push({ name: item.name, kind: 'objects', payload: normalized, width: normalized.width, height: normalized.height })
    }
    return built
  }

  async function svgItemFrom(text, name, libraryId) {
    const sanitized = sanitizeSvgText(text)
    const size = svgSize(sanitized)
    const asset = await uploadToLibrary(new File([sanitized], `${name}.svg`, { type: 'image/svg+xml' }), libraryId)
    return { name, kind: 'image', fileAssetId: asset.id, width: size.width, height: size.height }
  }

  async function importSvgFile(file, libraryId, counts) {
    try {
      return [await svgItemFrom(await file.text(), libraryBaseName(file.name), libraryId)]
    } catch {
      counts.skipped += 1
      return []
    }
  }

  async function importZipFile(file, libraryId, counts) {
    const { default: JSZip } = await import('jszip')
    let zip
    try { zip = await JSZip.loadAsync(file) } catch { counts.skipped += 1; return [] }
    const entries = Object.values(zip.files).filter((entry) => !entry.dir)
    const svgEntries = entries.filter((entry) => /\.svg$/i.test(entry.name))
    counts.skipped += entries.length - svgEntries.length
    const limited = svgEntries.slice(0, MAX_ZIP_SVGS)
    counts.skipped += svgEntries.length - limited.length
    const built = []
    for (const entry of limited) {
      try {
        const blob = await entry.async('blob')
        if (blob.size > MAX_SVG_BYTES) { counts.skipped += 1; continue }
        const name = libraryBaseName(entry.name.split('/').pop())
        built.push(await svgItemFrom(await blob.text(), name, libraryId))
      } catch { counts.skipped += 1 }
    }
    return built
  }

  // Groups files by type, uploads/parses each and adds the resulting items
  // to `targetLibraryId`, or to a freshly created library (named after the
  // first file) when none is given. Per-file failures are only counted as
  // skipped — they never abort the rest of the batch.
  async function importFiles(files, targetLibraryId = null) {
    const list = Array.from(files ?? [])
    if (!list.length) return { imported: 0, skipped: 0 }
    setImporting(true)
    let libraryId = targetLibraryId
    const counts = { imported: 0, skipped: 0 }
    const touched = new Set()
    const kinds = new Set(list.map((file) => librarySourceKind(file.name)).filter(Boolean))
    const newLibrarySource = kinds.size === 1 ? [...kinds][0] : kinds.size > 1 ? 'mixed' : 'custom'
    try {
      for (const file of list) {
        const kind = librarySourceKind(file.name)
        if (!kind) { counts.skipped += 1; continue }
        try {
          let items
          if (kind === 'excalidraw') {
            items = await importExcalidrawFile(file, counts)
            if (!items.length) continue
          }
          if (!libraryId) {
            const created = unwrap(await runly.canvas.createLibrary({ name: libraryBaseName(file.name), scope: 'PERSONAL', source: newLibrarySource }, token))
            libraryId = created.id
          }
          touched.add(libraryId)
          items ??= file.name.toLowerCase().endsWith('.zip')
              ? await importZipFile(file, libraryId, counts)
              : await importSvgFile(file, libraryId, counts)
          for (const batch of chunk(items, 200)) {
            if (!batch.length) continue
            const created = unwrap(await runly.canvas.addLibraryItems(libraryId, batch, token))
            counts.imported += (created ?? batch).length
          }
        } catch {
          counts.skipped += 1
        }
      }
    } finally {
      setImporting(false)
      client.invalidateQueries({ queryKey: librariesKey })
      for (const id of touched) client.invalidateQueries({ queryKey: libraryItemsKey(id) })
    }
    if (counts.imported) toast.success(`Se importaron ${counts.imported} elementos (${counts.skipped} omitidos)`)
    else toast.error('No se encontraron elementos compatibles. Usa .excalidrawlib, .excalidraw, SVG o ZIP con SVG.')
    return counts
  }

  return { importFiles, importing }
}
