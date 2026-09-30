import { Controller } from 'react-hook-form'
import { DateField, SegmentedControl, SelectField, TextField, TextareaField } from '@runly/ui'
import { SupplierField } from '../SupplierField.jsx'
import { CURRENCY_OPTIONS, PRIORITY_OPTIONS } from '../../lib/purchases-constants.js'

const dateCtl = (control, name, label, props = {}) => (
  <Controller control={control} name={name} render={({ field, fieldState }) => (
    <DateField label={label} value={field.value ?? ''} onChange={(e) => field.onChange(e.target.value)} error={fieldState.error?.message} {...props} />
  )} />
)
const currencyCtl = (control) => (
  <Controller control={control} name="currency" render={({ field }) => (
    <SelectField label="Moneda" options={CURRENCY_OPTIONS} value={field.value} onValueChange={field.onChange} />
  )} />
)
const supplierCtl = (control, supplier, onSupplier) => (
  <Controller control={control} name="supplierId" render={({ field, fieldState }) => (
    <SupplierField required value={field.value} selected={supplier} error={fieldState.error?.message}
      onChange={(id, row) => { field.onChange(id); onSupplier?.(row) }} />
  )} />
)
const text = (control, name, label, props = {}) => (
  <Controller control={control} name={name} render={({ field, fieldState }) => (
    <TextField label={label} error={fieldState.error?.message} {...props} {...field} value={field.value ?? ''} />
  )} />
)

// Document header per kind. Each field uses the input that fits its data.
export function HeaderFields({ kind, control, supplier, onSupplier }) {
  if (kind === 'requests') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">{text(control, 'title', 'Qué se necesita', { required: true, placeholder: 'Tres laptops para el equipo de ventas' })}</div>
        <div className="md:col-span-2">
          <Controller control={control} name="priority" render={({ field }) => (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-[hsl(var(--foreground))]/80">Prioridad</p>
              <SegmentedControl ariaLabel="Prioridad" options={PRIORITY_OPTIONS} value={field.value} onChange={field.onChange} />
            </div>
          )} />
        </div>
        {dateCtl(control, 'neededBy', 'Se necesita para')}
        {currencyCtl(control)}
        <div className="md:col-span-2">
          <Controller control={control} name="justification" render={({ field }) => (
            <TextareaField label="Justificación" rows={3} placeholder="Para qué se usará y qué pasa si no se compra." {...field} value={field.value ?? ''} maxLength={2000} />
          )} />
        </div>
      </div>
    )
  }

  if (kind === 'invoices') {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">{supplierCtl(control, supplier, onSupplier)}</div>
        {text(control, 'number', 'Folio de la factura', { required: true, placeholder: 'A-10293' })}
        {text(control, 'fiscalUuid', 'UUID fiscal (CFDI)', { placeholder: '36 caracteres', hint: 'Opcional' })}
        {dateCtl(control, 'issueDate', 'Fecha de emisión', { required: true })}
        {dateCtl(control, 'dueDate', 'Vence el', { hint: 'Para saber qué está por pagar' })}
        {currencyCtl(control)}
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">{supplierCtl(control, supplier, onSupplier)}</div>
      {dateCtl(control, 'issueDate', 'Fecha de la orden', { required: true })}
      {dateCtl(control, 'expectedDate', 'Entrega esperada')}
      {text(control, 'supplierReference', 'Referencia del proveedor', { placeholder: 'Cotización o pedido del proveedor' })}
      {text(control, 'paymentTerms', 'Condiciones de pago', { placeholder: 'Crédito 30 días' })}
      {currencyCtl(control)}
    </div>
  )
}
