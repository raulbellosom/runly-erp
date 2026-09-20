// apps/desktop/src/modules/runly.ledger/components/MobileTransactionSheet.jsx
import {
  Button,
  Sheet, SheetContent, SheetHeader, SheetTitle,
  TextField, NumberField, SelectField, DatePickerField,
} from '@runly/ui'
import { toDateValue } from '../lib/spreadsheet-helpers.js'

export default function MobileTransactionSheet({
  mobileSheet, onOpenChange, onFieldChange, onSubmit, types, categories, isSaving,
}) {
  return (
    <Sheet open={!!mobileSheet} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mobileSheet?.mode === 'new' ? 'Nuevo movimiento' : 'Editar movimiento'}</SheetTitle>
        </SheetHeader>
        {mobileSheet && (
          <form onSubmit={onSubmit} className="space-y-3 pt-4 pb-2">
            <DatePickerField
              label="Fecha"
              value={toDateValue(mobileSheet.draft.fecha) || undefined}
              onChange={(val) => onFieldChange('fecha', val ?? '')}
            />
            <TextField
              label="Nombre"
              required
              value={mobileSheet.draft.nombre ?? ''}
              onChange={(e) => onFieldChange('nombre', e.target.value)}
              maxLength={255}
            />
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Ingreso"
                value={mobileSheet.draft.deposito ?? ''}
                onChange={(e) => onFieldChange('deposito', e.target.value)}
                min={0}
                step="0.01"
              />
              <NumberField
                label="Egreso"
                value={mobileSheet.draft.retiro ?? ''}
                onChange={(e) => onFieldChange('retiro', e.target.value)}
                min={0}
                step="0.01"
              />
            </div>
            <SelectField
              label="Tipo"
              value={mobileSheet.draft.tipo_id ?? '__none__'}
              onValueChange={(val) => onFieldChange('tipo_id', val === '__none__' ? null : val)}
              options={[{ value: '__none__', label: 'Sin tipo' }, ...types.map((t) => ({ value: t.id, label: t.code }))]}
            />
            <SelectField
              label="Categoria"
              value={mobileSheet.draft.category_id ?? '__none__'}
              onValueChange={(val) => onFieldChange('category_id', val === '__none__' ? null : val)}
              options={[
                { value: '__none__', label: 'Sin categoria' },
                ...categories.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
            <TextField
              label="Numero"
              value={mobileSheet.draft.numero ?? ''}
              onChange={(e) => onFieldChange('numero', e.target.value)}
              maxLength={64}
            />
            <TextField
              label="Referencia"
              value={mobileSheet.draft.referencia ?? ''}
              onChange={(e) => onFieldChange('referencia', e.target.value)}
              maxLength={255}
            />
            <TextField
              label="Concepto"
              value={mobileSheet.draft.concepto ?? ''}
              onChange={(e) => onFieldChange('concepto', e.target.value)}
              maxLength={512}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={isSaving}>
                {isSaving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </form>
        )}
      </SheetContent>
    </Sheet>
  )
}
