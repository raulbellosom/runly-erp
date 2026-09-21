import { useState } from 'react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
  Button, Badge, SelectField, ConfirmDialog,
} from '@runly/ui'
import { UserMinus } from 'lucide-react'
import { toast } from 'sonner'
import {
  useProjectMembers, useAddMember, useRemoveMember, useWorkspaceUsers,
} from '../hooks/useProjectsData'
import { AssigneeAvatar } from '../lib/AssigneeChip'
import { UserPickerDropdown } from '../lib/UserPickerDropdown'

const ROLE_OPTIONS = [
  { value: 'MEMBER', label: 'Miembro' },
  { value: 'VIEWER', label: 'Solo lectura' },
]

const ROLE_BADGE = {
  OWNER:  { label: 'Owner',         variant: 'default' },
  MEMBER: { label: 'Miembro',       variant: 'secondary' },
  VIEWER: { label: 'Solo lectura',  variant: 'outline' },
}

function memberDisplayName(user) {
  if (!user) return 'Usuario desconocido'
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || user.id
}

export default function MembersPanel({ open, onOpenChange, projectId }) {
  const { data: membersData } = useProjectMembers(projectId)
  const { data: usersData } = useWorkspaceUsers()
  const addMember = useAddMember(projectId)
  const removeMember = useRemoveMember(projectId)

  const members = membersData?.data ?? membersData ?? []
  const allUsers = usersData?.data ?? usersData ?? []

  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole] = useState('MEMBER')
  const [removeTarget, setRemoveTarget] = useState(null)

  const memberUserIds = new Set(members.map((m) => m.userId))
  const availableUsers = allUsers.filter((u) => !memberUserIds.has(u.id))

  function handleAdd() {
    if (!selectedUserId) return
    addMember.mutate(
      { userId: selectedUserId, role: selectedRole },
      {
        onSuccess: () => {
          toast.success('Miembro agregado')
          setSelectedUserId('')
          setSelectedRole('MEMBER')
        },
        onError: (err) => {
          const msg = err?.message?.includes('ya es miembro')
            ? 'Este usuario ya es miembro del proyecto.'
            : 'No se pudo agregar el miembro'
          toast.error(msg)
        },
      },
    )
  }

  function handleRemove() {
    if (!removeTarget) return
    removeMember.mutate(removeTarget.userId, {
      onSuccess: () => { toast.success('Miembro eliminado'); setRemoveTarget(null) },
      onError: () => toast.error('No se pudo eliminar el miembro'),
    })
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-full sm:max-w-md flex flex-col gap-0 p-0">
          <SheetHeader className="px-6 py-4 border-b border-border">
            <SheetTitle>Miembros del proyecto</SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {/* Current members list */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Miembros ({members.length})
              </p>
              <div className="space-y-2">
                {members.map((m) => {
                  const badge = ROLE_BADGE[m.role] ?? ROLE_BADGE.MEMBER
                  return (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 py-2 group"
                    >
                      <AssigneeAvatar user={m.user} size="lg" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{memberDisplayName(m.user)}</p>
                      </div>
                      <Badge variant={badge.variant} className="text-[10px]">
                        {badge.label}
                      </Badge>
                      {m.role !== 'OWNER' && (
                        <button
                          onClick={() => setRemoveTarget(m)}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                          title="Eliminar miembro"
                        >
                          <UserMinus size={14} />
                        </button>
                      )}
                    </div>
                  )
                })}
                {members.length === 0 && (
                  <p className="text-sm text-muted-foreground py-2">Sin miembros todavia.</p>
                )}
              </div>
            </div>

            {/* Add member */}
            <div className="border-t border-border pt-5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
                Agregar miembro
              </p>
              <div className="space-y-3">
                <UserPickerDropdown
                  label="Usuario"
                  users={availableUsers}
                  value={selectedUserId}
                  onChange={setSelectedUserId}
                  placeholder="Buscar usuario..."
                  emptyMessage="No hay usuarios disponibles"
                />
                <SelectField
                  label="Rol"
                  value={selectedRole}
                  onValueChange={setSelectedRole}
                  options={ROLE_OPTIONS}
                />
                <Button
                  className="w-full"
                  onClick={handleAdd}
                  disabled={!selectedUserId || addMember.isPending}
                >
                  Agregar
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={Boolean(removeTarget)}
        onOpenChange={(v) => { if (!v) setRemoveTarget(null) }}
        title="Eliminar miembro"
        description={`Se eliminara a "${memberDisplayName(removeTarget?.user)}" del proyecto.`}
        confirmLabel="Eliminar"
        onConfirm={handleRemove}
      />
    </>
  )
}
