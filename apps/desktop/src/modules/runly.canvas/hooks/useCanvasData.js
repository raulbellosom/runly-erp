import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { applyOperations, mergeBatchResults } from '../lib/optimistic.js'

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
export function useObjectBatch(boardId, pageId) {
  const token = useToken(), client = useQueryClient(), key = objectsKey(boardId, pageId)
  return useMutation({
    mutationFn: (operations) => runly.canvas.batchObjects(boardId, operations, token),
    onMutate: (operations) => {
      client.cancelQueries({ queryKey: key })
      client.setQueryData(key, (rows) => applyOperations(rows, operations))
    },
    onSuccess: (response) => client.setQueryData(key, (rows) => mergeBatchResults(rows, unwrap(response) ?? [])),
    onError: () => client.invalidateQueries({ queryKey: key }),
  })
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
    onSuccess: (response) => {
      const hotspot = unwrap(response)
      client.setQueryData(key, (rows = []) => rows.map((row) => row.id === hotspot.objectId ? { ...row, hotspot } : row))
    },
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

export function useAttachments(boardId, targetType, targetId) {
  const token = useToken()
  return useQuery({
    queryKey: ['canvas', 'boards', boardId, 'attachments', targetType, targetId],
    queryFn: () => runly.canvas.listAttachments(boardId, { targetType, targetId }, token),
    enabled: Boolean(token && boardId && targetId),
  })
}
export function useAttachmentMutations(boardId, targetType, targetId) {
  const token = useToken(), client = useQueryClient()
  const refresh = () => client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId, 'attachments', targetType, targetId] })
  const add = useMutation({
    mutationFn: async (file) => {
      const form = new FormData()
      form.append('file', file)
      const asset = unwrap(await runly.files.upload(form, token))
      return runly.canvas.addAttachment(boardId, { targetType, targetId, fileAssetId: asset.id, label: file.name }, token)
    },
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (attachmentId) => runly.canvas.removeAttachment(boardId, attachmentId, token), onSuccess: refresh })
  return { add, remove }
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

export function useUploadFile() {
  const token = useToken()
  return useMutation({
    mutationFn: async (file) => {
      const form = new FormData()
      form.append('file', file)
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
