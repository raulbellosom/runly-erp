import { computeTotals } from '../../lib/document-math.js'
import { formatMoney } from '../../lib/format.js'
import { HERO_GRADIENT } from '../../lib/purchases-constants.js'

// Sticky summary beside the editor, read like the foot of a paper document:
// subtotal, one line per tax rate, and the total set large.
export function TotalsCard({ lines = [], currency = 'MXN', title = 'Total del documento', children, footnote }) {
  const t = computeTotals(lines)
  return (
    <aside className="overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-sm lg:sticky lg:top-4">
      <div className="px-5 pb-5 pt-4 text-white" style={{ background: HERO_GRADIENT }}>
        <p className="text-sm text-teal-50/80">{title}</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatMoney(t.total, currency)}</p>
        <p className="mt-1 text-xs text-teal-50/70">{t.lineCount} {t.lineCount === 1 ? 'concepto' : 'conceptos'} en {currency}</p>
      </div>
      <dl className="space-y-2 px-5 py-4 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-[hsl(var(--muted-foreground))]">Subtotal</dt>
          <dd className="tabular-nums">{formatMoney(t.subtotal, currency)}</dd>
        </div>
        {t.taxes.length ? t.taxes.map((tax) => (
          <div key={tax.rate} className="flex justify-between gap-3">
            <dt className="text-[hsl(var(--muted-foreground))]">IVA {Math.round(tax.rate * 100)}%</dt>
            <dd className="tabular-nums">{formatMoney(tax.amount, currency)}</dd>
          </div>
        )) : (
          <div className="flex justify-between gap-3">
            <dt className="text-[hsl(var(--muted-foreground))]">Impuestos</dt>
            <dd className="tabular-nums">{formatMoney(0, currency)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-dashed border-[hsl(var(--border))] pt-2 font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(t.total, currency)}</dd>
        </div>
      </dl>
      {footnote ? <p className="px-5 pb-3 text-xs text-[hsl(var(--muted-foreground))]">{footnote}</p> : null}
      {children ? <div className="flex flex-col gap-2 border-t border-[hsl(var(--border))] p-4">{children}</div> : null}
    </aside>
  )
}
