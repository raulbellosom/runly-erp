import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/screens/GroupScreen.jsx
import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PageHeader, Button, EmptyState, ErrorState, ConfirmDialog, UserSearchModal,
  Sheet, SheetContent, SheetHeader, SheetTitle,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  TextField, NumberField, SelectField,
} from '@runly/ui'
import { ArrowLeft, Plus, UserPlus, Trash2, Landmark, Link2, Unlink2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

const TABS = [
  { key: 'cuentas',  label: 'Cuentas'  },
  { key: 'miembros', label: 'Miembros' },
]

const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer — solo ver' },
  { value: 'editor', label: 'Editor — ver y editar' },
  { value: 'admin',  label: 'Admin — gestionar miembros' },
]

const CURRENCY_OPTIONS = [
  { value: 'MXN', label: 'MXN — Peso mexicano' },
  { value: 'USD', label: 'USD — Dólar estadounidense' },
]

const EMPTY_ACCOUNT = { name: '', bank: '', account_number: '', currency: 'MXN', opening_balance: 0 }

export default function GroupScreen() {
  const { '*': wildcard } = useParams()
  const groupId           = useMemo(() => wildcard?.split('/')[1] ?? null, [wildcard])
  const navigate          = useNavigate()
  const { session }       = useAuth()
  const token             = session?.access_token ?? null
  const { activeCompanyId } = useActiveCompany()
  const actorId           = session?.user?.id ?? null
  const queryClient       = useQueryClient()
  const headers           = { Authorization: `Bearer ${token}` }

  const [activeTab, setActiveTab]       = useState('cuentas')
  const [inviteOpen, setInviteOpen]     = useState(false)
  const [removeTarget, setRemoveTarget] = useState(null)

  // Asignar cuenta Sheet
  const [assignOpen, setAssignOpen]         = useState(false)
  const [assignTarget, setAssignTarget]     = useState(null)
  const [assigning, setAssigning]           = useState(false)

  const [renameOpen, setRenameOpen]   = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameSaving, setRenameSaving] = useState(false)

  // Quitar cuenta Confirm
  const [unassignTarget, setUnassignTarget] = useState(null)

  // Nueva cuenta Sheet
  const [newAccOpen, setNewAccOpen]   = useState(false)
  const [accForm, setAccForm]         = useState(EMPTY_ACCOUNT)
  const [accSaving, setAccSaving]     = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ledger-group', groupId],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/groups/${groupId}`, { headers })
      if (!res.ok) throw new Error('No se pudo cargar el grupo.')
      return res.json()
    },
    enabled: !!groupId && !!token,
  })

  // Fetch own accounts only when assign sheet is open
  const { data: allAccountsData } = useQuery({
    queryKey: ['ledger-accounts', token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/accounts`, { headers })
      if (!res.ok) return { data: [] }
      return res.json()
    },
    enabled: !!token && assignOpen,
  })

  const group    = data?.data ?? null
  const members  = group?.members ?? []
  const accounts = group?.accounts ?? []
  const myRole   = group?.role ?? null

  // Own accounts not yet assigned to any group
  const assignableAccounts = (allAccountsData?.data ?? []).filter(
    (a) => a.group_id == null || a.group_id === undefined || a.group_id === ''
  )

  async function handleInvite(userId, role) {
    const res = await companyFetch(`${API_BASE}/ledger/groups/${groupId}/members`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? 'No se pudo invitar al miembro.')
      return
    }
    toast.success('Miembro invitado.')
    queryClient.invalidateQueries({ queryKey: ['ledger-group', groupId] })
  }

  async function handleRemoveMember(targetUserId) {
    const res = await companyFetch(`${API_BASE}/ledger/groups/${groupId}/members/${targetUserId}`, {
      method: 'DELETE',
      headers,
    })
    if (!res.ok) { toast.error('No se pudo remover al miembro.'); return }
    toast.success('Miembro removido.')
    setRemoveTarget(null)
    queryClient.invalidateQueries({ queryKey: ['ledger-group', groupId] })
  }

  async function handleAssignAccount() {
    if (!assignTarget) return
    setAssigning(true)
    try {
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${assignTarget.id}/group`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'No se pudo asignar la cuenta.')
        return
      }
      toast.success(`Cuenta "${assignTarget.name}" asignada al grupo.`)
      setAssignOpen(false)
      setAssignTarget(null)
      queryClient.invalidateQueries({ queryKey: ['ledger-group', groupId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
    } finally {
      setAssigning(false)
    }
  }

  async function handleUnassignAccount(account) {
    const res = await companyFetch(`${API_BASE}/ledger/accounts/${account.id}/group`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: null }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast.error(err.error ?? 'No se pudo quitar la cuenta del grupo.')
      return
    }
    toast.success(`Cuenta "${account.name}" quitada del grupo.`)
    setUnassignTarget(null)
    queryClient.invalidateQueries({ queryKey: ['ledger-group', groupId] })
    queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
    queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
  }

  async function handleCreateAccount(e) {
    e.preventDefault()
    if (!accForm.name.trim() || !accForm.bank.trim()) return
    setAccSaving(true)
    try {
      const res = await companyFetch(`${API_BASE}/ledger/accounts`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: accForm.name.trim(),
          bank: accForm.bank.trim(),
          account_number: accForm.account_number.trim() || null,
          currency: accForm.currency,
          opening_balance: Number(accForm.opening_balance) || 0,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'No se pudo crear la cuenta.')
        return
      }
      const created = await res.json()
      // Assign to this group immediately
      await companyFetch(`${API_BASE}/ledger/accounts/${created.data.id}/group`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: groupId }),
      })
      toast.success('Cuenta creada y asignada al grupo.')
      setAccForm(EMPTY_ACCOUNT)
      setNewAccOpen(false)
      queryClient.invalidateQueries({ queryKey: ['ledger-group', groupId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
    } finally {
      setAccSaving(false)
    }
  }

  async function handleRename(e) {
    e.preventDefault()
    if (!renameValue.trim()) return
    setRenameSaving(true)
    try {
      const res = await companyFetch(`${API_BASE}/ledger/groups/${groupId}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameValue.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'No se pudo renombrar el grupo.')
        return
      }
      toast.success('Grupo renombrado.')
      setRenameOpen(false)
      queryClient.invalidateQueries({ queryKey: ['ledger-group', groupId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
    } finally {
      setRenameSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-3">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />)}
      </div>
    )
  }

  if (isError || !group) return <ErrorState description="No se pudo cargar el grupo." onRetry={refetch} />

  const canWrite = myRole === 'editor' || myRole === 'admin'

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5">
        <button
          onClick={() => navigate('/app/m/runly.ledger/accounts')}
          className="flex items-center gap-1 text-sm text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] mb-3 transition-colors"
        >
          <ArrowLeft size={14} /> Cuentas
        </button>
        <PageHeader
          eyebrow="Runly Ledger"
          title={group.name}
          description={`${members.length} miembro${members.length !== 1 ? 's' : ''} · ${accounts.length} cuenta${accounts.length !== 1 ? 's' : ''}`}
          actions={
            <div className="flex flex-wrap gap-2">
              {myRole === 'admin' && (
                <Button variant="outline" size="sm" onClick={() => { setRenameValue(group.name); setRenameOpen(true) }}>
                  <Pencil size={14} className="mr-1" /> Renombrar
                </Button>
              )}
              {activeTab === 'cuentas' && canWrite && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                    <Link2 size={14} className="mr-1" /> Asignar cuenta
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setNewAccOpen(true)}>
                    <Plus size={14} className="mr-1" /> Nueva cuenta
                  </Button>
                </>
              )}
              {activeTab === 'miembros' && myRole === 'admin' && (
                <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>
                  <UserPlus size={14} className="mr-1" /> Invitar
                </Button>
              )}
            </div>
          }
        />

        <div className="flex gap-1 mt-4 border-b border-[hsl(var(--border))]">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={[
                'px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === tab.key
                  ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                  : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
        {activeTab === 'cuentas' && (
          accounts.length === 0
            ? (
              <EmptyState
                icon={Landmark}
                title="Sin cuentas"
                description="Este grupo no tiene cuentas todavía."
              >
                {canWrite && (
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)}>
                      <Link2 size={14} className="mr-1" /> Asignar cuenta existente
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => setNewAccOpen(true)}>
                      <Plus size={14} className="mr-1" /> Nueva cuenta
                    </Button>
                  </div>
                )}
              </EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {accounts.map((account) => (
                  <div key={account.id} className="relative group/card">
                    <button
                      onClick={() => navigate(`/app/m/runly.ledger/accounts/${account.id}`)}
                      className="w-full text-left p-4 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--ring))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors"
                    >
                      <div className="font-semibold text-sm truncate pr-8">{account.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{account.bank}</div>
                      <div className="mt-2 font-mono text-sm font-semibold">
                        {Number(account.current_balance ?? 0).toLocaleString('es-MX', {
                          style: 'currency', currency: account.currency ?? 'MXN', minimumFractionDigits: 2,
                        })}
                      </div>
                    </button>
                    {account.owner_id === actorId && (
                      <button
                        onClick={() => setUnassignTarget(account)}
                        title="Quitar del grupo"
                        className="absolute top-3 right-3 opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100 transition-opacity p-1 rounded hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]"
                      >
                        <Unlink2 size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
        )}

        {activeTab === 'miembros' && (
          members.length === 0
            ? <EmptyState icon={UserPlus} title="Sin miembros" description="El grupo no tiene miembros activos." />
            : (
              <div className="space-y-2 max-w-xl">
                {members.map((m) => (
                  <div key={m.id} className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">{m.display_name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">
                        {m.email} · <span className="capitalize">{m.role}</span>
                      </div>
                    </div>
                    {myRole === 'admin' && (
                      <Button variant="ghost" size="icon" onClick={() => setRemoveTarget(m)}>
                        <Trash2 size={14} />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )
        )}
      </div>

      {/* Asignar cuenta Sheet */}
      <Sheet open={assignOpen} onOpenChange={(v) => { if (!v) { setAssignOpen(false); setAssignTarget(null) } }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Asignar cuenta al grupo</SheetTitle>
          </SheetHeader>
          <div className="pt-4 space-y-3">
            {assignableAccounts.length === 0 ? (
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                No tienes cuentas personales disponibles para asignar. Todas tus cuentas ya pertenecen a un grupo o no tienes ninguna.
              </p>
            ) : (
              <>
                <p className="text-sm text-[hsl(var(--muted-foreground))] mb-2">Selecciona una de tus cuentas para agregarla a este grupo:</p>
                <div className="space-y-2">
                  {assignableAccounts.map((acc) => (
                    <button
                      key={acc.id}
                      onClick={() => setAssignTarget(acc)}
                      className={[
                        'w-full text-left p-3 rounded-lg border transition-colors',
                        assignTarget?.id === acc.id
                          ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.05)]'
                          : 'border-[hsl(var(--border))] hover:border-[hsl(var(--ring))]',
                      ].join(' ')}
                    >
                      <div className="font-medium text-sm">{acc.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))]">{acc.bank} · {acc.currency}</div>
                      <div className="text-xs font-mono mt-0.5">
                        {Number(acc.current_balance ?? 0).toLocaleString('es-MX', {
                          style: 'currency', currency: acc.currency ?? 'MXN', minimumFractionDigits: 2,
                        })}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" size="sm" onClick={() => { setAssignOpen(false); setAssignTarget(null) }}>Cancelar</Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={!assignTarget || assigning}
                    onClick={handleAssignAccount}
                  >
                    {assigning ? 'Asignando...' : 'Asignar'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Nueva cuenta Sheet */}
      <Sheet open={newAccOpen} onOpenChange={(v) => { if (!v) { setNewAccOpen(false); setAccForm(EMPTY_ACCOUNT) } }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Nueva cuenta en {group.name}</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleCreateAccount} className="space-y-4 pt-4">
            <TextField
              label="Nombre"
              id="acc-name"
              required
              value={accForm.name}
              onChange={(e) => setAccForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ej. Cuenta operativa BBVA"
              maxLength={255}
            />
            <TextField
              label="Banco"
              id="acc-bank"
              required
              value={accForm.bank}
              onChange={(e) => setAccForm((f) => ({ ...f, bank: e.target.value }))}
              placeholder="Ej. BBVA"
              maxLength={255}
            />
            <TextField
              label="Número de cuenta"
              id="acc-number"
              value={accForm.account_number}
              onChange={(e) => setAccForm((f) => ({ ...f, account_number: e.target.value }))}
              placeholder="Opcional"
              maxLength={64}
            />
            <SelectField
              label="Moneda"
              id="acc-currency"
              options={CURRENCY_OPTIONS}
              value={accForm.currency}
              onValueChange={(v) => setAccForm((f) => ({ ...f, currency: v }))}
            />
            <NumberField
              label="Saldo inicial"
              id="acc-balance"
              value={accForm.opening_balance}
              onChange={(e) => setAccForm((f) => ({ ...f, opening_balance: e.target.value }))}
              placeholder="0.00"
              min={0}
              step="0.01"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setNewAccOpen(false); setAccForm(EMPTY_ACCOUNT) }}>Cancelar</Button>
              <Button type="submit" variant="primary" size="sm" disabled={accSaving || !accForm.name.trim() || !accForm.bank.trim()}>
                {accSaving ? 'Guardando...' : 'Crear cuenta'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <UserSearchModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onConfirm={handleInvite}
        roles={ROLE_OPTIONS}
        excludeIds={members.map((m) => m.user_id)}
        apiBase={API_BASE}
        token={token}
        companyId={activeCompanyId}
      />

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(v) => { if (!v) setRemoveTarget(null) }}
        onConfirm={() => handleRemoveMember(removeTarget?.user_id)}
        title="Remover miembro"
        description={`¿Remover a ${removeTarget?.display_name} del grupo?`}
        confirmLabel="Remover"
      />

      <ConfirmDialog
        open={!!unassignTarget}
        onOpenChange={(v) => { if (!v) setUnassignTarget(null) }}
        onConfirm={() => handleUnassignAccount(unassignTarget)}
        title="Quitar cuenta del grupo"
        description={`¿Quitar "${unassignTarget?.name}" de este grupo? La cuenta quedará como personal sin grupo.`}
        confirmLabel="Quitar"
      />

      <Dialog open={renameOpen} onOpenChange={(v) => { if (!v) setRenameOpen(false) }}>
        <DialogContent size="sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Renombrar grupo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRename} className="space-y-4 pt-2">
            <TextField
              label="Nombre del grupo"
              id="rename-grp"
              required
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
              maxLength={128}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenameOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={renameSaving || !renameValue.trim()}>
                {renameSaving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
