import { Skeleton } from '@runly/ui'
import { PurchaseFlowRibbon } from '../PurchaseFlowRibbon.jsx'
import { HERO_GRADIENT, PRESETS } from '../../lib/purchases-constants.js'
import { formatMoneyCompact } from '../../lib/format.js'

// Where each pipeline node leads when clicked.
export const STAGE_ROUTE = {
  REQUEST: 'requests', QUOTES: 'cases', APPROVAL: 'approvals', PURCHASE_ORDER: 'orders',
  RECEIPT: 'receipts', INVOICE: 'invoices', PAYMENT: 'payments', CLOSE: 'cases',
}

// The dashboard's one loud element: the company's process as a track, each
// station carrying how many documents are waiting in it.
export function PipelineHero({ data, stages, preset, ordersEnabled = true, isLoading, actions, onStage }) {
  const counts = new Map((data?.pipeline ?? []).map((row) => [row.stage, row.count]))
  const track = stages.filter((s) => s.type !== 'RELATE').map((s) => ({ ...s, count: counts.get(s.type) ?? 0 }))
  const m = data?.metrics ?? {}
  const presetName = PRESETS.find((p) => p.key === preset)?.name

  return (
    <section className="relative overflow-hidden rounded-3xl p-5 text-white shadow-xl md:p-8" style={{ background: HERO_GRADIENT }}>
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-emerald-300/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-sky-400/20 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:repeating-linear-gradient(90deg,#fff_0_1px,transparent_1px_48px)]" />

      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm text-teal-100/80">Compras{presetName ? `, flujo ${presetName.toLowerCase()}` : ''}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
            {isLoading ? 'Cargando tus compras' : ordersEnabled
              ? `${formatMoneyCompact(m.orderedAmount)} comprometidos`
              : `${formatMoneyCompact(m.invoicedAmount)} facturados`}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-teal-50/80">
            {isLoading ? 'Preparando el resumen del periodo.' : (
              <>
                {ordersEnabled ? `${formatMoneyCompact(m.invoicedAmount)} ya facturados y ` : 'De ellos, '}
                <span className="font-semibold text-amber-200">{formatMoneyCompact(m.payableAmount)} por pagar</span>
                {m.overdueInvoices ? <>, con <span className="font-semibold text-rose-200">{m.overdueInvoices} {m.overdueInvoices === 1 ? 'factura vencida' : 'facturas vencidas'}</span></> : null}.
              </>
            )}
          </p>
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>

      <div className="relative mt-8 rounded-2xl border border-white/15 bg-white/[0.06] px-3 py-5 backdrop-blur-md md:px-5">
        {isLoading ? (
          <div className="flex justify-between gap-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 flex-1 rounded-xl bg-white/15" />)}</div>
        ) : (
          <PurchaseFlowRibbon stages={track} surface="dark" onSelect={(stage) => onStage?.(stage)} />
        )}
      </div>
    </section>
  )
}
