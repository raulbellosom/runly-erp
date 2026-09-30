import { cn } from '@runly/ui'
import { formatMoney, formatMoneyCompact } from '../lib/format.js'

// Tabular money with the currency code de-emphasised after the amount.
export function MoneyText({ value, currency = 'MXN', compact = false, showCode = false, tone, className }) {
  const text = compact ? formatMoneyCompact(value, currency) : formatMoney(value, currency)
  return (
    <span className={cn('whitespace-nowrap tabular-nums', tone === 'amber' && 'text-amber-700 dark:text-amber-300', tone === 'rose' && 'text-rose-600 dark:text-rose-400', tone === 'emerald' && 'text-emerald-700 dark:text-emerald-300', className)}>
      {text}
      {showCode ? <span className="ml-1 text-[0.7em] font-medium text-[hsl(var(--muted-foreground))]">{currency}</span> : null}
    </span>
  )
}
