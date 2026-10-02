import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { bindingRefs, chunk } from '../lib/dataBindings.js'
import { applyOperations, mergeBatchResults, toServerOperations } from '../lib/optimistic.js'

function useToken() { return useAuth().session?.access_token }
const unwrap = (response) => response?.data ?? response
const boardKey = (boardId) => ['canvas', 'boards', boardId]
const objectsKey = (boardId, pageId) => ['canvas', 'boards', boardId, 'objects', pageId]
const linksKey = (boardId) => ['canvas', 'boards', boardId, 'links']

export function useBoards() {
  const token = useToken()
  return useQuery({ queryKey: ['canvas', 'boards'], queryFn: () => runly.canvas.listBoards(token), enabled: Boolean(token) })
}
export function useBoard(boardId) {
  const token = useToken()
  return useQuery({ queryKey: boardKey(boardId), queryFn: () => runly.canvas.getBoard(boardId, token), enabled: Boolean(token && boardId) })
}
export function useCanvasObjects(boardId, pageId) {
  const token = useToken()
  return useQuery({ queryKey: objectsKey(boardId, pageId), queryFn: () => runly.canvas.listObjects(boardId, { pageId }, token), enabled: Boolean(token && boardId && pageId) })
}
export function useCreateBoard() {
  const token = useToken(), client = useQueryClient()
  return useMutation({ mutationFn: (data) => runly.canvas.createBoard(data, token), onSuccess: () => client.invalidateQueries({ queryKey: ['canvas', 'boards'] }) })
}
export function useCreatePage(boardId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({ mutationFn: (data) => runly.canvas.createPage(boardId, data, token), onSuccess: () => client.invalidateQueries({ queryKey: boardKey(boardId) }) })
}
export function useUpdateLayer(boardId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, layerId, data }) => runly.canvas.updateLayer(boardId, pageId, layerId, data, token),
    onSuccess: () => client.invalidateQueries({ queryKey: boardKey(boardId), exact: true }),
  })
}

