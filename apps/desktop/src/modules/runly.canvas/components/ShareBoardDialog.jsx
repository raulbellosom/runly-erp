import { useState } from 'react'
import {
  Badge, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, PublicLinksPanel, SelectField,
  Tabs, TabsContent, TabsList, TabsTrigger, UserSearchModal,
} from '@runly/ui'
import { Globe, Loader2, Lock, UserPlus, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider.jsx'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useCanvasPublicLinksApi, useCollaboratorMutations, useCollaborators } from '../hooks/useCanvasData.js'
import { ASSIGNABLE_ROLES, BOARD_ROLES, roleLabel } from '../lib/roles.js'

const ROLE_OPTIONS = ASSIGNABLE_ROLES.map((role) => ({ value: role, label: BOARD_ROLES[role].label, description: BOARD_ROLES[role].description }))
const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?'

function PeopleTab({ boardId, isOwner, myUserId }) {
  const { session } = useAuth(), { activeCompanyId } = useActiveCompany()
  const people = useCollaborators(boardId)
  const { save, remove } = useCollaboratorMutations(boardId)
  const [adding, setAdding] = useState(false)
  const rows = people.data ?? []

  const changeRole = (userId, role) => save.mutate({ userId, role }, {
    onSuccess: () => toast.success(`Rol actualizado a ${roleLabel(role)}`),
    onError: (error) => toast.error(error.message),
  })
  const removePerson = (person) => remove.mutate(person.userId, {
    onSuccess: () => toast.success(`${person.name} ya no tiene acceso`),
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="space-y-4">
      {isOwner ? (
        <Button type="button" className="w-full" onClick={() => setAdding(true)}><UserPlus />Agregar personas</Button>
      ) : (
        <p className="flex items-start gap-2 rounded-lg bg-[hsl(var(--muted)/0.6)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />Solo el propietario del Board puede dar o quitar accesos.
        </p>
      )}

      {people.isLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[hsl(var(--muted-foreground))]" /></div>
      ) : people.isError ? (
        <p className="text-sm text-destructive">{people.error?.message ?? 'No se pudo cargar la lista de personas.'}</p>
      ) : (
        <ul className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">
          {rows.map((person) => {
            const editable = isOwner && person.role !== 'OWNER'
            return (
              <li key={person.userId} className="flex flex-wrap items-center gap-3 p-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--muted))] text-xs font-semibold" aria-hidden>{initials(person.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{person.name}{person.userId === myUserId ? <span className="font-normal text-[hsl(var(--muted-foreground))]"> (tú)</span> : null}</p>
                  {person.email ? <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{person.email}</p> : null}
                </div>
                {editable ? (
                  <div className="flex items-center gap-1">
                    <SelectField
                      aria-label={`Rol de ${person.name}`}
                      options={ROLE_OPTIONS}
                      value={person.role}
                      onValueChange={(role) => role && role !== person.role && changeRole(person.userId, role)}
                      className="h-9 w-40"
                    />
                    <Button type="button" size="icon" variant="ghost" aria-label={`Quitar acceso a ${person.name}`} title="Quitar acceso" onClick={() => removePerson(person)} disabled={remove.isPending} className="h-9 w-9 hover:text-destructive">
                      <X />
                    </Button>
                  </div>
                ) : (
                  <Badge variant={person.role === 'OWNER' ? 'default' : 'outline'}>{roleLabel(person.role)}</Badge>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <dl className="grid gap-2 text-xs">
        {Object.entries(BOARD_ROLES).map(([role, meta]) => (
          <div key={role} className="flex gap-2">
            <dt className="w-24 shrink-0 font-semibold">{meta.label}</dt>
            <dd className="text-[hsl(var(--muted-foreground))]">{meta.description}</dd>
          </div>
        ))}
      </dl>

      <UserSearchModal
        open={adding}
        onClose={() => setAdding(false)}
        onConfirm={(userId, role) => save.mutate({ userId, role }, {
          onSuccess: () => toast.success('Acceso concedido'),
          onError: (error) => toast.error(error.message),
        })}
        roles={ROLE_OPTIONS.map(({ value, label }) => ({ value, label: `${label} — ${BOARD_ROLES[value].description}` }))}
        excludeIds={rows.map((person) => person.userId)}
        apiBase={getApiUrl()}
        token={session?.access_token}
        companyId={activeCompanyId}
      />
    </div>
  )
}

function PublicTab({ boardId, isOwner }) {
  const api = useCanvasPublicLinksApi(boardId)
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-[hsl(var(--muted)/0.6)] p-3 text-sm">
        <p className="font-medium">Solo visualización</p>
        <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
          Cualquiera con el enlace, aunque no tenga cuenta en Runly, puede recorrer el Board, hacer zoom, cambiar de página y abrir los hotspots
          (título, descripción, estado e icono). No puede editar nada ni ver archivos adjuntos, registros vinculados, capas ocultas o quién colabora.
        </p>
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
      <DialogContent className="flex max-h-[min(92dvh,760px)] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 border-b border-[hsl(var(--border))] px-5 py-4">
          <DialogTitle>Compartir Board</DialogTitle>
          <DialogDescription className="truncate">{boardName} · Tu acceso: {roleLabel(myRole)}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="people" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-5 mt-4 grid shrink-0 grid-cols-2">
            <TabsTrigger value="people" className="gap-1.5"><Users className="h-4 w-4" />Personas</TabsTrigger>
            <TabsTrigger value="public" className="gap-1.5"><Globe className="h-4 w-4" />Enlace público</TabsTrigger>
          </TabsList>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
            <TabsContent value="people" className="mt-0"><PeopleTab boardId={boardId} isOwner={isOwner} myUserId={userProfile?.id} /></TabsContent>
            <TabsContent value="public" className="mt-0"><PublicTab boardId={boardId} isOwner={isOwner} /></TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
