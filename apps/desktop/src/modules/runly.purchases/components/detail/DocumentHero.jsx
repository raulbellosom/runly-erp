import { Link } from 'react-router-dom'
import { PurchaseFlowRibbon } from '../PurchaseFlowRibbon.jsx'
import { PurchaseStatusBadge } from '../PurchaseStatusBadge.jsx'
import { HERO_GRADIENT, KINDS, ROOT, docPath } from '../../lib/purchases-constants.js'
import { formatDate, formatMoney, toNumber } from '../../lib/format.js'

function Fact({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-teal-50/70">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium text-white">{children}</dd>
    </div>
  )
}

// Detail hero: the folio set large like a stamped number, who it is with,
// its status and total, and the process track showing where it stands.
export function DocumentHero({ kind, doc, facts = [], actions, onOpenRef }) {
  const meta = KINDS[kind]
  const Icon = meta.icon
  const supplier = doc.supplier ?? (doc.supplierName ? { name: doc.supplierName, id: doc.supplierId } : null)
  const amount = kind === 'requests' || kind === 'cases' ? doc.estimatedTotal : doc.total
  const paid = kind === 'invoices' ? toNumber(doc.paidAmount) : 0
  const stages = (doc.stageMap ?? []).filter((s) => s.mode !== 'DISABLED')

  return (
    <section className="relative overflow-hidden rounded-3xl text-white shadow-xl" style={{ background: HERO_GRADIENT }}>
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-emerald-300/20 blur-3xl" />
      <div className="relative p-5 md:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm text-teal-50/80"><Icon className="h-4 w-4" />{meta.singular}</p>
            <h1 className="mt-1 break-all text-4xl font-semibold tracking-tight tabular-nums md:text-5xl">{doc.number ?? 'Sin folio'}</h1>
            {doc.title ? <p className="mt-1 max-w-2xl text-base text-teal-50/90">{doc.title}</p> : null}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <PurchaseStatusBadge kind={kind} status={doc.status} className="bg-white/15 text-white ring-white/30 dark:text-white" />
              {doc.sequence ? (
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium tabular-nums" title="Consecutivo interno automático">
                  Consecutivo N.º {doc.sequence}
                </span>
              ) : null}
              {supplier?.name ? (
                supplier.id ? (
                  <Link to={`${ROOT}/suppliers/${supplier.id}`} className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium hover:bg-white/20">{supplier.name}</Link>
                ) : <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium">{supplier.name}</span>
              ) : null}
              {doc.caseId && kind !== 'cases' ? (
                <Link to={docPath('purchase_case', doc.caseId)} className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-medium hover:bg-white/20">
                  Expediente {doc.caseNumber ?? doc.case?.number ?? ''}
                </Link>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 lg:text-right">
            <p className="text-sm text-teal-50/75">{kind === 'requests' || kind === 'cases' ? 'Monto estimado' : 'Total'}</p>
            <p className="text-3xl font-semibold tabular-nums md:text-4xl">{amount != null ? formatMoney(amount, doc.currency) : 'Sin monto'}</p>
            {kind === 'invoices' && amount != null ? (
              <p className="mt-1 text-sm tabular-nums text-teal-50/80">
                Pagado {formatMoney(paid, doc.currency)}, saldo <span className="font-semibold text-amber-200">{formatMoney(Math.max(0, toNumber(amount) - paid), doc.currency)}</span>
              </p>
            ) : null}
            {actions ? <div className="mt-4 flex flex-wrap gap-2 lg:justify-end">{actions}</div> : null}
          </div>
        </div>

        {facts.length ? (
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/15 pt-4 sm:grid-cols-3 lg:grid-cols-5">
            {facts.map((f) => <Fact key={f.label} label={f.label}>{f.value ?? 'Sin dato'}</Fact>)}
          </dl>
        ) : null}
      </div>
      {stages.length ? (
        <div className="relative border-t border-white/15 bg-black/10 px-3 py-4 backdrop-blur-sm md:px-6">
          <PurchaseFlowRibbon stages={stages} surface="dark" onOpenRef={onOpenRef} />
        </div>
      ) : null}
    </section>
  )
}

export const dateFact = (label, value) => ({ label, value: value ? formatDate(value) : null })
