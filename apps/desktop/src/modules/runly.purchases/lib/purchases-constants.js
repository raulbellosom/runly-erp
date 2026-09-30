import {
  BadgeCheck, CircleDollarSign, ClipboardList, FileQuestion, FileStack, Flag, Link2, PackageCheck, ReceiptText, Scale,
} from 'lucide-react'

export const BASE = '/app/m/runly.purchases'
export const ROOT = `${BASE}/purchases`
export const INVENTORY_BASE = '/app/m/runly.inventory/inventory'

// Visual identity (spec section 9). Tones are hex so they work inside inline
// gradients and recharts fills in both themes.
export const TONES = {
  teal: '#0f766e',
  deep: '#115e59',
  petrol: '#0c4a6e',
  emerald: '#10b981',
  amber: '#d97706',
  rose: '#e11d48',
  slate: '#64748b',
  sky: '#0284c7',
  violet: '#7c3aed',
}
export const HERO_GRADIENT = 'linear-gradient(135deg, #0f766e 0%, #115e59 48%, #0c4a6e 100%)'

// tone -> pill classes (light + dark)
export const TONE_PILL = {
  slate: 'bg-slate-500/10 text-slate-700 ring-slate-500/25 dark:text-slate-300',
  teal: 'bg-teal-500/10 text-teal-700 ring-teal-500/30 dark:text-teal-300',
  sky: 'bg-sky-500/10 text-sky-700 ring-sky-500/30 dark:text-sky-300',
  violet: 'bg-violet-500/10 text-violet-700 ring-violet-500/30 dark:text-violet-300',
  amber: 'bg-amber-500/12 text-amber-800 ring-amber-500/35 dark:text-amber-300',
  emerald: 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300',
  rose: 'bg-rose-500/10 text-rose-700 ring-rose-500/30 dark:text-rose-300',
}

const S = (label, tone) => ({ label, tone })
export const STATUS = {
  orders: {
    DRAFT: S('Borrador', 'slate'), PENDING_APPROVAL: S('Por aprobar', 'amber'), APPROVED: S('Aprobada', 'sky'),
    ISSUED: S('Emitida', 'teal'), PARTIALLY_RECEIVED: S('Recibida parcial', 'violet'), RECEIVED: S('Recibida', 'emerald'),
    CLOSED: S('Cerrada', 'emerald'), CANCELLED: S('Cancelada', 'rose'),
  },
  invoices: {
    DRAFT: S('Borrador', 'slate'), PENDING_APPROVAL: S('Por aprobar', 'amber'), PENDING: S('Por pagar', 'amber'),
    PARTIALLY_PAID: S('Pago parcial', 'violet'), PAID: S('Pagada', 'emerald'), CANCELLED: S('Cancelada', 'rose'),
  },
  requests: {
    DRAFT: S('Borrador', 'slate'), SUBMITTED: S('Enviada', 'sky'), APPROVED: S('Aprobada', 'emerald'),
    REJECTED: S('Rechazada', 'rose'), ORDERED: S('Ordenada', 'teal'), CANCELLED: S('Cancelada', 'rose'),
  },
  quotes: { RECEIVED: S('Recibida', 'sky'), SELECTED: S('Elegida', 'emerald'), DISCARDED: S('Descartada', 'slate') },
  receipts: { DRAFT: S('Borrador', 'slate'), COMPLETED: S('Completada', 'emerald'), CANCELLED: S('Cancelada', 'rose') },
  cases: { OPEN: S('Abierto', 'sky'), IN_PROGRESS: S('En proceso', 'teal'), CLOSED: S('Cerrado', 'emerald'), CANCELLED: S('Cancelado', 'rose') },
  approvals: { PENDING: S('Pendiente', 'amber'), APPROVED: S('Aprobada', 'emerald'), REJECTED: S('Rechazada', 'rose') },
}
export const statusMeta = (kind, status) => STATUS[kind]?.[status] ?? { label: status ?? 'Sin estado', tone: 'slate' }

