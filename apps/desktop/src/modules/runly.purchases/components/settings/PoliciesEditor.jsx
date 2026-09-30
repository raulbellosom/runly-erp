import { Controller, useFieldArray, useWatch } from 'react-hook-form'
import { Plus, ScrollText, Trash2 } from 'lucide-react'
import { Button, CurrencyField, EmptyState, NumberField, SelectField, TextField } from '@runly/ui'
import { stageMeta } from '../../lib/purchases-constants.js'

const METRICS = [{ value: 'total', label: 'Monto total' }, { value: 'hasGoods', label: 'Incluye bienes' }]
const OPS = [{ value: 'gt', label: 'mayor que' }, { value: 'gte', label: 'mayor o igual a' }, { value: 'lt', label: 'menor que' }]
const YES_NO = [{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }]
const REQUIRABLE = ['QUOTES', 'APPROVAL', 'RECEIPT', 'PAYMENT']

function PolicyRow({ control, index, stageOptions, errors, onRemove, disabled }) {
  const metric = useWatch({ control, name: `policies.${index}.metric` })
  const stage = useWatch({ control, name: `policies.${index}.stage` })
  const err = errors?.policies?.[index] ?? {}
  return (
    <li className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Controller control={control} name={`policies.${index}.label`} render={({ field }) => (
            <TextField label="Regla" placeholder="Compras mayores a 50,000 requieren aprobación" error={err.label?.message} disabled={disabled} {...field} value={field.value ?? ''} />
          )} />
        </div>
        {!disabled ? <Button type="button" variant="ghost" size="icon" aria-label="Quitar regla" onClick={onRemove} className="text-[hsl(var(--muted-foreground))] hover:text-rose-600"><Trash2 className="h-4 w-4" /></Button> : null}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Controller control={control} name={`policies.${index}.metric`} render={({ field }) => (
          <SelectField label="Cuando" options={METRICS} value={field.value} onValueChange={field.onChange} disabled={disabled} />
        )} />
        {metric === 'hasGoods' ? (
          <Controller control={control} name={`policies.${index}.value`} render={({ field }) => (
            <SelectField label="Valor" options={YES_NO} value={String(field.value)} onValueChange={field.onChange} disabled={disabled} />
          )} />
        ) : (
          <>
            <Controller control={control} name={`policies.${index}.op`} render={({ field }) => (
              <SelectField label="Condición" options={OPS} value={field.value} onValueChange={field.onChange} disabled={disabled} />
            )} />
            <Controller control={control} name={`policies.${index}.value`} render={({ field }) => (
              <CurrencyField label="Monto" value={Number(field.value) || 0} onChange={field.onChange} disabled={disabled} />
            )} />
          </>
        )}
        <Controller control={control} name={`policies.${index}.stage`} render={({ field }) => (
          <SelectField label="Exige" options={stageOptions} value={field.value} onValueChange={field.onChange} disabled={disabled} error={err.stage?.message} />
        )} />
        {stage === 'QUOTES' ? (
          <Controller control={control} name={`policies.${index}.min`} render={({ field }) => (
            <NumberField label="Mínimo de cotizaciones" min="1" max="10" allowDecimal={false} allowNegative={false} disabled={disabled}
              value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} error={err.min?.message} />
          )} />
        ) : null}
      </div>
    </li>
  )
}

// Policies decide when a CONDITIONAL stage becomes mandatory (spec section 4).
export function PoliciesEditor({ control, errors, enabledStages, disabled }) {
  const { fields, append, remove } = useFieldArray({ control, name: 'policies' })
  const stageOptions = REQUIRABLE.filter((t) => enabledStages.includes(t)).map((t) => ({ value: t, label: stageMeta(t).label }))

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]/70 p-4 shadow-sm md:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Política de compras</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Reglas que vuelven obligatoria una etapa condicional. Se revisan antes de emitir una orden o pagar una factura.</p>
        </div>
        {!disabled && stageOptions.length ? (
          <Button type="button" variant="outline" onClick={() => append({ id: `p${Date.now()}`, label: '', metric: 'total', op: 'gt', value: 50000, stage: stageOptions[0].value, min: '' })}>
            <Plus className="h-4 w-4" />Agregar regla
          </Button>
        ) : null}
      </div>
      {!fields.length ? (
        <EmptyState variant="compact" icon={ScrollText} title={stageOptions.length ? 'Sin reglas: las etapas condicionales no se exigen' : 'Activa cotizaciones, aprobaciones, recepciones o pagos para crear reglas'} />
      ) : (
        <ol className="space-y-3">
          {fields.map((f, index) => (
            <PolicyRow key={f.id} control={control} index={index} stageOptions={stageOptions} errors={errors} onRemove={() => remove(index)} disabled={disabled} />
          ))}
        </ol>
      )}
    </section>
  )
}
