import { X } from 'lucide-react'
import { IconLibraryPanel } from '@runly/ui'

// Shared Popover content for picking a note icon from the app-wide lucide
// library (@runly/ui IconLibraryPanel). Stored as the kebab-case lucide name
// in note.icon; NoteIcon (noteIcons.jsx) still renders the older values a
// note may already have (PascalCase keys from the first icon set, or a
// literal emoji).
export function NoteIconPickerContent({ value, onChange }) {
  return (
    <div className="max-w-[calc(100vw-1.5rem)]">
      <IconLibraryPanel value={value} onChoose={onChange} gridClassName="max-h-72" />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="mt-2.5 w-full flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-1 py-1.5 rounded hover:bg-muted transition-colors"
        >
          <X className="w-3 h-3" />
          Sin icono
        </button>
      )}
    </div>
  )
}
