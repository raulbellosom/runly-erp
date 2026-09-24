// apps/desktop/src/modules/runly.ledger/components/AccountCard.jsx
import {
  Card, Badge,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@runly/ui'
import { Landmark, FolderOpen, MoreVertical, ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { pickAvatarStyle, splitCurrency } from '../lib/account-visuals.js'
import { useAccountSummary } from '../hooks/use-ledger-queries.js'
import { toLocalIso, toLocalMonth } from '../../../lib/localDate.js'

function fmtShort(amount, currency) {
  return Number(amount ?? 0).toLocaleString('es-MX', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// Reusable rich account tile — used by AccountsScreen's grid and GroupScreen's
// "Cuentas" tab so both share one visual language instead of two near-duplicate
// card implementations. Every field rendered comes from the real account
// record (name/bank/account_number/currency/current_balance/role/group) —
// nothing here is fabricated to fill space.
//
// `actions`: optional [{ label, icon, onSelect(account), destructive? }] —
// AccountsScreen passes "Editar cuenta", GroupScreen passes "Quitar del
// grupo"; different screens need different per-card actions, so this stays
// a plain list instead of a single hardcoded `onEdit` callback.
export default function AccountCard({ account, group, onSelect, actions = [], onGroupClick, showMonthlyStats = true }) {
  const avatar = pickAvatarStyle(account.bank)
  const { intPart, decPart } = splitCurrency(account.current_balance, account.currency ?? 'MXN')
  const hasActions = actions.length > 0

  // Real current-month ingresos/egresos for this account — same hook/endpoint
  // already used by the Resumen tab, so React Query caches it for free when
  // the user later opens the account. Skipped in table/list view (the caller
  // passes showMonthlyStats=false there) to avoid firing one request per row.
  const monthStart = `${toLocalMonth()}-01`
  const today = toLocalIso()
  const { data: summaryData } = useAccountSummary(showMonthlyStats ? account.id : null, {
    dateFrom: monthStart,
    dateTo: today,
  })
  const monthlyKpis = summaryData?.kpis

  return (
    <Card
      variant="interactive"
      className={`group flex flex-col gap-3 rounded-xl p-5 border-l-4 ${avatar.border} hover:border-(--brand-primary)/50`}
      onClick={() => onSelect(account.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(account.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${avatar.bg} ${avatar.fg}`}>
            <Landmark size={20} />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{account.name}</div>
            <div className="text-xs text-[hsl(var(--muted-foreground))] truncate">
              {account.bank}
              {account.account_number && ` · •••• ${String(account.account_number).slice(-4)}`}
            </div>
          </div>
        </div>
        {hasActions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="shrink-0 p-1 rounded-md opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
                title="Más acciones"
              >
                <MoreVertical size={15} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              {actions.map((action) => {
                const Icon = action.icon
                return (
                  <DropdownMenuItem
                    key={action.label}
                    onSelect={() => action.onSelect(account)}
                    className={action.destructive ? 'text-[hsl(var(--destructive))]' : undefined}
                  >
                    {Icon && <Icon size={13} className="mr-2" />} {action.label}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0 h-5">{account.currency}</Badge>
        )}
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))] mb-0.5">
          Saldo actual
        </div>
        <div className="flex items-baseline gap-1 flex-wrap">
          <span className="font-mono text-2xl font-bold tabular-nums tracking-tight">{intPart}</span>
          <span className="font-mono text-sm font-semibold text-[hsl(var(--muted-foreground))] tabular-nums">.{decPart}</span>
          <span className="text-[10px] font-semibold text-[hsl(var(--muted-foreground))] ml-0.5">{account.currency}</span>
        </div>
      </div>

      {monthlyKpis && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-[hsl(var(--muted)/0.5)] px-3 py-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <ArrowDownLeft size={13} className="text-success shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Ingresos mes</div>
              <div className="text-xs font-semibold tabular-nums text-success truncate">
                {fmtShort(monthlyKpis.total_deposito, account.currency)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <ArrowUpRight size={13} className="text-destructive shrink-0" />
            <div className="min-w-0">
              <div className="text-[9px] uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Egresos mes</div>
              <div className="text-xs font-semibold tabular-nums text-destructive truncate">
                {fmtShort(monthlyKpis.total_retiro, account.currency)}
              </div>
            </div>
          </div>
        </div>
      )}

      {(account.role || account.group_id) && (
        <div className="flex items-center gap-2 flex-wrap border-t border-[hsl(var(--border)/0.6)] -mx-5 px-5 pt-3 mt-1">
          {account.role && (
            <Badge variant="outline" className="capitalize text-[10px] px-1.5 py-0 h-5">{account.role}</Badge>
          )}
          {account.group_id && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onGroupClick?.(account.group_id) }}
              className="inline-flex"
              title="Ver grupo"
            >
              <Badge variant="secondary" className="gap-1 text-[10px] px-1.5 py-0 h-5 hover:bg-[hsl(var(--muted-foreground)/0.2)] transition-colors">
                <FolderOpen size={10} />
                {group?.name ?? 'En grupo'}
              </Badge>
            </button>
          )}
        </div>
      )}
    </Card>
  )
}
