import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { stageMeta } from '../../lib/purchases-constants.js'

// Requirements from the company's policies (evaluatePolicies). Unmet ones
// are shown before the user tries the action that they block.
export function PolicyAlerts({ policyCheck }) {
  const list = Array.isArray(policyCheck) ? policyCheck : policyCheck?.requirements ?? []
  if (!list.length) return null
  const pending = list.filter((r) => !r.satisfied)
  const met = list.filter((r) => r.satisfied)

  return (
    <section className={`rounded-2xl border p-4 ${pending.length ? 'border-rose-500/30 bg-rose-500/[0.06]' : 'border-emerald-500/30 bg-emerald-500/[0.06]'}`}>
      <div className="flex items-start gap-3">
        {pending.length ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {pending.length ? `Falta ${pending.length === 1 ? 'un requisito' : `${pending.length} requisitos`} de tu política de compras` : 'Cumple con la política de compras'}
          </h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {pending.map((r, i) => (
              <li key={`p${i}`} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                <span><span className="font-medium">{stageMeta(r.stage).label}{r.min ? ` (mínimo ${r.min})` : ''}:</span> {r.reason}</span>
              </li>
            ))}
            {met.map((r, i) => (
              <li key={`m${i}`} className="flex gap-2 text-[hsl(var(--muted-foreground))]">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <span>{stageMeta(r.stage).label}: {r.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
