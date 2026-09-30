import { cn } from '@runly/ui'
import { TONE_PILL, statusMeta } from '../lib/purchases-constants.js'

const DOT = {
  slate: 'bg-slate-400', teal: 'bg-teal-500', sky: 'bg-sky-500', violet: 'bg-violet-500',
  amber: 'bg-amber-500', emerald: 'bg-emerald-500', rose: 'bg-rose-500',
}

export function PurchaseStatusBadge({ kind, status, label, tone, className }) {
  const meta = statusMeta(kind, status)
  const resolvedTone = tone ?? meta.tone
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', TONE_PILL[resolvedTone] ?? TONE_PILL.slate, className)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', DOT[resolvedTone] ?? DOT.slate)} />
      {label ?? meta.label}
    </span>
  )
}
