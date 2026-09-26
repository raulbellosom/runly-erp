import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/screens/MembershipsScreen.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, EmptyState, ErrorState, ConfirmDialog, Button, Card } from '@runly/ui'
import { LogOut, FolderOpen, Landmark, Check, X, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { LedgerStatStrip } from '../components/LedgerStatCard.jsx'

const API_BASE = getApiUrl()

export default function MembershipsScreen() {
  const navigate    = useNavigate()
  const { session } = useAuth()
  const token       = session?.access_token ?? null
  const queryClient = useQueryClient()
  const headers     = { Authorization: `Bearer ${token}` }

  const [leaveGroup, setLeaveGroup]     = useState(null)
  const [leaveAccount, setLeaveAccount] = useState(null)
  const [busyId, setBusyId]             = useState(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ledger-memberships', token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/memberships`, { headers })
      if (!res.ok) throw new Error('No se pudieron cargar las membresias.')
      return res.json()
    },
    enabled: !!token,
  })

  const allGroups   = data?.data?.groups   ?? []
  const allAccounts = data?.data?.accounts ?? []

  const pendingGroups   = allGroups.filter((g) => g.status === 'pending')
  const pendingAccounts = allAccounts.filter((a) => a.status === 'pending')
  const groups          = allGroups.filter((g) => g.status !== 'pending')
  const accounts        = allAccounts.filter((a) => a.status !== 'pending')

  async function confirmLeaveGroup() {
    const res = await companyFetch(`${API_BASE}/ledger/memberships/groups/${leaveGroup.id}`, {
      method: 'DELETE', headers,
    })
    if (!res.ok) { toast.error('No se pudo salir del grupo.'); return }
    toast.success(`Saliste del grupo "${leaveGroup.name}".`)
    setLeaveGroup(null)
    queryClient.invalidateQueries({ queryKey: ['ledger-memberships'] })
    queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
  }

  async function confirmLeaveAccount() {
    const res = await companyFetch(`${API_BASE}/ledger/memberships/accounts/${leaveAccount.id}`, {
      method: 'DELETE', headers,
    })
    if (!res.ok) { toast.error('No se pudo salir de la cuenta compartida.'); return }
    toast.success(`Saliste de la cuenta "${leaveAccount.name}".`)
    setLeaveAccount(null)
    queryClient.invalidateQueries({ queryKey: ['ledger-memberships'] })
    queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
  }

  async function respondInvitation(kind, id, action) {
    setBusyId(`${kind}-${id}-${action}`)
    try {
      const res = await companyFetch(
        `${API_BASE}/ledger/invitations/${kind}/${id}/${action}`,
        { method: 'POST', headers },
      )
      if (!res.ok) throw new Error()
      toast.success(action === 'accept' ? 'Invitación aceptada.' : 'Invitación rechazada.')
      queryClient.invalidateQueries({ queryKey: ['ledger-memberships'] })
      queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
      queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
    } catch {
      toast.error(action === 'accept' ? 'No se pudo aceptar la invitación.' : 'No se pudo rechazar la invitación.')
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />)}
      </div>
    )
  }

  if (isError) return <ErrorState description="No se pudieron cargar las membresias." onRetry={refetch} />

  const hasPending = pendingGroups.length > 0 || pendingAccounts.length > 0
  const isEmpty = !hasPending && groups.length === 0 && accounts.length === 0

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5">
        <PageHeader
          eyebrow="Runly Ledger"
          title="Mis membresías"
          description="Grupos y cuentas a los que fuiste invitado."
        />

        {!isEmpty && (
          <LedgerStatStrip
            className="mb-2 max-w-2xl"
            items={[
              { key: 'pending', label: 'Pendientes', value: pendingGroups.length + pendingAccounts.length, icon: Clock, tone: 'destructive' },
              { key: 'groups', label: 'Grupos', value: groups.length, icon: FolderOpen, tone: 'amber' },
              { key: 'accounts', label: 'Cuentas compartidas', value: accounts.length, icon: Landmark, tone: 'violet' },
            ]}
          />
        )}
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 pt-4 space-y-8 max-w-2xl">
        {isEmpty && (
          <EmptyState
            icon={LogOut}
            title="Sin membresías"
            description="No tienes membresías activas en grupos ni cuentas compartidas."
          />
        )}

        {hasPending && (
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Clock size={14} /> Pendientes
            </h3>
            <div className="space-y-2">
              {pendingGroups.map((g) => (
                <Card key={`pending-group-${g.id}`} variant="solid" className="rounded-xl flex items-center justify-between px-3 py-2 border-amber-500/30">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--brand-soft) text-(--brand-primary)">
                      <FolderOpen size={14} />
                    </span>
                    <span className="min-w-0">
                      <div className="text-sm font-medium truncate">{g.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        Invitación de {g.invited_by_name ?? 'un administrador'} · rol <span className="capitalize">{g.role}</span>
                      </div>
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => respondInvitation('groups', g.id, 'accept')}
                      disabled={busyId === `groups-${g.id}-accept`}
                    >
                      <Check size={13} className="mr-1" /> Aceptar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => respondInvitation('groups', g.id, 'reject')}
                      disabled={busyId === `groups-${g.id}-reject`}
                    >
                      <X size={13} className="mr-1" /> Rechazar
                    </Button>
                  </span>
                </Card>
              ))}
              {pendingAccounts.map((a) => (
                <Card key={`pending-account-${a.id}`} variant="solid" className="rounded-xl flex items-center justify-between px-3 py-2 border-amber-500/30">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                      <Landmark size={14} />
                    </span>
                    <span className="min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        Invitación de {a.invited_by_name ?? a.owner_name ?? 'el propietario'} · rol <span className="capitalize">{a.role}</span>
                      </div>
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 shrink-0">
                    <Button
                      size="sm"
                      onClick={() => respondInvitation('accounts', a.id, 'accept')}
                      disabled={busyId === `accounts-${a.id}-accept`}
                    >
                      <Check size={13} className="mr-1" /> Aceptar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => respondInvitation('accounts', a.id, 'reject')}
                      disabled={busyId === `accounts-${a.id}-reject`}
                    >
                      <X size={13} className="mr-1" /> Rechazar
                    </Button>
                  </span>
                </Card>
              ))}
            </div>
          </section>
        )}

        {groups.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <FolderOpen size={14} /> Grupos
            </h3>
            <div className="space-y-2">
              {groups.map((g) => (
                <Card key={g.id} variant="solid" className="rounded-xl flex items-center justify-between px-3 py-2">
                  <button className="flex items-center gap-3 text-left min-w-0" onClick={() => navigate(`/app/m/runly.ledger/groups/${g.id}`)}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--brand-soft) text-(--brand-primary)">
                      <FolderOpen size={14} />
                    </span>
                    <span className="min-w-0">
                      <div className="text-sm font-medium truncate">{g.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] capitalize">
                        {g.role} · {g.member_count} miembro{Number(g.member_count) !== 1 ? 's' : ''}
                      </div>
                    </span>
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => setLeaveGroup(g)}>
                    <LogOut size={14} className="mr-1" /> Salir
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        )}

        {accounts.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Landmark size={14} /> Cuentas compartidas
            </h3>
            <div className="space-y-2">
              {accounts.map((a) => (
                <Card key={a.id} variant="solid" className="rounded-xl flex items-center justify-between px-3 py-2">
                  <button className="flex items-center gap-3 text-left min-w-0" onClick={() => navigate(`/app/m/runly.ledger/accounts/${a.id}`)}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                      <Landmark size={14} />
                    </span>
                    <span className="min-w-0">
                      <div className="text-sm font-medium truncate">{a.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">
                        {a.bank} · <span className="capitalize">{a.role}</span> · Propietario: {a.owner_name}
                      </div>
                    </span>
                  </button>
                  <Button variant="ghost" size="sm" onClick={() => setLeaveAccount(a)}>
                    <LogOut size={14} className="mr-1" /> Salir
                  </Button>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={!!leaveGroup}
        onOpenChange={(v) => { if (!v) setLeaveGroup(null) }}
        onConfirm={confirmLeaveGroup}
        title="Salir del grupo"
        description={`¿Estás seguro de que quieres salir del grupo "${leaveGroup?.name}"?`}
        confirmLabel="Salir"
      />

      <ConfirmDialog
        open={!!leaveAccount}
        onOpenChange={(v) => { if (!v) setLeaveAccount(null) }}
        onConfirm={confirmLeaveAccount}
        title="Salir de la cuenta compartida"
        description={`¿Estás seguro de que quieres salir de la cuenta "${leaveAccount?.name}"?`}
        confirmLabel="Salir"
      />
    </div>
  )
}