// Object batches are optimistic: the cache reflects the change immediately,
// is reconciled with the server rows on success and refetched on failure.
// Edits to an object whose create is still in flight are queued and sent as
// a follow-up update once the server id exists (`patchPending`).
export function useObjectBatch(boardId, pageId, { onCreated } = {}) {
  const token = useToken(), client = useQueryClient(), key = objectsKey(boardId, pageId)
  const queuedRef = useRef(new Map()), selfRef = useRef(null), onCreatedRef = useRef(onCreated)
  useEffect(() => { onCreatedRef.current = onCreated })
  const mutation = useMutation({
    mutationFn: (operations) => runly.canvas.batchObjects(boardId, toServerOperations(operations), token),
    onMutate: (operations) => {
      client.cancelQueries({ queryKey: key })
      client.setQueryData(key, (rows) => applyOperations(rows, operations))
    },
    onSuccess: (response) => {
      const followUps = []
      const results = (unwrap(response) ?? []).map((result) => {
        if (result.op !== 'create' || !result.object) return result
        onCreatedRef.current?.(result.clientId, result.object)
        const queued = queuedRef.current.get(result.clientId)
        if (!queued) return result
        queuedRef.current.delete(result.clientId)
        followUps.push({ op: 'update', id: result.object.id, expectedRevision: result.object.revision, data: queued })
        return { ...result, object: { ...result.object, ...queued } }
      })
      client.setQueryData(key, (rows) => mergeBatchResults(rows, results))
      const conflicts = results.filter((result) => result.op === 'conflict').length
      if (conflicts) toast.warning(conflicts === 1 ? 'Otra persona cambió un elemento; se cargó su versión más reciente.' : `Otra persona cambió ${conflicts} elementos; se cargó su versión más reciente.`)
      if (followUps.length) selfRef.current?.mutate(followUps)
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  })
  useEffect(() => { selfRef.current = mutation })
  const patchPending = useCallback((clientId, data) => {
    queuedRef.current.set(clientId, { ...(queuedRef.current.get(clientId) ?? {}), ...data })
    client.setQueryData(key, (rows = []) => rows.map((row) => row.id === clientId ? { ...row, ...data } : row))
    // key is derived from boardId/pageId, both in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, boardId, pageId])
  return { mutation, patchPending }
}

export function useCreateHotspot(boardId, pageId) {
  const token = useToken(), client = useQueryClient(), key = objectsKey(boardId, pageId)
  return useMutation({
    mutationFn: (data) => runly.canvas.createHotspot(boardId, data, token),
    onSuccess: (response) => {
      const hotspot = unwrap(response)
      client.setQueryData(key, (rows = []) => rows.map((row) => row.id === hotspot.objectId ? { ...row, hotspot } : row))
    },
  })
}
export function useUpdateHotspot(boardId, pageId) {
  const token = useToken(), client = useQueryClient(), key = objectsKey(boardId, pageId)
  return useMutation({
    mutationFn: ({ hotspotId, data }) => runly.canvas.updateHotspot(boardId, hotspotId, data, token),
    // Pin color/title changes show immediately on the canvas.
    onMutate: ({ hotspotId, data }) => {
      client.setQueryData(key, (rows = []) => rows.map((row) => row.hotspot?.id === hotspotId ? { ...row, hotspot: { ...row.hotspot, ...data } } : row))
    },
    onSuccess: (response) => {
      const hotspot = unwrap(response)
      client.setQueryData(key, (rows = []) => rows.map((row) => row.id === hotspot.objectId ? { ...row, hotspot } : row))
    },
    onError: () => client.invalidateQueries({ queryKey: key }),
  })
}

export function useEntityLinks(boardId) {
  const token = useToken()
  return useQuery({ queryKey: linksKey(boardId), queryFn: () => runly.canvas.listEntityLinks(boardId, {}, token), enabled: Boolean(token && boardId) })
}
export function useCreateEntityLink(boardId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({ mutationFn: (data) => runly.canvas.createEntityLink(boardId, data, token), onSuccess: () => client.invalidateQueries({ queryKey: linksKey(boardId) }) })
}
export function useRemoveEntityLink(boardId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({ mutationFn: (linkId) => runly.canvas.removeEntityLink(boardId, linkId, token), onSuccess: () => client.invalidateQueries({ queryKey: linksKey(boardId) }) })
}

export function useRecordSearch(type, search) {
  const token = useToken()
  return useQuery({
    queryKey: ['canvas', 'record-search', type, search],
    queryFn: () => runly.canvas.searchRecords(type, search, token),
    enabled: Boolean(token && type),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
}

// Images and PDF pages placed on a board are tagged runly.canvas/CanvasBoard
// so Files can trace them back and signed URLs are allowed for them.
export function useUploadFile(boardId) {
  const token = useToken()
  return useMutation({
    mutationFn: async (file) => {
      const form = new FormData()
      form.append('file', file)
      form.append('moduleKey', 'runly.canvas')
      form.append('entityType', 'CanvasBoard')
      if (boardId) form.append('entityId', boardId)
      return unwrap(await runly.files.upload(form, token))
    },
  })
}

// Loads image objects' files into HTMLImageElements keyed by FileAsset id.
export function useCanvasImages(objects) {
  const token = useToken()
  const fileIds = useMemo(() => [...new Set(objects.filter((row) => row.type === 'image' && row.properties?.fileId).map((row) => row.properties.fileId))].sort(), [objects])
  const urls = useQuery({
    queryKey: ['canvas', 'image-urls', fileIds],
    queryFn: async () => unwrap(await runly.files.batchSignedUrls(fileIds, token)) ?? {},
    enabled: Boolean(token && fileIds.length),
    staleTime: 30 * 60_000,
  })
  const [images, setImages] = useState(() => new Map())
  useEffect(() => {
    const entries = Object.entries(urls.data ?? {})
    if (!entries.length) return undefined
    let cancelled = false
    for (const [fileId, url] of entries) {
      if (!url) continue
      const image = new Image()
      image.onload = () => { if (!cancelled) setImages((current) => new Map(current).set(fileId, image)) }
      image.src = url
    }
    return () => { cancelled = true }
  }, [urls.data])
  return images
}

// Live data for bound objects of the visible page (polled while open).
export function useBindings(boardId, rows) {
  const token = useToken()
  const refs = useMemo(() => bindingRefs(rows), [rows])
  const keyPart = refs.map((ref) => `${ref.source}:${ref.id}`).sort().join('|')
  return useQuery({
    queryKey: ['canvas', 'boards', boardId, 'bindings', keyPart],
    queryFn: async () => {
      const parts = await Promise.all(chunk(refs, 500).map(async (batch) => unwrap(await runly.canvas.resolveBindings(boardId, batch, token)) ?? {}))
      return Object.assign({}, ...parts)
    },
    enabled: Boolean(token && boardId && refs.length),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  })
}
export function useDataSources(enabled = true) {
  const token = useToken()
  return useQuery({ queryKey: ['canvas', 'data-sources'], queryFn: async () => unwrap(await runly.canvas.listDataSources(token)) ?? [], enabled: Boolean(token && enabled), staleTime: 5 * 60_000 })
}
export function useDataSourceSearch(source, q) {
  const token = useToken()
  return useQuery({
    queryKey: ['canvas', 'data-search', source, q],
    queryFn: async () => unwrap(await runly.canvas.searchDataSource(source, q, token)) ?? [],
    enabled: Boolean(token && source), placeholderData: keepPreviousData, staleTime: 30_000,
  })
}

// ---- Sharing ----------------------------------------------------------
export function useCollaborators(boardId, enabled = true) {
  const token = useToken()
  return useQuery({
    queryKey: ['canvas', 'boards', boardId, 'collaborators'],
    queryFn: () => runly.canvas.listCollaborators(boardId, token),
    enabled: Boolean(token && boardId && enabled),
  })
}
export function useCollaboratorMutations(boardId) {
  const token = useToken(), client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId, 'collaborators'] })
  const save = useMutation({ mutationFn: ({ userId, role }) => runly.canvas.addCollaborator(boardId, { userId, role }, token), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (userId) => runly.canvas.removeCollaborator(boardId, userId, token), onSuccess: refresh })
  return { save, remove }
}

// Template catalog (static per API build).
export function useCanvasTemplates() {
  const token = useToken()
  return useQuery({
    queryKey: ['canvas', 'templates'],
    queryFn: async () => unwrap(await runly.canvas.listTemplates(token)) ?? [],
    enabled: Boolean(token),
    staleTime: Infinity,
  })
}

// Board settings are applied optimistically so the grid redraws at once.
export function useUpdateBoardSettings(boardId) {
  const token = useToken(), client = useQueryClient(), key = boardKey(boardId)
  return useMutation({
    mutationFn: (settings) => runly.canvas.updateBoard(boardId, { settings }, token),
    onMutate: (settings) => {
      client.cancelQueries({ queryKey: key, exact: true })
      const previous = client.getQueryData(key)
      client.setQueryData(key, (board) => board ? { ...board, effectiveSettings: settings } : board)
      return { previous }
    },
    onError: (_error, _settings, context) => client.setQueryData(key, context?.previous),
    onSettled: () => client.invalidateQueries({ queryKey: key, exact: true }),
  })
}

// ---- Versions ---------------------------------------------------------
const versionsKey = (boardId) => ['canvas', 'boards', boardId, 'versions']
export function useVersions(boardId, enabled = true) {
  const token = useToken()
  return useQuery({ queryKey: versionsKey(boardId), queryFn: async () => unwrap(await runly.canvas.listVersions(boardId, token)) ?? [], enabled: Boolean(token && boardId && enabled) })
}
export function useVersionMutations(boardId) {
  const token = useToken(), client = useQueryClient()
  const create = useMutation({
    mutationFn: (data) => runly.canvas.createVersion(boardId, data, token),
    onSuccess: () => { client.invalidateQueries({ queryKey: versionsKey(boardId) }); client.invalidateQueries({ queryKey: boardKey(boardId), exact: true }) },
  })
  const restore = useMutation({
    mutationFn: (versionId) => runly.canvas.restoreVersion(boardId, versionId, token),
    onSuccess: () => client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId] }),
  })
  return { create, restore }
}

// Public page path inside the SPA (honours VITE_BASE_PATH, e.g. /app/).
export function publicBoardPath(token) {
  const base = String(import.meta.env?.BASE_URL || '/').replace(/\/?$/, '/')
  return `${base}p/canvas/${token}`
}

// { list, create, revoke } in the shape @runly/ui's PublicLinksPanel expects.
export function useCanvasPublicLinksApi(boardId) {
  const token = useToken()
  return useMemo(() => {
    const withPath = (link) => ({ ...link, path: publicBoardPath(link.token) })
    return {
      list: async () => (unwrap(await runly.canvas.listPublicLinks(boardId, token)) ?? []).map(withPath),
      create: async (payload) => withPath(unwrap(await runly.canvas.createPublicLink(boardId, payload, token))),
      revoke: (linkId) => runly.canvas.revokePublicLink(boardId, linkId, token),
    }
  }, [boardId, token])
}