// Workflow stages, in canonical order. `capability` decides visibility.
export const STAGES = {
  REQUEST: { label: 'Solicitud', icon: FileQuestion, capability: 'requests' },
  QUOTES: { label: 'Cotizaciones', icon: Scale, capability: 'quotes' },
  APPROVAL: { label: 'Aprobación', icon: BadgeCheck, capability: 'approvals' },
  PURCHASE_ORDER: { label: 'Orden', icon: ClipboardList, capability: 'purchaseOrders' },
  RECEIPT: { label: 'Recepción', icon: PackageCheck, capability: 'receipts' },
  INVOICE: { label: 'Factura', icon: ReceiptText, capability: 'invoices' },
  PAYMENT: { label: 'Pago', icon: CircleDollarSign, capability: 'payments' },
  RELATE: { label: 'Relacionar', icon: Link2, capability: 'inventoryRelations' },
  CLOSE: { label: 'Cierre', icon: Flag, capability: null },
}
export const STAGE_ORDER = Object.keys(STAGES)
export const stageMeta = (type) => STAGES[type] ?? { label: type, icon: FileStack, capability: null }

export const MODE_OPTIONS = [
  { value: 'REQUIRED', label: 'Obligatoria' },
  { value: 'CONDITIONAL', label: 'Condicional' },
  { value: 'OPTIONAL', label: 'Opcional' },
  { value: 'DISABLED', label: 'No se usa' },
]

export const CAPABILITIES = [
  { key: 'requests', label: 'Solicitudes', description: 'Las áreas piden lo que necesitan antes de comprar.' },
  { key: 'quotes', label: 'Cotizaciones', description: 'Compara propuestas de varios proveedores.' },
  { key: 'approvals', label: 'Aprobaciones', description: 'Un responsable autoriza antes de emitir o pagar.' },
  { key: 'purchaseOrders', label: 'Órdenes de compra', description: 'Formaliza el compromiso con el proveedor.' },
  { key: 'receipts', label: 'Recepciones', description: 'Registra lo que llegó, aunque sea parcial.' },
  { key: 'invoices', label: 'Facturas', description: 'Comprobantes del proveedor y su saldo.' },
  { key: 'payments', label: 'Pagos', description: 'Estado de pago y referencias, sin contabilidad.' },
  { key: 'inventoryRelations', label: 'Integración con Inventario', description: 'Relaciona compras con activos.' },
]

export const PRESETS = [
  { key: 'SIMPLE', name: 'Simple', description: 'Registras la factura y la relacionas con tus activos.' },
  { key: 'BASIC', name: 'Básico', description: 'Orden de compra, factura y cierre.' },
  { key: 'INVENTORY', name: 'Compras + Inventario', description: 'Orden, recepción de mercancía, factura y cierre.' },
  { key: 'COMPLETE', name: 'Completo', description: 'Solicitud, cotizaciones, aprobación, orden, recepción, factura y pago.' },
  { key: 'CUSTOM', name: 'Personalizado', description: 'Tú decides qué etapas se usan y cuándo son obligatorias.' },
]

export const CURRENCY_OPTIONS = [
  { value: 'MXN', label: 'MXN, peso mexicano' },
  { value: 'USD', label: 'USD, dólar estadounidense' },
  { value: 'EUR', label: 'EUR, euro' },
]
export const TAX_RATE_OPTIONS = [
  { value: '0.16', label: 'IVA 16%' },
  { value: '0.08', label: 'IVA 8% (frontera)' },
  { value: '0', label: 'Tasa 0% o exento' },
]
export const PRIORITY_OPTIONS = [
  { value: 'LOW', label: 'Baja' }, { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'Alta' }, { value: 'URGENT', label: 'Urgente' },
]
export const ITEM_KIND_OPTIONS = [{ value: 'GOODS', label: 'Bien' }, { value: 'SERVICE', label: 'Servicio' }]
export const UNIT_OPTIONS = ['pza', 'caja', 'kg', 'lt', 'm', 'hr', 'servicio', 'lote'].map(value => ({ value, label: value }))
export const PAYMENT_METHODS = [
  { value: 'TRANSFER', label: 'Transferencia' }, { value: 'CARD', label: 'Tarjeta' },
  { value: 'CHECK', label: 'Cheque' }, { value: 'CASH', label: 'Efectivo' }, { value: 'OTHER', label: 'Otro' },
]
export const ORIGIN_LABELS = { MANUAL: 'Manual', INHERITED: 'Heredada', AUTOMATIC: 'Automática', MIGRATED: 'Migrada' }

