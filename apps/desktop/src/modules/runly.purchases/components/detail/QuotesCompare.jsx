import { useState } from 'react'
import { toast } from 'sonner'
import { Award, Plus, Scale, Timer } from 'lucide-react'
import { Button, ConfirmDialog, EmptyState, cn } from '@runly/ui'
import { PurchaseStatusBadge } from '../PurchaseStatusBadge.jsx'
import { QuoteDialog } from './QuoteDialog.jsx'
import { errorText, useTransition } from '../../hooks/usePurchases.js'
import { formatDate, formatMoney, toNumber } from '../../lib/format.js'

// Side-by-side quotes. The lowest total and the fastest delivery are marked;
// choosing one discards its siblings in the same case (API rule).
export function QuotesCompare({ quotes = [], caseId, requestId, currency, minRequired, canManage }) {
  const [adding, setAdding] = useState(false)
  const [choice, setChoice] = useState(null)
  const transition = useTransition('quotes', null)
  const live = quotes.filter((q) => q.status !== 'DISCARDED')
  const cheapest = live.length > 1 ? Math.min(...live.map((q) => toNumber(q.total))) : null
  const fastest = live.filter((q) => q.deliveryDays != null).length > 1 ? Math.min(...live.filter((q) => q.deliveryDays != null).map((q) => q.deliveryDays)) : null

  const act = async (quote, action) => {
    try {
      await transition.mutateAsync({ action, targetId: quote.id })
      toast.success(action === 'select' ? 'Cotización elegida' : 'Cotización descartada')
      setChoice(null)
    } catch (error) {
      toast.error(errorText(error, 'No se pudo actualizar la cotización'))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {minRequired ? `Tu política pide al menos ${minRequired} cotizaciones; hay ${live.length}.` : `${quotes.length} ${quotes.length === 1 ? 'cotización' : 'cotizaciones'} registradas.`}
        </p>
        {canManage && caseId ? <Button variant="outline" onClick={() => setAdding(true)}><Plus className="h-4 w-4" />Registrar cotización</Button> : null}
      </div>
      {!quotes.length ? (
        <EmptyState icon={Scale} title="Sin cotizaciones" description="Registra las propuestas de tus proveedores para compararlas aquí." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {quotes.map((q) => {
            const best = cheapest != null && toNumber(q.total) === cheapest && q.status !== 'DISCARDED'
            const quick = fastest != null && q.deliveryDays === fastest && q.status !== 'DISCARDED'
            return (
              <article key={q.id} className={cn('flex flex-col rounded-2xl border bg-[hsl(var(--card))] p-4 shadow-sm',
                q.status === 'SELECTED' ? 'border-emerald-500/60 ring-2 ring-emerald-500/20' : 'border-[hsl(var(--border))]', q.status === 'DISCARDED' && 'opacity-60')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{q.supplierName ?? q.supplier?.name ?? 'Proveedor'}</p>
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">{q.reference ?? 'Sin referencia'}, {formatDate(q.issueDate)}</p>
                  </div>
                  <PurchaseStatusBadge kind="quotes" status={q.status} />
                </div>
                <p className="mt-4 text-2xl font-semibold tabular-nums">{formatMoney(q.total, q.currency ?? currency)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {best ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 px-2 py-0.5 font-medium text-emerald-700 dark:text-emerald-300"><Award className="h-3 w-3" />Menor precio</span> : null}
                  {quick ? <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/12 px-2 py-0.5 font-medium text-sky-700 dark:text-sky-300"><Timer className="h-3 w-3" />Entrega más rápida</span> : null}
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Entrega</dt><dd>{q.deliveryDays != null ? `${q.deliveryDays} días` : 'Sin dato'}</dd></div>
                  <div className="flex justify-between"><dt className="text-[hsl(var(--muted-foreground))]">Vigencia</dt><dd>{q.validUntil ? formatDate(q.validUntil) : 'Sin dato'}</dd></div>
                </dl>
                {canManage && q.status === 'RECEIVED' ? (
                  <div className="mt-4 flex gap-2 pt-1">
                    <Button size="sm" variant="ghost" className="flex-1" onClick={() => act(q, 'discard')} disabled={transition.isPending}>Descartar</Button>
                    <Button size="sm" className="flex-1" onClick={() => setChoice(q)} disabled={transition.isPending}>Elegir</Button>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
      <QuoteDialog open={adding} onOpenChange={setAdding} caseId={caseId} requestId={requestId} currency={currency} />
      <ConfirmDialog open={Boolean(choice)} onOpenChange={(o) => { if (!o) setChoice(null) }} title="Elegir cotización"
        description="Las demás cotizaciones de este expediente quedarán descartadas." detail={choice ? `${choice.supplierName ?? 'Proveedor'}, ${formatMoney(choice.total, choice.currency ?? currency)}` : ''}
        confirmLabel="Elegir" loading={transition.isPending} onConfirm={() => act(choice, 'select')} />
    </div>
  )
}
