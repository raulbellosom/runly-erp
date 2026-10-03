import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, ClipboardList, ContactRound, History, Pencil, ReceiptText } from 'lucide-react'
import { Button, EmptyState, ErrorState, PageHeader, StatStrip, DetailSkeleton } from '@runly/ui'
import { usePurchasesCan, useSupplier } from '../hooks/usePurchases.js'
import { usePurchaseRoute } from '../hooks/usePurchaseRoute.js'
import { HERO_GRADIENT, KINDS, ROOT, TONES, kindOf } from '../lib/purchases-constants.js'
import { formatDate, formatMoney, formatMoneyCompact, initials, monthLabel } from '../lib/format.js'
import { AXIS, ChartTooltip, Panel } from '../components/dashboard/dashboard-theme.jsx'
import { PurchaseStatusBadge } from '../components/PurchaseStatusBadge.jsx'
import { SupplierProfileDialog } from '../components/SupplierProfileDialog.jsx'

// Supplier profile: who they are (contact), how we buy from them (profile,
// spend by month) and the documents we have with them.
export default function PurchaseSupplierDetail() {
  const navigate = useNavigate()
  const { id } = usePurchaseRoute()
  const can = usePurchasesCan()
  const query = useSupplier(id)
  const [editing, setEditing] = useState(false)

  if (query.isLoading) return <div className="min-h-dvh p-4 md:p-6"><DetailSkeleton /></div>
  if (query.isError || !query.data) return <div className="min-h-dvh p-4 md:p-6"><ErrorState title="No se pudo cargar el proveedor" onRetry={() => query.refetch()} /></div>

  const data = query.data
  const s = data.supplier ?? data.contact ?? data
  const profile = data.profile ?? s.profile ?? {}
  const stats = data.stats ?? {}
  const monthly = (data.monthly ?? []).map((m) => ({ ...m, label: monthLabel(m.month), ordered: Number(m.ordered ?? 0), invoiced: Number(m.invoiced ?? 0) }))
  const hasMonthly = monthly.some((m) => m.ordered || m.invoiced)
  const recent = data.recent ?? []

  return (
    <div className="min-h-dvh space-y-5 p-4 md:p-6">
      <PageHeader compact eyebrow="Compras" title="Proveedores" onBack={() => navigate(`${ROOT}/suppliers`)} backLabel="Volver a proveedores" />

      <section className="relative overflow-hidden rounded-3xl p-5 text-white shadow-xl md:p-7" style={{ background: HERO_GRADIENT }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            {s.avatarUrl
              ? <img src={s.avatarUrl} alt="" className="h-16 w-16 shrink-0 rounded-2xl object-cover ring-1 ring-white/25" />
              : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-xl font-semibold ring-1 ring-white/25">{initials(s.name)}</span>}
            <div className="min-w-0">
              <h1 className="truncate text-3xl font-semibold tracking-tight">{s.name}</h1>
              <p className="truncate text-sm text-teal-50/80">{[profile.supplierCode, s.taxId, s.email, s.phone].filter(Boolean).join(', ') || 'Sin datos de contacto'}</p>
              {profile.paymentTerms ? <p className="mt-1 text-sm text-teal-50/90">Condiciones: {profile.paymentTerms}</p> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="border border-white/30 bg-white/10 text-white hover:bg-white/20" onClick={() => navigate(`/app/m/runly.contacts/contacts/${s.id ?? id}`)}><ContactRound className="h-4 w-4" />Ver contacto</Button>
            {can('purchases.supplier.manage') ? <Button className="bg-white text-teal-900 hover:bg-white/90" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />Perfil de compras</Button> : null}
          </div>
        </div>
      </section>

      <StatStrip items={[
        { key: 'spend', label: 'Comprado', value: formatMoney(stats.invoiced || stats.ordered || 0), icon: 'Wallet' },
        { key: 'orders', label: 'Órdenes', value: stats.orders ?? 0, icon: 'ClipboardList' },
        { key: 'invoices', label: 'Facturas', value: stats.invoices ?? 0, icon: 'ReceiptText' },
        stats.payable != null && { key: 'payable', label: 'Por pagar', value: formatMoney(stats.payable), icon: 'Clock' },
      ]} />

      <div className="grid gap-4 xl:grid-cols-5">
        <Panel title="Compra por mes" subtitle="Últimos 12 meses" icon={BarChart3} className="xl:col-span-3">
          {!hasMonthly ? <EmptyState variant="compact" icon={BarChart3} title="Sin compras registradas" /> : (
            <div className="h-60 w-full min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 1, height: 1 }}>
                <BarChart data={monthly} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border) / 0.5)" vertical={false} />
                  <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} width={56} tickFormatter={(v) => formatMoneyCompact(v)} />
                  <Tooltip content={<ChartTooltip formatter={(v) => formatMoney(v)} />} cursor={{ fill: 'hsl(var(--muted) / 0.4)' }} />
                  <Bar dataKey="ordered" name="Ordenado" fill={TONES.teal} radius={[6, 6, 2, 2]} />
                  <Bar dataKey="invoiced" name="Facturado" fill={TONES.sky} radius={[6, 6, 2, 2]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>
        <Panel title="Documentos recientes" icon={History} tone={TONES.slate} className="xl:col-span-2">
          {!recent.length ? <EmptyState variant="compact" icon={History} title="Aún no hay documentos con este proveedor" /> : (
            <ul className="divide-y divide-[hsl(var(--border))]">
              {recent.map((d) => {
                const kind = kindOf(d.kind ?? d.type) ?? 'orders'
                const Icon = KINDS[kind]?.icon ?? (kind === 'invoices' ? ReceiptText : ClipboardList)
                return (
                  <li key={`${kind}:${d.id}`}>
                    <button type="button" onClick={() => navigate(`${ROOT}/${kind}/${d.id}`)} className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-[hsl(var(--muted))]/40">
                      <Icon className="h-4 w-4 shrink-0 text-teal-700 dark:text-teal-300" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold tabular-nums">{d.number}</span>
                        <span className="block text-xs text-[hsl(var(--muted-foreground))]">{formatDate(d.date ?? d.issueDate)}</span>
                      </span>
                      <span className="text-sm tabular-nums">{formatMoney(d.total, d.currency)}</span>
                      <PurchaseStatusBadge kind={kind} status={d.status} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Panel>
      </div>

      {profile.notes ? <p className="rounded-2xl border border-dashed border-[hsl(var(--border))] px-4 py-3 text-sm text-[hsl(var(--muted-foreground))]">{profile.notes}</p> : null}
      <SupplierProfileDialog contactId={s.id ?? id} name={s.name} profile={profile} open={editing} onOpenChange={setEditing} />
    </div>
  )
}
