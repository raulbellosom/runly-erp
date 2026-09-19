import { DARK_BG_MAP } from '../lib/noteColors.js'

// Shared "sheet" column rendered inside NoteEditor — used by both the
// authenticated editor (NotesScreen) and the public share view
// (PublicNoteScreen) so a note's content area is always the same width and
// background treatment regardless of where it's rendered.
export const NOTE_SHEET_MAX_WIDTH_CLASS = 'max-w-3xl mx-auto'

export function NoteSheet({ note, isDark = false, zoom = 100, children }) {
  const raw = note?.background_color ?? null
  const backgroundColor = raw ? (isDark ? (DARK_BG_MAP[raw] ?? raw) : raw) : undefined

  return (
    <div
      className={`${NOTE_SHEET_MAX_WIDTH_CLASS} min-h-full bg-card note-sheet`}
      style={{ zoom: `${zoom}%`, ...(backgroundColor ? { backgroundColor } : {}) }}
    >
      {children}
    </div>
  )
}
