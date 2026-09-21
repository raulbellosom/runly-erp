import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Popover, PopoverTrigger, PopoverContent } from '@runly/ui'
import { AssigneeAvatar } from './AssigneeChip'

function getDisplayName(u) {
  return [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || '—'
}

/**
 * User picker dropdown with avatar, full name, and email.
 * Props:
 *   label        - optional field label
 *   users        - array of user objects { id, firstName, lastName, email?, avatarUrl? }
 *   value        - currently selected userId (controlled)
 *   onChange     - called with userId when a user is selected
 *   placeholder  - trigger placeholder when nothing is selected
 *   emptyMessage - message shown when filter has no results
 *   autoFocus    - open the dropdown immediately on mount
 *   onBlur       - called when the dropdown closes (outside click, escape, or selection)
 *   compact      - smaller trigger height (for inline pickers like SubtaskRow)
 */
export function UserPickerDropdown({
  label,
  users = [],
  value = '',
  onChange,
  placeholder = 'Buscar usuario...',
  emptyMessage = 'Sin usuarios disponibles',
  autoFocus = false,
  onBlur,
  compact = false,
}) {
  const [open, setOpen] = useState(autoFocus)
  const [query, setQuery] = useState('')
  const inputRef = useRef(null)

  const selected = value ? users.find((u) => u.id === value) : null

  const filtered = query.trim()
    ? users.filter((u) => {
        const q = query.toLowerCase()
        return getDisplayName(u).toLowerCase().includes(q) || u?.email?.toLowerCase().includes(q)
      })
    : users

  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  function handleOpenChange(next) {
    setOpen(next)
    if (!next) onBlur?.()
  }

  function handleSelect(uid) {
    onChange(uid)
    setOpen(false)
    onBlur?.()
  }

  const triggerPadding = compact ? 'px-2 py-1' : 'px-3 py-2'

  return (
    <div className="w-full">
      {label && (
        <label className="text-sm font-medium mb-1.5 block">{label}</label>
      )}

      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`w-full flex items-center gap-2 ${triggerPadding} rounded-md border border-border bg-background text-sm text-left hover:bg-muted/50 transition-colors`}
          >
            {selected ? (
              <>
                <AssigneeAvatar user={selected} size="sm" />
                <div className="flex-1 min-w-0 flex items-baseline gap-1.5 overflow-hidden">
                  <span className="text-sm truncate shrink-0 max-w-[60%]">{getDisplayName(selected)}</span>
                  {selected.email && (
                    <span className="text-xs text-muted-foreground truncate">({selected.email})</span>
                  )}
                </div>
              </>
            ) : (
              <span className="text-muted-foreground flex-1 text-sm">{placeholder}</span>
            )}
            <ChevronDown
              size={14}
              className={`text-muted-foreground shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="p-0 w-(--radix-popover-trigger-width) overflow-hidden"
          onOpenAutoFocus={(e) => { e.preventDefault(); inputRef.current?.focus() }}
        >
          {/* Search bar */}
          <div className="p-2 border-b border-border">
            <div className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5">
              <Search size={13} className="text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre o correo..."
                className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground min-w-0"
              />
            </div>
          </div>

          {/* Results */}
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-5 text-sm text-muted-foreground text-center">{emptyMessage}</div>
            ) : (
              filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => handleSelect(u.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted text-left transition-colors"
                >
                  <AssigneeAvatar user={u} size="md" />
                  <div className="flex-1 min-w-0 flex items-baseline gap-1.5 overflow-hidden">
                    <span className="text-sm font-medium truncate shrink-0 max-w-[55%]">{getDisplayName(u)}</span>
                    {u.email && (
                      <span className="text-xs text-muted-foreground truncate">({u.email})</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
