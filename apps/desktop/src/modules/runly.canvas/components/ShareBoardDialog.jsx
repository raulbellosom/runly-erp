import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, PublicLinksPanel, SearchInput, SelectField,
  Tabs, TabsContent, TabsList, TabsTrigger, cn,
} from '@runly/ui'
import { Crown, Eye, Globe, Info, Loader2, Lock, MessageSquare, Pencil, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { runly } from '../../../lib/runly.js'
import { useCanvasPublicLinksApi, useCollaboratorMutations, useCollaborators } from '../hooks/useCanvasData.js'
import { ASSIGNABLE_ROLES, BOARD_ROLES, roleLabel } from '../lib/roles.js'

const ROLE_ICONS = { OWNER: Crown, EDITOR: Pencil, COMMENTER: MessageSquare, VIEWER: Eye }
// Explicit light/dark pairs so role chips never render as bare white text.
const ROLE_TONES = {
  OWNER: 'bg-amber-100 text-amber-900 ring-amber-300 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-400/30',
  EDITOR: 'bg-sky-100 text-sky-900 ring-sky-300 dark:bg-sky-400/15 dark:text-sky-200 dark:ring-sky-400/30',
  COMMENTER: 'bg-violet-100 text-violet-900 ring-violet-300 dark:bg-violet-400/15 dark:text-violet-200 dark:ring-violet-400/30',
  VIEWER: 'bg-slate-100 text-slate-800 ring-slate-300 dark:bg-slate-400/15 dark:text-slate-200 dark:ring-slate-400/30',
}
const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({ value: role, label: BOARD_ROLES[role].label, icon: ROLE_ICONS[role] }))
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

function RoleBadge({ role }) {
  const Icon = ROLE_ICONS[role] ?? Eye
  return (
    <span className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset', ROLE_TONES[role] ?? ROLE_TONES.VIEWER)}>
      <Icon className="h-3.5 w-3.5" />{roleLabel(role)}
    </span>
  )
}

function Avatar({ name, url }) {
  return url
    ? <img src={url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
    : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-xs font-semibold text-[hsl(var(--foreground))]" aria-hidden>{initials(name)}</span>
}

function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => { const handle = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(handle) }, [value, delay])
  return debounced
}