// Per document kind: routing, permissions, capability and audit entity type.
export const KINDS = {
  orders: {
    singular: 'Orden de compra', plural: 'Órdenes de compra', short: 'Orden', icon: ClipboardList, capability: 'purchaseOrders',
    entityType: 'purchase_order', read: 'purchases.order.read', create: 'purchases.order.create', update: 'purchases.order.update',
    newLabel: 'Nueva orden',
  },
  invoices: {
    singular: 'Factura de proveedor', plural: 'Facturas', short: 'Factura', icon: ReceiptText, capability: 'invoices',
    entityType: 'purchase_invoice', read: 'purchases.invoice.read', create: 'purchases.invoice.create', update: 'purchases.invoice.update',
    newLabel: 'Registrar factura',
  },
  requests: {
    singular: 'Solicitud de compra', plural: 'Solicitudes', short: 'Solicitud', icon: FileQuestion, capability: 'requests',
    entityType: 'purchase_request', read: 'purchases.request.read', create: 'purchases.request.create', update: 'purchases.request.update',
    newLabel: 'Nueva solicitud',
  },
  receipts: {
    singular: 'Recepción', plural: 'Recepciones', short: 'Recepción', icon: PackageCheck, capability: 'receipts',
    entityType: 'purchase_receipt', read: 'purchases.receipt.read', create: 'purchases.receipt.create', update: 'purchases.receipt.create',
  },
  cases: {
    singular: 'Expediente', plural: 'Expedientes', short: 'Expediente', icon: FileStack, capability: null,
    entityType: 'purchase_case', read: 'purchases.case.read', create: 'purchases.case.manage', update: 'purchases.case.manage',
    newLabel: 'Nuevo expediente',
  },
  quotes: {
    singular: 'Cotización', plural: 'Cotizaciones', short: 'Cotización', icon: Scale, capability: 'quotes',
    entityType: 'purchase_quote', read: 'purchases.quote.read', create: 'purchases.quote.manage', update: 'purchases.quote.manage',
  },
}

// Entity type (relations, stage refs) -> route segment.
export const TYPE_TO_KIND = {
  purchase_order: 'orders', PURCHASE_ORDER: 'orders', order: 'orders',
  purchase_invoice: 'invoices', PURCHASE_INVOICE: 'invoices', invoice: 'invoices',
  purchase_request: 'requests', PURCHASE_REQUEST: 'requests', request: 'requests',
  purchase_receipt: 'receipts', PURCHASE_RECEIPT: 'receipts', receipt: 'receipts',
  purchase_case: 'cases', PURCHASE_CASE: 'cases', case: 'cases',
  purchase_quote: 'quotes', PURCHASE_QUOTE: 'quotes', quote: 'quotes',
  ORDER: 'orders', INVOICE: 'invoices', REQUEST: 'requests', RECEIPT: 'receipts', CASE: 'cases', QUOTE: 'quotes',
  orders: 'orders', invoices: 'invoices', requests: 'requests', receipts: 'receipts', cases: 'cases', quotes: 'quotes',
}
export const kindOf = (type) => TYPE_TO_KIND[type] ?? TYPE_TO_KIND[String(type ?? '').toLowerCase()] ?? null
// API paths are module-relative ('/purchases/orders/<id>', '/inventory/<id>').
export const toAppPath = (path, module = 'runly.purchases') => {
  if (!path) return null
  if (path.startsWith('/app/')) return path
  return `/app/m/${module}${path.startsWith('/') ? path : `/${path}`}`
}
export const docPath = (type, id) => {
  const kind = TYPE_TO_KIND[type] ?? type
  if (kind === 'quotes') return null
  return `${ROOT}/${kind}/${id}`
}
