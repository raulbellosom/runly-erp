// Which actions a document offers, given its status, the company's
// capabilities and the user's permissions. Hidden, not disabled: the backend
// enforces the same rules (spec section 6).
//   type: transition | edit | dialog | navigate
//   confirm: { title, description, comment } asks before a destructive step

const cancel = (noun) => ({
  key: 'cancel', type: 'transition', action: 'cancel', label: 'Cancelar', tone: 'danger',
  confirm: { title: `Cancelar ${noun}`, description: 'El documento queda cancelado y deja de contar en el proceso. Esta acción no se puede deshacer.', comment: true, confirmLabel: 'Cancelar documento' },
})
const reject = (noun) => ({
  key: 'reject', type: 'transition', action: 'reject', label: 'Rechazar', tone: 'danger',
  confirm: { title: `Rechazar ${noun}`, description: 'Explica el motivo para que quien la preparó pueda corregirla.', comment: true, confirmLabel: 'Rechazar' },
})
const approve = { key: 'approve', type: 'transition', action: 'approve', label: 'Aprobar', tone: 'primary' }
const edit = { key: 'edit', type: 'edit', label: 'Editar borrador', tone: 'secondary' }

export function getDocumentActions(kind, doc, { has, can }) {
  if (!doc) return []
  const s = doc.status
  const out = []
  const decide = has('approvals') && can('purchases.approval.decide')

  if (kind === 'orders') {
    const update = can('purchases.order.update')
    if (s === 'DRAFT' && update) out.push({ key: 'submit', type: 'transition', action: 'submit', label: 'Enviar', tone: 'primary' }, edit)
    if (s === 'PENDING_APPROVAL' && decide) out.push(approve, reject('la orden'))
    if (s === 'APPROVED' && update) out.push({ key: 'issue', type: 'transition', action: 'issue', label: 'Emitir al proveedor', tone: 'primary' })
    if (['ISSUED', 'PARTIALLY_RECEIVED'].includes(s) && has('receipts') && can('purchases.receipt.create')) {
      out.push({ key: 'receive', type: 'dialog', dialog: 'receive', label: 'Registrar recepción', tone: 'primary' })
    }
    if (['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(s) && has('invoices') && can('purchases.invoice.create')) {
      out.push({ key: 'invoice', type: 'navigate', to: `invoices/new?orderId=${doc.id}`, label: 'Registrar factura', tone: 'secondary' })
    }
    if (['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'].includes(s) && update) {
      out.push({ key: 'close', type: 'transition', action: 'close', label: 'Cerrar orden', tone: 'secondary',
        confirm: { title: 'Cerrar la orden', description: 'Una orden cerrada ya no espera más entregas ni facturas.', confirmLabel: 'Cerrar orden' } })
    }
    if (['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED'].includes(s) && update) out.push(cancel('la orden'))
  }

  if (kind === 'invoices') {
    const update = can('purchases.invoice.update')
    if (s === 'DRAFT' && update) out.push({ key: 'submit', type: 'transition', action: 'submit', label: 'Registrar', tone: 'primary' }, edit)
    if (s === 'PENDING_APPROVAL' && decide) out.push(approve, reject('la factura'))
    if (['PENDING', 'PARTIALLY_PAID'].includes(s) && has('payments') && can('purchases.payment.manage')) {
      out.push({ key: 'pay', type: 'dialog', dialog: 'pay', label: 'Registrar pago', tone: 'primary' })
    }
    if (['DRAFT', 'PENDING_APPROVAL', 'PENDING'].includes(s) && update) out.push(cancel('la factura'))
  }

  if (kind === 'requests') {
    const update = can('purchases.request.update')
    if (s === 'DRAFT' && update) out.push({ key: 'submit', type: 'transition', action: 'submit', label: 'Enviar solicitud', tone: 'primary' }, edit)
    if (s === 'SUBMITTED' && (decide || (!has('approvals') && update))) out.push(approve, reject('la solicitud'))
    if (s === 'APPROVED' && has('purchaseOrders') && can('purchases.order.create')) {
      out.push({ key: 'convert', type: 'transition', action: 'convert', label: 'Crear orden de compra', tone: 'primary', opensResult: 'orders' })
    }
    if (['DRAFT', 'SUBMITTED', 'APPROVED'].includes(s) && update) out.push(cancel('la solicitud'))
  }

  if (kind === 'cases' && can('purchases.case.manage')) {
    if (['OPEN', 'IN_PROGRESS'].includes(s)) {
      out.push({ key: 'close', type: 'transition', action: 'close', label: 'Cerrar expediente', tone: 'primary',
        confirm: { title: 'Cerrar el expediente', description: 'Se valida que las etapas obligatorias estén completas.', confirmLabel: 'Cerrar expediente' } })
      out.push(cancel('el expediente'))
    }
    if (['CLOSED', 'CANCELLED'].includes(s)) out.push({ key: 'reopen', type: 'transition', action: 'reopen', label: 'Reabrir', tone: 'secondary' })
  }

  return out
}
