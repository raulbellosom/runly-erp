// Optimistic note updates: patch every cached copy of a note (the detail
// query ['notes', id] and each list query ['notes', params]) right away, so
// the list, the header and the editor reflect a title/icon/meta change before
// the server round trip (and the refetch that follows) completes.
const CAMEL_TO_SNAKE = {
  backgroundColor: 'background_color',
  folderId: 'folder_id',
  isPinned: 'is_pinned',
  isArchived: 'is_archived',
  coverUrl: 'cover_url',
  paperStyle: 'paper_style',
  paperMargin: 'paper_margin',
  paperTexture: 'paper_texture',
  paperShadow: 'paper_shadow',
  showPublicCollaborators: 'show_public_collaborators',
  contentText: 'content_text',
}

// API patch (camelCase) -> note row fields (snake_case), as the list and
// detail endpoints return them.
export function toNoteRowPatch(patch) {
  const row = {}
  for (const [key, value] of Object.entries(patch)) row[CAMEL_TO_SNAKE[key] ?? key] = value
  return row
}

export function patchNoteInCache(queryClient, noteId, patch) {
  if (!noteId) return
  const row = toNoteRowPatch(patch)
  queryClient.setQueriesData({ queryKey: ['notes'] }, (data) => {
    if (!data || typeof data !== 'object') return data
    if (data.note?.id === noteId) return { ...data, note: { ...data.note, ...row } }
    if (Array.isArray(data.notes) && data.notes.some((note) => note.id === noteId)) {
      return { ...data, notes: data.notes.map((note) => (note.id === noteId ? { ...note, ...row } : note)) }
    }
    return data
  })
}