// Inline "add people": only members whose role includes canvas.view are
// listed (the API would reject anyone else), several can be picked at once.
function AddPeople({ boardId, existingIds, onDone }) {
  const { session } = useAuth()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Map())
  const [role, setRole] = useState('VIEWER')
  const [saving, setSaving] = useState(false)
  const term = useDebounced(search.trim())
  const { save } = useCollaboratorMutations(boardId)
  const candidates = useQuery({
    queryKey: ['canvas', 'share-candidates', term],
    queryFn: async () => {
      const response = await runly.identity.listCandidates(session?.access_token, { action: 'canvas', search: term || undefined, pageSize: 30 })
      return response?.data ?? response ?? []
    },
    enabled: Boolean(session?.access_token),
    staleTime: 30_000,
  })
  const rows = (candidates.data ?? []).filter((user) => !existingIds.has(user.id))
  const toggle = (user) => setPicked((current) => { const next = new Map(current); if (next.has(user.id)) next.delete(user.id); else next.set(user.id, user); return next })

  async function submit() {
    setSaving(true)
    const people = [...picked.values()]
    const results = await Promise.allSettled(people.map((user) => save.mutateAsync({ userId: user.id, role })))
    setSaving(false)
    const failed = results.filter((result) => result.status === 'rejected')
    if (failed.length) toast.error(failed[0].reason?.message ?? 'No se pudo compartir con algunas personas.')
    const done = people.length - failed.length
    if (done) { toast.success(done === 1 ? `Acceso concedido como ${roleLabel(role)}` : `${done} personas agregadas como ${roleLabel(role)}`); onDone() }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Agregar personas</h3>
        <Button type="button" size="icon" variant="ghost" aria-label="Cerrar" onClick={onDone} className="h-9 w-9"><X /></Button>
      </div>
      <SearchInput value={search} onChange={(event) => setSearch(event.target.value)} onClear={() => setSearch('')} placeholder="Buscar por nombre o correo…" />

      <div className="max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
        {candidates.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground))]" /></div>
        ) : rows.length ? (
          <ul className="divide-y divide-[hsl(var(--border))]">
            {rows.map((user) => {
              const name = user.displayName || `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'Usuario'
              const checked = picked.has(user.id)
              return (
                <li key={user.id}>
                  <label className={cn('flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 transition-colors hover:bg-[hsl(var(--muted)/0.6)]', checked && 'bg-primary/5')}>
                    <Checkbox checked={checked} onCheckedChange={() => toggle(user)} aria-label={`Seleccionar a ${name}`} />
                    <Avatar name={name} url={user.avatarUrl} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="flex gap-2 p-4 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {term ? `Nadie coincide con «${term}». ` : 'No hay más personas disponibles. '}
              Solo aparecen miembros activos de la empresa cuyo rol incluye el permiso <strong className="text-[hsl(var(--foreground))]">Ver Boards</strong> de Canvas.
              Un administrador puede asignarlo en Identidad &gt; Roles.
            </p>
          </div>
        )}
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium">Rol que tendrán</legend>
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-3">
          {ASSIGNABLE_ROLES.map((value) => {
            const Icon = ROLE_ICONS[value], active = role === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setRole(value)}
                className={cn(
                  'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]',
                  active ? 'border-primary bg-primary/8' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:bg-[hsl(var(--muted)/0.6)]',
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold"><Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-[hsl(var(--muted-foreground))]')} />{BOARD_ROLES[value].label}</span>
                <span className="text-xs leading-snug text-[hsl(var(--muted-foreground))]">{BOARD_ROLES[value].description}</span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone}>Cancelar</Button>
        <Button type="button" onClick={submit} disabled={!picked.size || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <UserPlus />}
          {picked.size > 1 ? `Agregar ${picked.size} personas` : 'Agregar persona'}
        </Button>
      </div>
    </div>
  )
}

function PeopleTab({ boardId, isOwner, myUserId }) {
  const people = useCollaborators(boardId)
  const { save, remove } = useCollaboratorMutations(boardId)
  const [adding, setAdding] = useState(false)
  const rows = people.data ?? []

  const changeRole = (person, role) => save.mutate({ userId: person.userId, role }, {
    onSuccess: () => toast.success(`${person.name} ahora es ${roleLabel(role)}`),
    onError: (error) => toast.error(error.message),
  })
  const removePerson = (person) => remove.mutate(person.userId, {
    onSuccess: () => toast.success(`${person.name} ya no tiene acceso`),
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="space-y-4">
      {isOwner ? (
        adding
          ? <AddPeople boardId={boardId} existingIds={new Set(rows.map((person) => person.userId))} onDone={() => setAdding(false)} />
          : <Button type="button" className="w-full sm:w-auto" onClick={() => setAdding(true)}><UserPlus />Agregar personas</Button>
      ) : (
        <p className="flex items-start gap-2 rounded-lg bg-[hsl(var(--muted)/0.6)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />Solo el propietario del Board puede dar o quitar accesos.
        </p>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Con acceso ({rows.length})</h3>
        {people.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground))]" /></div>
        ) : people.isError ? (
          <p className="text-sm text-destructive">{people.error?.message ?? 'No se pudo cargar la lista de personas.'}</p>
        ) : (
          <ul className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
            {rows.map((person) => {
              const editable = isOwner && person.role !== 'OWNER'
              return (
                <li key={person.userId} className="flex flex-wrap items-center gap-3 p-3">
                  <Avatar name={person.name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{person.name}{person.userId === myUserId ? <span className="font-normal text-[hsl(var(--muted-foreground))]"> (tú)</span> : null}</p>
                    {person.email ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{person.email}</p> : null}
                  </div>
                  {editable ? (
                    <div className="flex w-full items-center gap-1 sm:w-auto">
                      <SelectField
                        aria-label={`Rol de ${person.name}`}
                        options={ROLE_OPTIONS}
                        value={person.role}
                        onValueChange={(role) => role && role !== person.role && changeRole(person, role)}
                        className="h-10 flex-1 sm:w-44 sm:flex-none"
                      />
                      <Button type="button" size="icon" variant="ghost" aria-label={`Quitar acceso a ${person.name}`} title="Quitar acceso" onClick={() => removePerson(person)} disabled={remove.isPending} className="h-10 w-10 shrink-0 hover:text-destructive">
                        <X />
                      </Button>
                    </div>
                  ) : <RoleBadge role={person.role} />}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-xl bg-[hsl(var(--muted)/0.5)] p-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-[hsl(var(--muted-foreground))]">Qué puede hacer cada rol</h3>
        <dl className="grid gap-2 sm:grid-cols-2">
          {Object.keys(BOARD_ROLES).map((role) => (
            <div key={role} className="flex items-start gap-2">
              <dt><RoleBadge role={role} /></dt>
              <dd className="pt-1 text-xs leading-snug text-[hsl(var(--muted-foreground))]">{BOARD_ROLES[role].description}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  )
}

function PublicTab({ boardId, isOwner }) {
  const api = useCanvasPublicLinksApi(boardId)
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-xl bg-[hsl(var(--muted)/0.6)] p-3">
        <Eye className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))]" />
        <div>
          <p className="text-sm font-medium">Solo visualización, sin cuenta</p>
          <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
            Quien tenga el enlace puede recorrer el Board, hacer zoom, cambiar de página y tocar los hotspots para ver su título, descripción, estado e icono.
            No puede editar nada ni ver archivos adjuntos, registros vinculados, capas ocultas o colaboradores.
          </p>
        </div>
      </div>
      {isOwner ? (
        <PublicLinksPanel api={api} resource="board.view" recordId={boardId} title="Enlaces del Board" />
      ) : (
        <p className="flex items-start gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />Solo el propietario puede crear o revocar enlaces públicos.</p>
      )}
    </div>
  )
}

export function ShareBoardDialog({ open, onOpenChange, boardId, boardName, myRole }) {
  const { userProfile } = useAuth()
  const isOwner = myRole === 'OWNER'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(94dvh,860px)] w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4 sm:px-6">
          <DialogTitle>Compartir Board</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <span className="truncate">{boardName}</span><span aria-hidden>·</span><span>Tu acceso:</span><RoleBadge role={myRole} />
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="people" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-4 grid shrink-0 grid-cols-2 sm:mx-6">
            <TabsTrigger value="people" className="gap-1.5"><Users className="h-4 w-4" />Personas</TabsTrigger>
            <TabsTrigger value="public" className="gap-1.5"><Globe className="h-4 w-4" />Enlace público</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6 sm:py-5">
            <TabsContent value="people" className="mt-0"><PeopleTab boardId={boardId} isOwner={isOwner} myUserId={userProfile?.id} /></TabsContent>
            <TabsContent value="public" className="mt-0"><PublicTab boardId={boardId} isOwner={isOwner} /></TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
