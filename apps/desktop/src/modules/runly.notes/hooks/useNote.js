import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { runly } from '../../../lib/runly'

function useToken() {
  const { session } = useAuth()
  return session?.access_token
}

export function useNote(noteId) {
  const token = useToken()
  return useQuery({
    queryKey: ['notes', noteId],
    queryFn: () => runly.notes.get(noteId, token),
    enabled: Boolean(token) && Boolean(noteId),
  })
}

export function useUpdateNote() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ noteId, data }) => runly.notes.update(noteId, data, token),
    onSuccess: (_, { noteId }) => {
      qc.invalidateQueries({ queryKey: ['notes', noteId] })
      qc.invalidateQueries({ queryKey: ['notes'] })
    },
  })
}

export function useTrashNote() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId) => runly.notes.trash(noteId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  })
}

// A collaborator drops a note shared with them (the note itself stays intact).
export function useLeaveNote() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId) => runly.notes.leave(noteId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  })
}

export function isNoteOwner(note, userId) {
  if (!note) return false
  if (typeof note.is_owner === 'boolean') return note.is_owner
  return Boolean(userId) && note.owner_user_id === userId
}

export function useRestoreNote() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId) => runly.notes.restore(noteId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  })
}

export function usePermanentDeleteNote() {
  const token = useToken()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (noteId) => runly.notes.permanentDelete(noteId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notes'] }),
  })
}
