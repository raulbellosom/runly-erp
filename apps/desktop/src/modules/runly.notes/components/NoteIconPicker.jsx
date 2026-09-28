import { X } from 'lucide-react'
import { ThemedEmojiPicker } from '@runly/ui'

// Shared Popover content for picking a note icon — a real emoji, matching
// Notion/Apple Notes convention. Stored as the emoji character itself in
// note.icon (see noteIcons.jsx — NoteIcon renders it literally). The old
// curated Lucide icon set is gone from the picker, but NOTE_ICONS in
// noteIcons.jsx still renders any icon name a note already has, so existing
// notes aren't affected.
export function NoteIconPickerContent({ value, onChange }) {
  return (
    <>
      <ThemedEmojiPicker
        onEmojiClick={emojiData => onChange(emojiData.emoji)}
        width="min(300px, calc(100vw - 1.5rem))"
        height={360}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="mt-2.5 w-full flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-1 py-1.5 rounded hover:bg-muted transition-colors"
        >
          <X className="w-3 h-3" />
          Sin icono
        </button>
      )}
    </>
  )
}
