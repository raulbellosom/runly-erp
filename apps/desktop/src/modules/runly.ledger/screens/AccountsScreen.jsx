// apps/desktop/src/modules/runly.ledger/screens/AccountsScreen.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PageHeader, Button, EmptyState, ErrorState,
  Sheet, SheetContent, SheetHeader, SheetTitle,
  Dialog, DialogContent, DialogHeader, DialogTitle,
  TextField, NumberField, SelectField,
} from '@runly/ui'
import { useOfflineStatus } from '@runly/offline'
import { Plus, Landmark, Users, FolderOpen, Pencil, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useAccountList, useLedgerSQLite } from '../hooks/use-ledger-queries.js'

const API_BASE = getApiUrl()

const CURRENCY_OPTIONS = [
  { value: 'MXN', label: 'MXN — Peso mexicano' },
  { value: 'USD', label: 'USD — Dólar estadounidense' },
]

const TABS = [
  { key: 'own', label: 'Mis cuentas', icon: Landmark },
  { key: 'shared', label: 'Compartidas conmigo', icon: Users },
  { key: 'groups', label: 'Grupos', icon: FolderOpen },
]

const EMPTY_ACCOUNT = { name: '', bank: '', account_number: '', currency: 'MXN', opening_balance: 0 }

export default function AccountsScreen() {
  const navigate = useNavigate()
  const { session } = useAuth()
  const token = session?.access_token ?? null
  const queryClient = useQueryClient()
  const { isOnline } = useOfflineStatus()
  const { isUsingLocalLedger } = useLedgerSQLite()
  const [activeTab, setActiveTab] = useState('own')

  const [newAccOpen, setNewAccOpen] = useState(false)
  const [accForm, setAccForm] = useState(EMPTY_ACCOUNT)
  const [accSaving, setAccSaving] = useState(false)

  const [newGrpOpen, setNewGrpOpen] = useState(false)
  const [newGrpName, setNewGrpName] = useState('')
  const [grpSaving, setGrpSaving] = useState(false)

  const [editAccount, setEditAccount] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', bank: '', account_number: '', currency: 'MXN' })
  const [editSaving, setEditSaving] = useState(false)

  const [renameGroup, setRenameGroup] = useState(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')
  const [renameGroupSaving, setRenameGroupSaving] = useState(false)

  const headers = { Authorization: `Bearer ${token}` }
  const { data: allData, isLoading: allLoading, isError: allError, refetch: refetchAccounts } = useAccountList()

  const { data: membershipData, isLoading: mbLoading } = useQuery({
    queryKey: ['ledger-memberships', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/ledger/memberships`, { headers })
      if (!res.ok) return { data: { groups: [], accounts: [] } }
      return res.json()
    },
    enabled: !!token && isOnline,
  })

  const { data: groupsData, isLoading: grpLoading } = useQuery({
    queryKey: ['ledger-groups', token],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/ledger/groups`, { headers })
      if (!res.ok) return { data: [] }
      return res.json()
    },
    enabled: !!token && isOnline,
  })

  const offlineLedgerView = isUsingLocalLedger
  const tabs = offlineLedgerView
    ? [{ key: 'offline', label: 'Disponibles offline', icon: Landmark }]
    : TABS
  const effectiveTab = offlineLedgerView ? 'offline' : activeTab

  const ownAccounts = (allData?.data ?? []).filter((account) => account.group_id == null)
  const sharedAccounts = membershipData?.data?.accounts ?? []
  const groups = groupsData?.data ?? []
  const offlineAccounts = allData?.data ?? []

  const isLoading = allLoading || mbLoading || grpLoading

  async function handleCreateAccount(event) {
    event.preventDefault()
    if (!accForm.name.trim() || !accForm.bank.trim()) return

    setAccSaving(true)
    try {
      const res = await fetch(`${API_BASE}/ledger/accounts`, {
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

      toast.success('Cuenta creada.')
      setAccForm(EMPTY_ACCOUNT)
      setNewAccOpen(false)
      queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
    } finally {
      setAccSaving(false)
    }
  }

  async function handleCreateGroup(event) {
    event.preventDefault()
    if (!newGrpName.trim()) return

    setGrpSaving(true)
    try {
      const res = await fetch(`${API_BASE}/ledger/groups`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newGrpName.trim() }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'No se pudo crear el grupo.')
        return
      }

      toast.success('Grupo creado.')
      setNewGrpName('')
      setNewGrpOpen(false)
      queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
    } finally {
      setGrpSaving(false)
    }
  }

  function openRenameGroup(group) {
    setRenameGroupValue(group.name ?? '')
    setRenameGroup(group)
  }

  async function handleRenameGroup(e) {
    e.preventDefault()
    if (!renameGroupValue.trim()) return
    setRenameGroupSaving(true)
    try {
      const res = await fetch(`${API_BASE}/ledger/groups/${renameGroup.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameGroupValue.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'No se pudo renombrar el grupo.')
        return
      }
      toast.success('Grupo renombrado.')
      setRenameGroup(null)
      queryClient.invalidateQueries({ queryKey: ['ledger-groups'] })
    } finally {
      setRenameGroupSaving(false)
    }
  }

  function openEdit(account) {
    setEditForm({
      name: account.name ?? '',
      bank: account.bank ?? '',
      account_number: account.account_number ?? '',
      currency: account.currency ?? 'MXN',
    })
    setEditAccount(account)
  }

  async function handleEditAccount(e) {
    e.preventDefault()
    if (!editForm.name.trim() || !editForm.bank.trim()) return
    setEditSaving(true)
    try {
      const res = await fetch(`${API_BASE}/ledger/accounts/${editAccount.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          bank: editForm.bank.trim(),
          account_number: editForm.account_number.trim() || null,
          currency: editForm.currency,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? 'No se pudo actualizar la cuenta.')
        return
      }
      toast.success('Cuenta actualizada.')
      setEditAccount(null)
      queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
    } finally {
      setEditSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
        ))}
      </div>
    )
  }

  if (allError) {
    return <ErrorState title="No se pudieron cargar las cuentas." onRetry={refetchAccounts} />
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5">
        <PageHeader
          eyebrow="Runly Ledger"
          title="Cuentas bancarias"
          description="Registro de saldos y movimientos por cuenta bancaria."
          actions={
            offlineLedgerView
              ? null
              : effectiveTab !== 'groups'
                ? (
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => navigate('/app/m/runly.ledger/import-ai')}>
                        <Sparkles size={14} className="mr-1" /> Importar con IA
                      </Button>
                      <Button variant="primary" size="sm" onClick={() => setNewAccOpen(true)}>
                        <Plus size={14} className="mr-1" /> Nueva cuenta
                      </Button>
                    </div>
                  )
                : (
                    <Button variant="primary" size="sm" onClick={() => setNewGrpOpen(true)}>
                      <Plus size={14} className="mr-1" /> Nuevo grupo
                    </Button>
                  )
          }
        />

        <div className="flex gap-1 mt-4 border-b border-[hsl(var(--border))]">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={[
                  'flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  effectiveTab === tab.key
                    ? 'border-[hsl(var(--primary))] text-[hsl(var(--primary))]'
                    : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
                ].join(' ')}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
        {offlineLedgerView && (
          <div className="mb-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.25)] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
            Mostrando la cache local de ledger. La separación por compartidas y grupos vuelve al reconectar.
          </div>
        )}

        {effectiveTab === 'offline' && (
          offlineAccounts.length === 0
            ? <EmptyState icon={Landmark} title="Sin cuentas en cache" description="Sincroniza ledger mientras estés conectado para consultarlo offline después." />
            : <AccountGrid accounts={offlineAccounts} onSelect={(id) => navigate(`/app/m/runly.ledger/accounts/${id}`)} />
        )}

        {effectiveTab === 'own' && (
          ownAccounts.length === 0
            ? <EmptyState icon={Landmark} title="Sin cuentas personales" description="Crea una cuenta para registrar tus movimientos." action={{ label: 'Nueva cuenta', onClick: () => setNewAccOpen(true) }} />
            : <AccountGrid accounts={ownAccounts} onSelect={(id) => navigate(`/app/m/runly.ledger/accounts/${id}`)} onEdit={openEdit} />
        )}

        {effectiveTab === 'shared' && (
          sharedAccounts.length === 0
            ? <EmptyState icon={Users} title="Sin cuentas compartidas" description="Nadie ha compartido cuentas contigo todavía." />
            : <AccountGrid accounts={sharedAccounts} onSelect={(id) => navigate(`/app/m/runly.ledger/accounts/${id}`)} />
        )}

        {effectiveTab === 'groups' && (
          groups.length === 0
            ? <EmptyState icon={FolderOpen} title="Sin grupos" description="No perteneces a ningún grupo todavía." action={{ label: 'Nuevo grupo', onClick: () => setNewGrpOpen(true) }} />
            : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {groups.map((group) => (
                    <div
                      key={group.id}
                      className="relative group p-4 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--ring))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors cursor-pointer"
                      onClick={() => navigate(`/app/m/runly.ledger/groups/${group.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`/app/m/runly.ledger/groups/${group.id}`)}
                    >
                      {group.my_role === 'admin' && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openRenameGroup(group) }}
                          className="absolute top-2 right-2 p-1 rounded-md opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                          title="Renombrar grupo"
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      <div className="flex items-center gap-2 mb-1">
                        <FolderOpen size={14} className="text-[hsl(var(--muted-foreground))]" />
                        <span className={`text-xs text-[hsl(var(--muted-foreground))] capitalize ${group.my_role === 'admin' ? 'pr-6' : ''}`}>{group.my_role}</span>
                      </div>
                      <div className="font-semibold text-sm truncate">{group.name}</div>
                      <div className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                        {group.member_count} miembro{Number(group.member_count) !== 1 ? 's' : ''} · {group.account_count} cuenta{Number(group.account_count) !== 1 ? 's' : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )
        )}
      </div>

      <Sheet
        open={newAccOpen && !offlineLedgerView}
        onOpenChange={(open) => {
          if (!open) {
            setNewAccOpen(false)
            setAccForm(EMPTY_ACCOUNT)
          }
        }}
      >
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Nueva cuenta</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleCreateAccount} className="space-y-4 pt-4">
            <TextField
              label="Nombre"
              id="acc-name"
              required
              value={accForm.name}
              onChange={(event) => setAccForm((form) => ({ ...form, name: event.target.value }))}
              placeholder="Ej. Cuenta operativa BBVA"
              maxLength={255}
            />
            <TextField
              label="Banco"
              id="acc-bank"
              required
              value={accForm.bank}
              onChange={(event) => setAccForm((form) => ({ ...form, bank: event.target.value }))}
              placeholder="Ej. BBVA"
              maxLength={255}
            />
            <TextField
              label="Número de cuenta"
              id="acc-number"
              value={accForm.account_number}
              onChange={(event) => setAccForm((form) => ({ ...form, account_number: event.target.value }))}
              placeholder="Opcional"
              maxLength={64}
            />
            <SelectField
              label="Moneda"
              id="acc-currency"
              options={CURRENCY_OPTIONS}
              value={accForm.currency}
              onValueChange={(value) => setAccForm((form) => ({ ...form, currency: value }))}
            />
            <NumberField
              label="Saldo inicial"
              id="acc-balance"
              value={accForm.opening_balance}
              onChange={(event) => setAccForm((form) => ({ ...form, opening_balance: event.target.value }))}
              placeholder="0.00"
              min={0}
              step="0.01"
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setNewAccOpen(false); setAccForm(EMPTY_ACCOUNT) }}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={accSaving || !accForm.name.trim() || !accForm.bank.trim()}>
                {accSaving ? 'Guardando...' : 'Crear cuenta'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Dialog
        open={newGrpOpen && !offlineLedgerView}
        onOpenChange={(open) => {
          if (!open) {
            setNewGrpOpen(false)
            setNewGrpName('')
          }
        }}
      >
        <DialogContent size="sm" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Nuevo grupo</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateGroup} className="space-y-4 pt-2">
            <TextField
              label="Nombre del grupo"
              id="grp-name"
              required
              value={newGrpName}
              onChange={(event) => setNewGrpName(event.target.value)}
              placeholder="Ej. Finanzas Q2"
              autoFocus
              maxLength={128}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => { setNewGrpOpen(false); setNewGrpName('') }}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={grpSaving || !newGrpName.trim()}>
                {grpSaving ? 'Creando...' : 'Crear'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={!!renameGroup} onOpenChange={(open) => { if (!open) setRenameGroup(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Renombrar grupo</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleRenameGroup} className="space-y-4 pt-4">
            <TextField
              label="Nombre del grupo"
              id="rename-grp-name"
              required
              value={renameGroupValue}
              onChange={(e) => setRenameGroupValue(e.target.value)}
              maxLength={255}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenameGroup(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={renameGroupSaving || !renameGroupValue.trim()}>
                {renameGroupSaving ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={!!editAccount} onOpenChange={(open) => { if (!open) setEditAccount(null) }}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Editar cuenta</SheetTitle>
          </SheetHeader>
          <form onSubmit={handleEditAccount} className="space-y-4 pt-4">
            <TextField
              label="Nombre"
              id="list-edit-acc-name"
              required
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              maxLength={255}
            />
            <TextField
              label="Banco"
              id="list-edit-acc-bank"
              required
              value={editForm.bank}
              onChange={(e) => setEditForm((f) => ({ ...f, bank: e.target.value }))}
              maxLength={255}
            />
            <TextField
              label="Número de cuenta"
              id="list-edit-acc-number"
              value={editForm.account_number}
              onChange={(e) => setEditForm((f) => ({ ...f, account_number: e.target.value }))}
              placeholder="Opcional"
              maxLength={64}
            />
            <SelectField
              label="Moneda"
              id="list-edit-acc-currency"
              options={CURRENCY_OPTIONS}
              value={editForm.currency}
              onValueChange={(val) => setEditForm((f) => ({ ...f, currency: val }))}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEditAccount(null)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={editSaving || !editForm.name.trim() || !editForm.bank.trim()}>
                {editSaving ? 'Guardando...' : 'Guardar cambios'}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function AccountGrid({ accounts, onSelect, onEdit }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="relative group p-4 rounded-xl border border-[hsl(var(--border))] hover:border-[hsl(var(--ring))] hover:bg-[hsl(var(--muted)/0.4)] transition-colors cursor-pointer"
          onClick={() => onSelect(account.id)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onSelect(account.id)}
        >
          {onEdit && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onEdit(account) }}
              className="absolute top-2 right-2 p-1 rounded-md opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              title="Editar cuenta"
            >
              <Pencil size={13} />
            </button>
          )}
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[hsl(var(--muted-foreground))] truncate">{account.bank}</span>
            <span className={`text-xs text-[hsl(var(--muted-foreground))] ${onEdit ? 'pr-6' : ''}`}>{account.currency}</span>
          </div>
          <div className="font-semibold text-sm truncate">{account.name}</div>
          {account.account_number && (
            <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">{account.account_number}</div>
          )}
          <div className="mt-2 font-mono text-sm font-semibold">
            {Number(account.current_balance ?? 0).toLocaleString('es-MX', {
              style: 'currency',
              currency: account.currency ?? 'MXN',
              minimumFractionDigits: 2,
            })}
          </div>
          {account.role && (
            <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))] capitalize">{account.role}</div>
          )}
        </div>
      ))}
    </div>
  )
}
