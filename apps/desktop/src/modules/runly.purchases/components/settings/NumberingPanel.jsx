import { Controller } from 'react-hook-form'
import { Hash } from 'lucide-react'
import { TextField } from '@runly/ui'
import { NUMBERING_KINDS, NUMBERING_TOKENS, formatFolio } from '../../lib/numbering.js'

// Company folio formats. Only the kinds the flow uses are listed; the
// preview shows the folio the next document would get if left empty.
export function NumberingPanel({ control, capabilities, disabled }) {
  const kinds = NUMBERING_KINDS.filter((k) => !k.capability || capabilities?.[k.capability])
  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/70 p-4 shadow-sm md:p-5">
      <header className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-600 text-white shadow-sm"><Hash className="h-4 w-4" /></span>
        <div>
          <h2 className="text-base font-semibold">Numeración de folios</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            El folio siempre se puede escribir a mano (por ejemplo, para registrar una orden pasada). Este formato solo se usa cuando se deja vacío.
            El consecutivo interno de Runly es independiente y nunca se repite.
          </p>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {kinds.map(({ kind, label }) => (
          <Controller key={kind} control={control} name={`numbering.${kind}`} render={({ field, fieldState }) => (
            <TextField label={label} disabled={disabled} maxLength={60} placeholder="OC-{N:6}"
              error={fieldState.error?.message}
              hint={fieldState.error ? undefined : `Siguiente ejemplo: ${formatFolio(field.value, 12)}`}
              {...field} value={field.value ?? ''} />
          )} />
        ))}
      </div>

      <dl className="mt-4 grid gap-x-4 gap-y-1 rounded-xl bg-[hsl(var(--muted))]/40 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
        {NUMBERING_TOKENS.map(({ token, meaning }) => (
          <div key={token} className="flex gap-2">
            <dt className="font-mono font-semibold text-teal-700 dark:text-teal-300">{token}</dt>
            <dd className="text-[hsl(var(--muted-foreground))]">{meaning}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
