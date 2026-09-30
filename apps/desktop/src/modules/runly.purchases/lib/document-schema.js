import { z } from 'zod'
import { computeTotals, emptyLine, lineFromApi, linesToPayload } from './document-math.js'
import { dateInput, today } from './format.js'

const line = z.object({
  id: z.string().optional(),
  description: z.string().max(500),
  itemKind: z.enum(['GOODS', 'SERVICE']),
  quantity: z.coerce.number().positive('Mayor a 0'),
  unit: z.string().max(20).nullable().optional(),
  unitAmount: z.coerce.number().min(0, 'No negativo'),
  taxRate: z.string(),
  inventoryCategoryId: z.string().nullable().optional(),
})
// Concept text is optional; empty rows (no text, no amount) are dropped on save.
const lines = z.array(line)
const optionalDate = z.string().optional().nullable()

const base = {
  currency: z.string().length(3),
  notes: z.string().max(2000).optional().nullable(),
  lines,
  inventoryIds: z.array(z.string()),
  caseId: z.string().nullable().optional(),
}

export const SCHEMAS = {
  orders: z.object({
    ...base,
    supplierId: z.string({ error: 'Elige un proveedor' }).min(1, 'Elige un proveedor'),
    issueDate: z.string().min(1, 'Indica la fecha'),
    expectedDate: optionalDate,
    supplierReference: z.string().max(100).optional().nullable(),
    paymentTerms: z.string().max(120).optional().nullable(),
    requestId: z.string().nullable().optional(),
  }).refine((v) => !v.expectedDate || v.expectedDate >= v.issueDate, { path: ['expectedDate'], message: 'La entrega no puede ser antes de la orden' }),
  invoices: z.object({
    ...base,
    supplierId: z.string({ error: 'Elige un proveedor' }).min(1, 'Elige un proveedor'),
    number: z.string().trim().min(1, 'Captura el folio de la factura').max(100),
    fiscalUuid: z.string().trim().max(36).regex(/^$|^[0-9a-fA-F-]{36}$/, 'El UUID fiscal tiene 36 caracteres').optional().nullable(),
    issueDate: z.string().min(1, 'Indica la fecha'),
    dueDate: optionalDate,
    orderIds: z.array(z.string()),
    inheritItems: z.boolean(),
  }).refine((v) => !v.dueDate || v.dueDate >= v.issueDate, { path: ['dueDate'], message: 'El vencimiento no puede ser antes de la emisión' }),
  requests: z.object({
    ...base,
    title: z.string().trim().min(3, 'Describe la necesidad').max(255),
    justification: z.string().max(2000).optional().nullable(),
    neededBy: optionalDate,
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  }),
}

export function defaultsFor(kind, { doc, inventoryIds = [], caseId = null, requestId = null } = {}) {
  const common = {
    currency: doc?.currency ?? 'MXN',
    notes: doc?.notes ?? '',
    lines: doc?.lines?.length ? doc.lines.map(lineFromApi) : [emptyLine()],
    inventoryIds,
    caseId: doc?.caseId ?? caseId,
  }
  if (kind === 'orders') {
    return {
      ...common, supplierId: doc?.supplierId ?? null, issueDate: dateInput(doc?.issueDate) || today(),
      expectedDate: dateInput(doc?.expectedDate), supplierReference: doc?.supplierReference ?? '', paymentTerms: doc?.paymentTerms ?? '',
      requestId: doc?.requestId ?? requestId,
    }
  }
  if (kind === 'invoices') {
    return {
      ...common, supplierId: doc?.supplierId ?? null, number: doc?.number ?? '', fiscalUuid: doc?.fiscalUuid ?? '',
      issueDate: dateInput(doc?.issueDate) || today(), dueDate: dateInput(doc?.dueDate),
      orderIds: (doc?.orders ?? []).map((o) => o.id), inheritItems: true,
    }
  }
  return {
    ...common, title: doc?.title ?? '', justification: doc?.justification ?? '', neededBy: dateInput(doc?.neededBy),
    priority: doc?.priority ?? 'NORMAL',
  }
}

const blankToNull = (value) => (value === '' || value === undefined ? null : value)

// Form values -> POST/PATCH body. Totals are computed here and re-validated by the API.
export function toPayload(kind, values, { isEdit } = {}) {
  const totals = computeTotals(values.lines)
  const body = {
    currency: values.currency,
    notes: blankToNull(values.notes),
    lines: linesToPayload(values.lines),
    subtotal: totals.subtotal,
    tax: totals.tax,
    total: totals.total,
    ...(values.caseId ? { caseId: values.caseId } : {}),
    ...(!isEdit && values.inventoryIds.length ? { inventoryIds: values.inventoryIds } : {}),
  }
  if (kind === 'orders') {
    return {
      ...body, supplierId: values.supplierId, issueDate: values.issueDate, expectedDate: blankToNull(values.expectedDate),
      supplierReference: blankToNull(values.supplierReference), paymentTerms: blankToNull(values.paymentTerms),
      ...(values.requestId ? { requestId: values.requestId } : {}),
    }
  }
  if (kind === 'invoices') {
    return {
      ...body, supplierId: values.supplierId, number: values.number.trim(), fiscalUuid: blankToNull(values.fiscalUuid?.trim()),
      issueDate: values.issueDate, dueDate: blankToNull(values.dueDate), orderIds: values.orderIds,
      inheritItems: values.orderIds.length ? values.inheritItems : false,
    }
  }
  return {
    ...body, title: values.title.trim(), justification: blankToNull(values.justification), neededBy: blankToNull(values.neededBy),
    priority: values.priority, estimatedTotal: totals.total,
  }
}
