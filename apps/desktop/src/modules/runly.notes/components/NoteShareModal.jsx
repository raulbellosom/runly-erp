import { useState, useEffect, useRef } from 'react'
import { Search, X, Check, UserPlus, Shield, Users, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Avatar,
  AvatarImage,
  AvatarFallback,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@runly/ui'
import { NoteIcon } from '../noteIcons.jsx'
import { useNoteShares, useShareNote, useUpdateNoteShare, useRevokeNoteShare } from '../hooks/useNoteShares.js'
import { runly } from '../../../lib/runly'
import { useAuth } from '../../../auth/AuthProvider'
import { ResourceInvitationControl } from '../../../company/ResourceInvitationControl.jsx'

const PERMISSION_OPTIONS = [
  { value: 'read', label: 'Solo lectura' },
  { value: 'edit', label: 'Puede editar' },
]

function UserAvatar({ name, avatarUrl, className = 'h-9 w-9' }) {
  const initial = (name ?? '?').trim()[0]?.toUpperCase() ?? '?'
  return (
    <Avatar className={className}>
      {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
      <AvatarFallback className="bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200 text-sm font-semibold">
        {initial}
      </AvatarFallback>
    </Avatar>
  )
}

function PermissionSelect({ value, onChange, disabled }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="h-9 w-40 shrink-0 bg-[hsl(var(--background))]! text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSION_OPTIONS.map(o => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
      {children}
    </p>
  )
}

export function NoteShareModal({ note, noteId, open, onOpenChange }) {
  const id = note?.id ?? noteId
  const { session } = useAuth()
  const token = session?.access_token
  const { data, isLoading: sharesLoading } = useNoteShares(id)
  const shareNote = useShareNote()
  const updateShare = useUpdateNoteShare()
  const revokeShare = useRevokeNoteShare()

  const [query, setQuery] = useState('')
  const [userList, setUserList] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [permission, setPermission] = useState('read')
  const searchRef = useRef(null)
  const debounceRef = useRef(null)

  const shares = data?.shares ?? []
  const sharedIds = new Set(shares.map(s => s.shared_with_user_id))

  // Picker is limited to users with notes-module access (see
  // GET /notes/shareable-users), not every company user.
  async function loadShareable(search) {
    if (!token) return
    try {
      const res = await runly.notes.listShareableUsers(search || null, token)
      setUserList((res?.users ?? []).filter(u => !sharedIds.has(u.id)))
    } catch (_) {
      setUserList([])
    }
  }

  useEffect(() => {
    if (!open || !token) return
    const t = setTimeout(() => searchRef.current?.focus(), 80)
    loadShareable(null)
    return () => clearTimeout(t)
  }, [open, token, shares.length])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (!query.trim() || query.length < 2) {
      if (!query.trim()) loadShareable(null)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true)
      await loadShareable(query.trim())
      setSearching(false)
    }, 280)
    return () => clearTimeout(debounceRef.current)
  }, [query, token])

  function handleShare() {
    if (!selectedUser) return
    shareNote.mutate(
      { noteId: id, targetUserId: selectedUser.id, permission },
      {
        onSuccess: () => {
          setSelectedUser(null)
          setQuery('')
          setPermission('read')
        },
      },
    )
  }

  const isSuggestions = query.trim().length < 2

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Opaque surface: this modal floats over the note editor, which can show
          a full-bleed cover image + a colored background. The app-wide
          `glass-strong` surface (translucent, especially ~15% in explicit dark
          mode) let all of that bleed through and made the content unreadable.
          Force a solid card surface here; keep the shared radius / shadow /
          animation from the primitive. */}
      <DialogContent
        size="lg"
        mobileVariant="center"
        className="bg-[hsl(var(--card))]! border border-[hsl(var(--border))]"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {note?.icon
              ? <NoteIcon name={note.icon} size={16} className="shrink-0 text-amber-500" />
              : <Users className="h-4 w-4 shrink-0 text-amber-500" />}
            Compartir nota
          </DialogTitle>
          {note?.title && (
            <DialogDescription className="truncate">{note.title}</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4">

          {/* ── Search ── */}
          <div className="flex h-11 items-center gap-2 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 transition-colors focus-within:border-amber-400 focus-within:ring-2 focus-within:ring-amber-400/30">
            <Search className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={e => { setQuery(e.target.value); setSelectedUser(null) }}
              placeholder="Buscar por nombre o correo..."
              className="min-w-0 flex-1 bg-transparent text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none"
            />
            {searching && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-500" />}
            {query && !searching && (
              <button
                type="button"
                onClick={() => { setQuery(''); setSelectedUser(null) }}
                aria-label="Limpiar busqueda"
                className="shrink-0 rounded-md p-0.5 text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* ── Results ── */}
          <div className="flex flex-col gap-2">
            <SectionLabel>{isSuggestions ? 'Sugerencias' : 'Resultados'}</SectionLabel>
            <div className="max-h-56 overflow-y-auto overscroll-contain rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))]">
              {userList.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
                  <Users className="h-8 w-8 text-[hsl(var(--muted-foreground))] opacity-40" />
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {isSuggestions ? 'Cargando usuarios...' : `Sin resultados para "${query.trim()}"`}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-[hsl(var(--border))]">
                  {userList.map(user => {
                    const fullName = user.displayName || user.email
                    const isSelected = selectedUser?.id === user.id
                    return (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedUser(prev => (prev?.id === user.id ? null : user))}
                          aria-pressed={isSelected}
                          className={[
                            'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                            isSelected
                              ? 'bg-amber-500/10 dark:bg-amber-400/10'
                              : 'hover:bg-[hsl(var(--muted))]',
                          ].join(' ')}
                        >
                          <UserAvatar name={fullName} avatarUrl={user.avatarUrl} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium leading-tight text-[hsl(var(--foreground))]">{fullName}</p>
                            <p className="truncate text-xs leading-tight text-[hsl(var(--muted-foreground))]">{user.email}</p>
                          </div>
                          {isSelected && <Check className="h-4 w-4 shrink-0 text-amber-500" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>

          {/* ── Selected user → pick permission + add ── */}
          {selectedUser && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
              <UserAvatar
                name={selectedUser.displayName || selectedUser.email}
                avatarUrl={selectedUser.avatarUrl}
                className="h-8 w-8"
              />
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-[hsl(var(--foreground))]">
                {selectedUser.displayName || selectedUser.email}
              </p>
              <PermissionSelect value={permission} onChange={setPermission} disabled={shareNote.isPending} />
              <button
                type="button"
                onClick={handleShare}
                disabled={shareNote.isPending}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-xs font-semibold text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
              >
                {shareNote.isPending
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <UserPlus className="h-3.5 w-3.5" />}
                Agregar
              </button>
            </div>
          )}

          {/* ── Current access ── */}
          <div className="flex flex-col gap-2 border-t border-[hsl(var(--border))] pt-4">
            <SectionLabel>Personas con acceso</SectionLabel>

            {sharesLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-[hsl(var(--muted-foreground))]">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                Cargando...
              </div>
            ) : shares.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center">
                <Shield className="h-8 w-8 text-[hsl(var(--muted-foreground))] opacity-40" />
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Solo tu tienes acceso a esta nota
                </p>
              </div>
            ) : (
              <ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
                {shares.map(share => {
                  const name = share.display_name ?? share.user_email ?? '?'
                  const busy = revokeShare.isPending || updateShare.isPending
                  return (
                    <li
                      key={share.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-2 py-2 transition-colors hover:bg-[hsl(var(--muted))]"
                    >
                      <UserAvatar name={name} avatarUrl={share.avatar_url ?? null} className="h-8 w-8" />
                      <div className="min-w-36 flex-1">
                        <p className="truncate text-sm font-medium leading-tight text-[hsl(var(--foreground))]">{name}</p>
                        {share.user_email && (
                          <p className="truncate text-xs leading-tight text-[hsl(var(--muted-foreground))]">{share.user_email}</p>
                        )}
                      </div>
                      <div className="ml-auto flex items-center gap-2">
                        <PermissionSelect
                          value={share.permission}
                          disabled={busy}
                          onChange={val => updateShare.mutate({ noteId: id, shareId: share.id, permission: val })}
                        />
                        <button
                          type="button"
                          onClick={() => revokeShare.mutate({ noteId: id, shareId: share.id })}
                          disabled={busy}
                          aria-label={`Revocar acceso de ${name}`}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

        </div>
        <ResourceInvitationControl resourceType="note" resourceId={id} />
      </DialogContent>
    </Dialog>
  )
}
