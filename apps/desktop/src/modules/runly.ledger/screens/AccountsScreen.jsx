import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/screens/AccountsScreen.jsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  PageHeader, Button, EmptyState, ErrorState, Badge,
  Tabs, TabsList, TabsTrigger, SearchInput,
  ViewModeSwitch, getStoredViewMode,
  Sheet, SheetContent, SheetHeader, SheetTitle,
  TextField, NumberField, SelectField,
} from '@runly/ui'
import { useOfflineStatus } from '@runly/offline'
import { Plus, Landmark, Users, FolderOpen, Sparkles, Pencil, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { useAccountList, useLedgerSQLite } from '../hooks/use-ledger-queries.js'
import AccountCard from '../components/AccountCard.jsx'
import { splitCurrency } from '../lib/account-visuals.js'
import { LedgerStatStrip } from '../components/LedgerStatCard.jsx'

const API_BASE = getApiUrl()

const CURRENCY_OPTIONS = [
  { value: 'MXN', label: 'MXN — Peso mexicano' },
  { value: 'USD', label: 'USD — Dólar estadounidense' },
]

const TABS = [
  { key: 'own', label: 'Mis cuentas', icon: Landmark },
  { key: 'shared', label: 'Compartidas conmigo', icon: Users },
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
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState(() => getStoredViewMode('ledger-accounts', 'cards'))

  const [newAccOpen, setNewAccOpen] = useState(false)
  const [accForm, setAccForm] = useState(EMPTY_ACCOUNT)
  const [accSaving, setAccSaving] = useState(false)

  const [editAccount, setEditAccount] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', bank: '', account_number: '', currency: 'MXN' })
  const [editSaving, setEditSaving] = useState(false)

  const headers = { Authorization: `Bearer ${token}` }
  const { data: allData, isLoading: allLoading, isError: allError, refetch: refetchAccounts } = useAccountList()

  const { data: membershipData, isLoading: mbLoading } = useQuery({
    queryKey: ['ledger-memberships', token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/memberships`, { headers })
      if (!res.ok) return { data: { groups: [], accounts: [] } }
      return res.json()
    },
    enabled: !!token && isOnline,
  })

  // Fetched (not rendered as its own tab) purely to resolve group names for
  // the badge on grouped account cards below — see spec Task 1 / edge case #7.
  const { data: groupsData, isLoading: grpLoading } = useQuery({
    queryKey: ['ledger-groups', token],
    queryFn: async () => {
      const res = await companyFetch(`${API_BASE}/ledger/groups`, { headers })
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

  // Real per-currency totals (sums balances only within the same currency —
  // never mixes MXN/USD into one misleading number).
  const balancesByCurrency = ownAccounts.reduce((acc, account) => {
    const code = account.currency ?? 'MXN'
    acc[code] = (acc[code] ?? 0) + Number(account.current_balance ?? 0)
    return acc
  }, {})
  const currencyCodes = Object.keys(balancesByCurrency)

  const normalizedSearch = search.trim().toLowerCase()
  function filterBySearch(list) {
    if (!normalizedSearch) return list
    return list.filter((account) =>
      [account.name, account.bank, account.account_number]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch),
    )
  }

  async function handleCreateAccount(event) {
    event.preventDefault()
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

      toast.success('Cuenta creada.')
      setAccForm(EMPTY_ACCOUNT)
      setNewAccOpen(false)
      queryClient.invalidateQueries({ queryKey: ['ledger-accounts'] })
    } finally {
      setAccSaving(false)
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
      const res = await companyFetch(`${API_BASE}/ledger/accounts/${editAccount.id}`, {
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

  const filteredOwn = filterBySearch(ownAccounts)
  const filteredShared = filterBySearch(sharedAccounts)
  const filteredOffline = filterBySearch(offlineAccounts)

  const balanceStatValue = currencyCodes.length === 0
    ? '—'
    : (
        <span className="flex flex-col gap-0.5">
          {currencyCodes.map((code) => {
            const { intPart, decPart } = splitCurrency(balancesByCurrency[code], code)
            return (
              <span key={code} className="tabular-nums">
                {intPart}<span className="text-xs opacity-70">.{decPart}</span>
              </span>
            )
          })}
        </span>
      )

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
              : (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => navigate('/app/m/runly.ledger/accounts/import-ai')}>
                      <Sparkles size={14} className="mr-1" /> Importar con IA
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => setNewAccOpen(true)}>
                      <Plus size={14} className="mr-1" /> Nueva cuenta
                    </Button>
                  </div>
                )
          }
        />

        {!offlineLedgerView && (
          <LedgerStatStrip
            className="mb-4"
            items={[
              { key: 'balance', label: currencyCodes.length > 1 ? 'Saldo total por moneda' : 'Saldo total', value: balanceStatValue, icon: Wallet, tone: 'brand' },
              { key: 'own', label: 'Cuentas propias', value: ownAccounts.length, icon: Landmark, tone: 'success' },
              { key: 'shared', label: 'Compartidas conmigo', value: sharedAccounts.length, icon: Users, tone: 'violet' },
              { key: 'groups', label: 'Grupos', value: groups.length, icon: FolderOpen, tone: 'amber' },
            ]}
          />
        )}

        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Tabs value={effectiveTab} onValueChange={(v) => setActiveTab(v)} className="shrink-0">
            <TabsList>
              {tabs.map((tab) => {
                const Icon = tab.icon
                return (
                  <TabsTrigger key={tab.key} value={tab.key} className="gap-1.5">
                    <Icon size={14} />
                    {tab.label}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, banco o número..."
            className="flex-1"
          />
          {!offlineLedgerView && (
            <ViewModeSwitch
              modes={['cards', 'table']}
              value={viewMode}
              onChange={setViewMode}
              storageKey="ledger-accounts"
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
        {offlineLedgerView && (
          <div className="mb-4 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.25)] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">
            Mostrando la cache local de ledger. La separación por compartidas y grupos vuelve al reconectar.
          </div>
        )}

        {effectiveTab === 'offline' && (
          filteredOffline.length === 0
            ? <EmptyState icon={Landmark} title="Sin cuentas en cache" description="Sincroniza ledger mientras estés conectado para consultarlo offline después." />
            : <AccountList accounts={filteredOffline} groups={groups} viewMode="cards" onSelect={(id) => navigate(`/app/m/runly.ledger/accounts/${id}`)} onGroupClick={(id) => navigate(`/app/m/runly.ledger/groups/${id}`)} />
        )}

        {effectiveTab === 'own' && (
          ownAccounts.length === 0
            ? <EmptyState icon={Landmark} title="Sin cuentas personales" description="Crea una cuenta para registrar tus movimientos." action={{ label: 'Nueva cuenta', onClick: () => setNewAccOpen(true) }} />
            : filteredOwn.length === 0
              ? <EmptyState icon={Landmark} title="Sin resultados" description="Ninguna cuenta coincide con tu búsqueda." />
              : <AccountList accounts={filteredOwn} groups={groups} viewMode={viewMode} onSelect={(id) => navigate(`/app/m/runly.ledger/accounts/${id}`)} onEdit={openEdit} onGroupClick={(id) => navigate(`/app/m/runly.ledger/groups/${id}`)} />
        )}

        {effectiveTab === 'shared' && (
          sharedAccounts.length === 0
            ? <EmptyState icon={Users} title="Sin cuentas compartidas" description="Nadie ha compartido cuentas contigo todavía." />
            : filteredShared.length === 0
              ? <EmptyState icon={Users} title="Sin resultados" description="Ninguna cuenta coincide con tu búsqueda." />
              : <AccountList accounts={filteredShared} groups={groups} viewMode={viewMode} onSelect={(id) => navigate(`/app/m/runly.ledger/accounts/${id}`)} onGroupClick={(id) => navigate(`/app/m/runly.ledger/groups/${id}`)} />
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

function AccountList({ accounts, groups, viewMode, onSelect, onEdit, onGroupClick }) {
  if (viewMode === 'table') {
    return (
      <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[hsl(var(--muted))] border-b border-[hsl(var(--border))]">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Cuenta</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] hidden sm:table-cell">Banco</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Etiquetas</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const group = account.group_id ? groups.find((g) => g.id === account.group_id) : null
              return (
                <tr
                  key={account.id}
                  onClick={() => onSelect(account.id)}
                  className="border-b border-[hsl(var(--border)/0.5)] last:border-b-0 hover:bg-[hsl(var(--muted)/0.4)] transition-colors cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-(--brand-soft) text-(--brand-primary)">
                        <Landmark size={14} />
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{account.name}</div>
                        <div className="text-xs text-[hsl(var(--muted-foreground))] truncate sm:hidden">{account.bank}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[hsl(var(--muted-foreground))] hidden sm:table-cell">
                    {account.bank}
                    {account.account_number && ` · •••• ${String(account.account_number).slice(-4)}`}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {account.role && (
                        <Badge variant="outline" className="capitalize text-[10px] px-1.5 py-0 h-5">{account.role}</Badge>
                      )}
                      {account.group_id && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onGroupClick(account.group_id) }}
                          className="inline-flex"
                          title="Ver grupo"
                        >
                          <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0 h-5">
                            <FolderOpen size={10} />
                            {group?.name ?? 'En grupo'}
                          </Badge>
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums whitespace-nowrap">
                    {Number(account.current_balance ?? 0).toLocaleString('es-MX', {
                      style: 'currency',
                      currency: account.currency ?? 'MXN',
                      minimumFractionDigits: 2,
                    })}
                    <span className="ml-1 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">{account.currency}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  const actions = onEdit ? [{ label: 'Editar cuenta', icon: Pencil, onSelect: onEdit }] : []

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {accounts.map((account) => {
        const group = account.group_id ? groups.find((g) => g.id === account.group_id) : null
        return (
          <AccountCard
            key={account.id}
            account={account}
            group={group}
            onSelect={onSelect}
            actions={actions}
            onGroupClick={onGroupClick}
          />
        )
      })}
    </div>
  )
}
