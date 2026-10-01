import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'

function useToken() { return useAuth().session?.access_token }

export function useBoards() {
  const token = useToken()
  return useQuery({ queryKey: ['canvas', 'boards'], queryFn: () => runly.canvas.listBoards(token), enabled: Boolean(token) })
}
export function useBoard(boardId) {
  const token = useToken()
  return useQuery({ queryKey: ['canvas', 'boards', boardId], queryFn: () => runly.canvas.getBoard(boardId, token), enabled: Boolean(token && boardId) })
}
export function useCanvasObjects(boardId, pageId) {
  const token = useToken()
  return useQuery({ queryKey: ['canvas', 'boards', boardId, 'objects', pageId], queryFn: () => runly.canvas.listObjects(boardId, { pageId }, token), enabled: Boolean(token && boardId && pageId) })
}
export function useCreateBoard() {
  const token = useToken(), client = useQueryClient()
  return useMutation({ mutationFn: (data) => runly.canvas.createBoard(data, token), onSuccess: () => client.invalidateQueries({ queryKey: ['canvas', 'boards'] }) })
}
export function useCreatePage(boardId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({ mutationFn: (data) => runly.canvas.createPage(boardId, data, token), onSuccess: () => client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId] }) })
}
export function useUpdateLayer(boardId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({
    mutationFn: ({ pageId, layerId, data }) => runly.canvas.updateLayer(boardId, pageId, layerId, data, token),
    onSuccess: () => client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId] }),
  })
}
export function useObjectBatch(boardId, pageId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({
    mutationFn: (operations) => runly.canvas.batchObjects(boardId, operations, token),
    onSuccess: () => client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId, 'objects', pageId] }),
  })
}
export function useCreateHotspot(boardId, pageId) {
  const token = useToken(), client = useQueryClient()
  return useMutation({
    mutationFn: (data) => runly.canvas.createHotspot(boardId, data, token),
    onSuccess: () => client.invalidateQueries({ queryKey: ['canvas', 'boards', boardId, 'objects', pageId] }),
  })
}

