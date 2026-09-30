import { ChevronRight, CircleDot, Unlink } from 'lucide-react'
import { Button, cn } from '@runly/ui'
import { ORIGIN_LABELS, STAGE_META, documentHref, formatDay, formatMoney, statusMeta } from './InventoryPurchaseMeta.js'

// Vertical "Compra" timeline: one node per stage that has documents, each
// document as a compact card that opens its purchases detail.
export function InventoryPurchaseTimeline({ stages, onOpen, onUnlink, canUnlink }) {
  return (
    <ol className="relative space-y-4">
      {stages.map((stage, index) => {
        const meta = STAGE_META[stage.stage] ?? { icon: CircleDot }
        const Icon = meta.icon
        const last = index === stages.length - 1
        return (
          <li key={stage.stage} className="relative pl-10">
            {!last ? <span aria-hidden className="absolute left-[15px] top-8 bottom-[-16px] w-px bg-linear-to-b from-teal-500/40 to-[hsl(var(--border))]" /> : null}
            <span className="absolute left-0 top-0 grid h-8 w-8 place-items-center rounded-full bg-teal-600 text-white shadow-sm ring-4 ring-teal-500/10 dark:bg-teal-500">
              <Icon className="h-4 w-4" />
            </span>
            <div className="flex h-8 items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{stage.label || meta.label || stage.stage}</p>
              {stage.docs.length > 1 ? <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))]">{stage.docs.length}</span> : null}
            </div>
            <div className="mt-2 space-y-2">
              {stage.docs.map((doc) => (
                <InventoryPurchaseDocCard
                  key={`${doc.type}-${doc.id}-${doc.relationId ?? ''}`}
                  doc={doc}
                  onOpen={onOpen}
                  onUnlink={canUnlink && doc.relationId ? onUnlink : null}
                />
              ))}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function InventoryPurchaseDocCard({ doc, onOpen, onUnlink }) {
  const status = statusMeta(doc.status)
  const href = documentHref(doc)
  const origin = ORIGIN_LABELS[doc.origin] ?? null
  const hasTotal = doc.total !== null && doc.total !== undefined && doc.total !== ''
  return (
    <div className="group flex items-stretch overflow-hidden rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] transition-colors hover:border-teal-500/40">
      <button
        type="button"
        disabled={!href}
        onClick={() => href && onOpen(href)}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-500 disabled:cursor-default"
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[13px] font-semibold text-[hsl(var(--foreground))]">{doc.number || 'Sin folio'}</span>
            <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset', status.className)}>{status.label}</span>
          </div>
          <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">
            {[formatDay(doc.date), origin ? `Relación ${origin.toLowerCase()}` : null].filter(Boolean).join(' · ') || 'Sin fecha'}
          </p>
        </div>
        {hasTotal ? <span className="shrink-0 text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">{formatMoney(doc.total, doc.currency)}</span> : null}
        {href ? <ChevronRight className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform group-hover:translate-x-0.5" /> : null}
      </button>
      {onUnlink ? (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-auto w-9 shrink-0 rounded-none border-l border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:text-rose-600"
          aria-label={`Quitar relación con ${doc.number || 'el documento'}`}
          title="Quitar relación"
          onClick={() => onUnlink(doc)}
        >
          <Unlink className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
