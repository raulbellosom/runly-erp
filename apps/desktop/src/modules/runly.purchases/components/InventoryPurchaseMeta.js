// Presentation metadata for the inventory "Compras relacionadas" section.
// Kept local so the section does not depend on the purchases screens' lib.
import { ClipboardCheck, ClipboardList, FolderOpen, PackageCheck, ReceiptText, Wallet } from 'lucide-react'

export const PURCHASES_BASE_PATH = '/app/m/runly.purchases/purchases'

// Stage keys the summary endpoint may return, with a label fallback and icon.
export const STAGE_META = {
  CASE: { label: 'Expediente', icon: FolderOpen },
  REQUEST: { label: 'Solicitud', icon: ClipboardCheck },
  PURCHASE_ORDER: { label: 'Orden de compra', icon: ClipboardList },
  ORDER: { label: 'Orden de compra', icon: ClipboardList },
  RECEIPT: { label: 'Recepción', icon: PackageCheck },
  INVOICE: { label: 'Factura', icon: ReceiptText },
  PAYMENT: { label: 'Pago', icon: Wallet },
}
export const STAGE_ORDER = ['CASE', 'REQUEST', 'PURCHASE_ORDER', 'ORDER', 'RECEIPT', 'INVOICE', 'PAYMENT']

export const ORIGIN_LABELS = { MANUAL: 'Manual', INHERITED: 'Heredada', AUTOMATIC: 'Automática', MIGRATED: 'Migrada' }

const TONES = {
  neutral: 'bg-slate-500/10 text-slate-700 ring-slate-500/20 dark:text-slate-300',
  info: 'bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300',
  teal: 'bg-teal-500/10 text-teal-700 ring-teal-500/25 dark:text-teal-300',
  success: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300',
  warning: 'bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300',
  danger: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300',
}

const STATUS = {
  DRAFT: ['Borrador', 'neutral'],
  SUBMITTED: ['Enviada', 'info'],
  PENDING_APPROVAL: ['Por aprobar', 'warning'],
  APPROVED: ['Aprobada', 'info'],
  REJECTED: ['Rechazada', 'danger'],
  ORDERED: ['Ordenada', 'success'],
  ISSUED: ['Emitida', 'teal'],
  PARTIALLY_RECEIVED: ['Recepción parcial', 'warning'],
  RECEIVED: ['Recibida', 'success'],
  COMPLETED: ['Completada', 'success'],
  PENDING: ['Por pagar', 'warning'],
  PARTIALLY_PAID: ['Pago parcial', 'warning'],
  PAID: ['Pagada', 'success'],
  OPEN: ['Abierto', 'teal'],
  IN_PROGRESS: ['En curso', 'info'],
  CLOSED: ['Cerrada', 'neutral'],
  CANCELLED: ['Cancelada', 'danger'],
}

export function statusMeta(status) {
  const [label, tone] = STATUS[status] ?? [status ? String(status).replaceAll('_', ' ').toLowerCase() : 'Sin estado', 'neutral']
  return { label, className: TONES[tone] }
}

export function formatMoney(value, currency) {
  const amount = Number(value ?? 0)
  try {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: currency || 'MXN' }).format(Number.isFinite(amount) ? amount : 0)
  } catch {
    return `${amount.toFixed(2)} ${currency ?? ''}`.trim()
  }
}

// Date-only values render as their calendar day (no timezone shift).
export function formatDay(value) {
  if (!value) return ''
  const [y, m, d] = String(value).slice(0, 10).split('-')
  if (!y || !m || !d) return ''
  return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

const KIND_BY_TYPE = {
  purchase_case: 'cases',
  purchase_request: 'requests',
  purchase_order: 'orders',
  purchase_receipt: 'receipts',
  purchase_invoice: 'invoices',
}

// The summary returns `path`; accept it app-absolute or module-relative and
// fall back to building it from the document type.
export function documentHref(doc) {
  const path = doc?.path
  if (typeof path === 'string' && path) {
    if (path.startsWith('/app/')) return path
    if (path.startsWith('/purchases')) return `/app/m/runly.purchases${path}`
  }
  const kind = KIND_BY_TYPE[doc?.type]
  return kind && doc?.id ? `${PURCHASES_BASE_PATH}/${kind}/${doc.id}` : null
}

export function hasPermission(userProfile, key) {
  return Boolean(userProfile?.isAdmin || userProfile?.permissions?.includes(key))
}
