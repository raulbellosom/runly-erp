import { STATUS } from './purchases-constants.js'

const chips = (kind, keys) => [{ value: 'ALL', label: 'Todos' }, ...keys.map((key) => ({ value: key, label: STATUS[kind][key].label }))]

// One list screen, many sections. `kind` is the API collection; `columns`
// names the column builders in components/DocumentColumns.jsx.
export const LIST_SECTIONS = {
  orders: {
    kind: 'orders', title: 'Órdenes de compra', capability: 'purchaseOrders',
    description: 'Compromisos con tus proveedores, de la emisión a la recepción.',
    chips: chips('orders', ['DRAFT', 'PENDING_APPROVAL', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED']),
    columns: ['folio', 'issueDate', 'expectedDate', 'status', 'total'],
    supplierFilter: true, emptyTitle: 'Aún no hay órdenes', emptyDescription: 'Crea una orden para formalizar una compra con tu proveedor.',
  },
  invoices: {
    kind: 'invoices', title: 'Facturas de proveedor', capability: 'invoices',
    description: 'Comprobantes recibidos, su saldo y las órdenes que cubren.',
    chips: [...chips('invoices', ['DRAFT', 'PENDING_APPROVAL', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED']), { value: 'OVERDUE', label: 'Vencidas', params: { overdue: 'true' } }],
    columns: ['folio', 'issueDate', 'dueDate', 'status', 'total', 'balance'],
    supplierFilter: true, emptyTitle: 'Aún no hay facturas', emptyDescription: 'Registra la factura de un proveedor para darle seguimiento.',
  },
  requests: {
    kind: 'requests', title: 'Solicitudes de compra', capability: 'requests',
    description: 'Lo que las áreas necesitan, antes de convertirse en orden.',
    chips: chips('requests', ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED']),
    columns: ['request', 'neededBy', 'priority', 'status', 'estimatedTotal'],
    supplierFilter: false, emptyTitle: 'Aún no hay solicitudes', emptyDescription: 'Una solicitud describe qué se necesita y para cuándo.',
  },
  receipts: {
    kind: 'receipts', title: 'Recepciones', capability: 'receipts',
    description: 'Mercancía recibida contra órdenes, incluso en entregas parciales.',
    chips: chips('receipts', ['DRAFT', 'COMPLETED', 'CANCELLED']),
    columns: ['folio', 'order', 'receivedAt', 'status'],
    supplierFilter: true, emptyTitle: 'Aún no hay recepciones', emptyDescription: 'Registra una recepción desde el detalle de una orden emitida.',
  },
  cases: {
    kind: 'cases', title: 'Expedientes', capability: null,
    description: 'Cada compra de principio a fin: solicitud, cotizaciones, orden, factura y pago.',
    chips: chips('cases', ['OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED']),
    columns: ['caseTitle', 'createdAt', 'status', 'estimatedTotal'],
    supplierFilter: true, emptyTitle: 'Aún no hay expedientes', emptyDescription: 'Los expedientes se crean solos al registrar documentos, o puedes abrir uno.',
  },
  payments: {
    kind: 'invoices', title: 'Pagos', capability: 'payments',
    description: 'Facturas por pagar, pagos parciales y lo ya liquidado.',
    chips: [
      { value: 'OPEN', label: 'Por pagar', params: { status: 'PENDING,PARTIALLY_PAID' } },
      { value: 'OVERDUE', label: 'Vencidas', params: { overdue: 'true' } },
      { value: 'PAID', label: 'Pagadas', params: { status: 'PAID' } },
      { value: 'ALL', label: 'Todas', params: { status: 'PENDING,PARTIALLY_PAID,PAID' } },
    ],
    defaultStatus: 'OPEN',
    columns: ['folio', 'dueDate', 'status', 'total', 'paid', 'balance'],
    supplierFilter: true, emptyTitle: 'Nada en esta vista', emptyDescription: 'Las facturas aparecen aquí cuando quedan por pagar.',
  },
}
