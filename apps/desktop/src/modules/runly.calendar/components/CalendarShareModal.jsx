import { useState, useEffect, useRef } from 'react'
import { X, Trash2, UserRound, Crown } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SearchInput,
  Button,
  PersonAvatar,
} from '@runly/ui'
import { useShareCalendar, useUpdateShare, useDeleteShare, useUserSearch } from '../hooks/useCalendarData'
import { useAuth } from '../../../auth/AuthProvider'
import { toast } from 'sonner'

const ROLES = [
  { value: 'VIEWER',  label: 'Solo ver' },
  { value: 'EDITOR',  label: 'Editar eventos' },
  { value: 'MANAGER', label: 'Gestionar todo' },
]

function userLabel(u) {
  if (!u) return ''
  const name = u.displayName || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()
  return name || u.email || ''
}

function UserAvatar({ user, color, size = 'md' }) {
  return (
    <PersonAvatar
      name={userLabel(user) || '?'}
      src={user?.avatarUrl ?? null}
      size={size === 'sm' ? 'sm' : 'md'}
      className={color ? 'ring-2 ring-offset-1 ring-offset-[hsl(var(--card))]' : undefined}
      style={color ? { '--tw-ring-color': color } : undefined}
    />
  )
}

function RoleSelect({ value, onValueChange }) {
  return (
    <div className="shrink-0">
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-8 text-sm px-2.5 w-auto min-w-[130px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ROLES.map((r) => (
            <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function UserCombobox({ value, onChange, excludeIds = [] }) {
  const [inputValue, setInputValue]         = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [open, setOpen]                     = useState(false)
  const rootRef                             = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(inputValue), 250)
    return () => clearTimeout(t)
  }, [inputValue])

  useEffect(() => {
    function onPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [])

  const { data, isFetching } = useUserSearch(debouncedQuery)
  const users = (data?.data ?? []).filter((u) => !excludeIds.includes(u.id))

  function pick(user) {
    onChange(user)
    setInputValue('')
    setDebouncedQuery('')
    setOpen(false)
  }

  function clear() {
    onChange(null)
    setInputValue('')
    setDebouncedQuery('')
  }

  if (value) {
    return (
      <div className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]">
        <UserRound size={14} className="text-[hsl(var(--muted-foreground))] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{userLabel(value)}</div>
          <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{value.email}</div>
        </div>
        <button type="button" onClick={clear} className="p-0.5 rounded hover:bg-[hsl(var(--muted))] shrink-0">
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <div ref={rootRef} className="flex-1 min-w-0 relative">
      <SearchInput
        value={inputValue}
        onChange={(e) => { setInputValue(e.target.value); setOpen(true) }}
        onClear={() => { setInputValue(''); setOpen(false) }}
        onFocus={() => setOpen(true)}
        placeholder="Buscar por nombre o correo..."
      />

      {open && debouncedQuery.length >= 2 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-lg overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {isFetching ? (
              <p className="px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">Buscando...</p>
            ) : users.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-[hsl(var(--muted-foreground))]">Sin resultados</p>
            ) : (
              users.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => pick(u)}
                  className="w-full px-3 py-2 text-left hover:bg-[hsl(var(--muted))]/60 transition-colors flex items-center gap-3"
                >
                  <UserAvatar user={u} size="sm" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{userLabel(u)}</div>
                    <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{u.email}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function CalendarShareModal({ calendar, onClose }) {
  const { userProfile } = useAuth()
  const shareCalendar   = useShareCalendar()
  const updateShare     = useUpdateShare()
  const deleteShare     = useDeleteShare()
  const [selectedUser, setSelectedUser] = useState(null)
  const [role, setRole]                 = useState('VIEWER')

  const shares = calendar?.shares ?? []
  const calColor = calendar?.color || '#6B46C1'

  const excludeIds = [
    userProfile?.id,
    ...shares.map((s) => s.userId),
  ].filter(Boolean)

  async function handleAdd(e) {
    e.preventDefault()
    if (!selectedUser) { toast.error('Selecciona un usuario'); return }
    try {
      await shareCalendar.mutateAsync({ calendarId: calendar.id, userId: selectedUser.id, role })
      toast.success('Acceso compartido')
      setSelectedUser(null)
    } catch (err) {
      toast.error(err.message || 'Error al compartir')
    }
  }

  async function handleRoleChange(shareId, newRole) {
    try {
      await updateShare.mutateAsync({ calendarId: calendar.id, shareId, role: newRole })
      toast.success('Rol actualizado')
    } catch (err) {
      toast.error(err.message || 'Error al actualizar')
    }
  }

  async function handleRevoke(shareId) {
    try {
      await deleteShare.mutateAsync({ calendarId: calendar.id, shareId })
      toast.success('Acceso revocado')
    } catch (err) {
      toast.error(err.message || 'Error al revocar')
    }
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        size="lg"
        className="px-0 pt-0 pb-0 md:p-0 gap-0 flex flex-col overflow-hidden md:overflow-hidden"
      >
        {/* Header */}
        <DialogHeader className="flex-row items-start justify-between px-6 py-5 border-b border-[hsl(var(--border))] shrink-0 mb-0 space-y-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-3 h-3 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: calColor }} />
            <div className="min-w-0">
              <p className="text-xs text-[hsl(var(--muted-foreground))] uppercase tracking-wide font-medium">
                Gestionar acceso
              </p>
              <DialogTitle className="truncate">{calendar?.name}</DialogTitle>
            </div>
          </div>
        </DialogHeader>

        {/* People list — scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-1 min-h-0">
          <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
            Personas con acceso
          </p>

          {/* Owner row */}
          <div className="flex items-center gap-3 py-2">
            <UserAvatar user={userProfile} color={calColor} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                {userLabel(userProfile)}
                <span className="ml-1.5 text-[10px] font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
                  (tú)
                </span>
              </div>
              {userProfile?.email && (
                <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{userProfile.email}</div>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))] font-medium">
              <Crown size={12} className="text-amber-500" />
              Propietario
            </div>
          </div>

          {shares.length > 0 && (
            <div className="border-t border-[hsl(var(--border))]/60 pt-1 space-y-0.5">
              {shares.map((s) => {
                const shareUser = s.user ?? { email: s.userId }
                return (
                  <div key={s.id} className="flex items-center gap-3 py-2 rounded-lg hover:bg-[hsl(var(--muted))]/40 px-1 -mx-1 group transition-colors">
                    <UserAvatar user={shareUser} color={calColor} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[hsl(var(--foreground))] truncate">
                        {shareUser.firstName && shareUser.lastName
                          ? `${shareUser.firstName} ${shareUser.lastName}`
                          : userLabel(shareUser)}
                      </div>
                      {shareUser.email && (
                        <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{shareUser.email}</div>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      <RoleSelect value={s.role} onValueChange={(v) => handleRoleChange(s.id, v)} />
                      <button
                        type="button"
                        onClick={() => handleRevoke(s.id)}
                        disabled={deleteShare.isPending}
                        className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 text-[hsl(var(--muted-foreground))] hover:text-red-500 disabled:opacity-50 transition-colors"
                        title="Revocar acceso"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {shares.length === 0 && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] py-2">
              Solo tú tienes acceso a este calendario.
            </p>
          )}
        </div>

        {/* Add person section — outside scroll so the combobox dropdown is not clipped */}
        <div className="border-t border-[hsl(var(--border))] px-6 py-5 shrink-0">
          <p className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider mb-3">
            Agregar persona
          </p>
          <form onSubmit={handleAdd} className="flex gap-2 items-center">
            <UserCombobox value={selectedUser} onChange={setSelectedUser} excludeIds={excludeIds} />
            <RoleSelect value={role} onValueChange={setRole} />
            <Button
              type="submit"
              disabled={shareCalendar.isPending || !selectedUser}
              className="whitespace-nowrap shrink-0"
            >
              Invitar
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
