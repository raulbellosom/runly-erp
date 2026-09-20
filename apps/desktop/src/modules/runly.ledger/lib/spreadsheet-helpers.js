// apps/desktop/src/modules/runly.ledger/lib/spreadsheet-helpers.js
import { toLocalIso } from '../../../lib/localDate.js'

export const EDITABLE_COLS = ['fecha', 'tipo_id', 'numero', 'nombre', 'referencia', 'concepto', 'deposito', 'retiro', 'category_id']
export const PAGE_STEP = 200

export function fmtDecimal(value) {
  if (value == null || value === '') return ''
  const amount = Number(value)
  return Number.isFinite(amount)
    ? amount.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : ''
}

export function toDateValue(value) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

export function emptyRow(accountId) {
  return {
    _isNew: true,
    _dirty: false,
    id: null,
    account_id: accountId,
    fecha: toLocalIso(),
    tipo_id: null,
    numero: '',
    nombre: '',
    referencia: '',
    concepto: '',
    deposito: '',
    retiro: '',
    category_id: null,
  }
}

export function buildTransactionPayload(draft, { onError } = {}) {
  const deposito = draft.deposito !== '' && draft.deposito != null ? Number(draft.deposito) : null
  const retiro = draft.retiro !== '' && draft.retiro != null ? Number(draft.retiro) : null
  if (!draft.nombre?.trim()) {
    onError?.('El campo Nombre es obligatorio.')
    return null
  }
  if (!deposito && !retiro) {
    onError?.('Se requiere deposito o retiro mayor a cero.')
    return null
  }
  return {
    fecha: toDateValue(draft.fecha),
    tipo_id: draft.tipo_id || null,
    numero: draft.numero || null,
    nombre: draft.nombre.trim(),
    referencia: draft.referencia || null,
    concepto: draft.concepto || null,
    deposito,
    retiro,
    category_id: draft.category_id || null,
  }
}
