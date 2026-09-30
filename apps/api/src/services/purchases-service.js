// runly.purchases — settings, workflow, capabilities and dashboard.
// Document/procurement/receipt/relation/supplier logic lives in the sibling
// purchase-*-service.js files. Spec: docs/superpowers/specs/2026-09-30-purchases-core-redesign-design.md
import { toLocalIso } from '@runly/core'
import { STAGE_LABELS, STAGE_MODES, STAGE_ORDER, enabledStages } from './purchase-policies.js'
import {
  KINDS, PurchasesServiceError, broadcast, cleanText, dateKey, num, plain, supplierNames, writeAudit,
} from './purchases-shared.js'

export { PurchasesServiceError } from './purchases-shared.js'

export const CAPABILITY_KEYS = ['requests', 'quotes', 'approvals', 'purchaseOrders', 'receipts', 'invoices', 'payments', 'inventoryRelations']

const GOODS_RECEIPT_POLICY = {
  id: 'goods-receipt', label: 'Las compras de bienes requieren recepción',
  when: { metric: 'hasGoods', op: 'eq', value: true }, require: { stage: 'RECEIPT' },
}

export const PURCHASE_PRESETS = {
  SIMPLE: {
    capabilities: { requests: false, quotes: false, approvals: false, purchaseOrders: false, receipts: false, invoices: true, payments: false, inventoryRelations: true },
    stages: [{ type: 'INVOICE', mode: 'REQUIRED' }, { type: 'RELATE', mode: 'REQUIRED' }, { type: 'CLOSE', mode: 'REQUIRED' }],
    policies: [],
  },
  BASIC: {
    capabilities: { requests: false, quotes: false, approvals: false, purchaseOrders: true, receipts: false, invoices: true, payments: false, inventoryRelations: true },
    stages: [{ type: 'PURCHASE_ORDER', mode: 'REQUIRED' }, { type: 'INVOICE', mode: 'REQUIRED' }, { type: 'CLOSE', mode: 'REQUIRED' }],
    policies: [],
  },
  INVENTORY: {
    capabilities: { requests: false, quotes: false, approvals: false, purchaseOrders: true, receipts: true, invoices: true, payments: false, inventoryRelations: true },
    stages: [{ type: 'PURCHASE_ORDER', mode: 'REQUIRED' }, { type: 'RECEIPT', mode: 'CONDITIONAL' }, { type: 'INVOICE', mode: 'REQUIRED' }, { type: 'CLOSE', mode: 'REQUIRED' }],
    policies: [GOODS_RECEIPT_POLICY],
  },
  COMPLETE: {
    capabilities: { requests: true, quotes: true, approvals: true, purchaseOrders: true, receipts: true, invoices: true, payments: true, inventoryRelations: true },
    stages: [
      { type: 'REQUEST', mode: 'REQUIRED' }, { type: 'QUOTES', mode: 'CONDITIONAL' },
      { type: 'APPROVAL', mode: 'CONDITIONAL' }, { type: 'PURCHASE_ORDER', mode: 'REQUIRED' },
      { type: 'RECEIPT', mode: 'CONDITIONAL' }, { type: 'INVOICE', mode: 'REQUIRED' },
      { type: 'PAYMENT', mode: 'OPTIONAL' }, { type: 'CLOSE', mode: 'REQUIRED' },
    ],
    policies: [
      { id: 'approval-50k', label: 'Montos mayores a 50,000 requieren aprobación', when: { metric: 'total', op: 'gt', value: 50000 }, require: { stage: 'APPROVAL' } },
      { id: 'quotes-10k', label: 'Montos mayores a 10,000 requieren 3 cotizaciones', when: { metric: 'total', op: 'gt', value: 10000 }, require: { stage: 'QUOTES', min: 3 } },
      GOODS_RECEIPT_POLICY,
    ],
  },
}

// Sidebar entry -> capability gate (string, any-of array, or absent = always).
// Consumed by the /runtime/modules navigation filter in apps/api/src/index.js.
export const PURCHASES_NAV_CAPABILITY = {
  '/purchases/cases': ['requests', 'quotes', 'approvals'],
  '/purchases/requests': 'requests',
  '/purchases/approvals': 'approvals',
  '/purchases/orders': 'purchaseOrders',
  '/purchases/receipts': 'receipts',
  '/purchases/invoices': 'invoices',
  '/purchases/payments': 'payments',
}

export function hasCapability(capabilities = {}, gate) {
  if (!gate) return true
  const keys = Array.isArray(gate) ? gate : [gate]
  return keys.some(key => capabilities?.[key] === true)
}

export function isPurchasesNavVisible(path, capabilities) {
  return hasCapability(capabilities, PURCHASES_NAV_CAPABILITY[path])
}

function sanitizeCapabilities(input, fallback) {
  const source = input && typeof input === 'object' ? input : fallback
  return Object.fromEntries(CAPABILITY_KEYS.map(key => [key, Boolean(source?.[key])]))
}

function sanitizeStages(input, fallback) {
  if (!Array.isArray(input)) return fallback
  const seen = new Set()
  const stages = []
  for (const stage of input) {
    const type = String(stage?.type ?? '').toUpperCase()
    const mode = String(stage?.mode ?? 'OPTIONAL').toUpperCase()
    if (!STAGE_ORDER.includes(type) || seen.has(type)) continue
    if (!STAGE_MODES.includes(mode)) throw new PurchasesServiceError(`Modo no válido para la etapa ${STAGE_LABELS[type]}.`)
    seen.add(type)
    stages.push({ type, mode })
  }
  if (!seen.has('CLOSE')) stages.push({ type: 'CLOSE', mode: 'REQUIRED' })
  return stages.sort((a, b) => STAGE_ORDER.indexOf(a.type) - STAGE_ORDER.indexOf(b.type))
}

const METRICS = new Set(['total', 'hasGoods'])
const OPS = new Set(['gt', 'gte', 'lt', 'lte', 'eq', 'neq'])

function sanitizePolicies(input, fallback) {
  if (!Array.isArray(input)) return fallback
  return input.slice(0, 20).map((policy, index) => {
    const metric = policy?.when?.metric
    const op = policy?.when?.op ?? 'eq'
    const stage = String(policy?.require?.stage ?? '').toUpperCase()
    if (!METRICS.has(metric) || !OPS.has(op) || !STAGE_ORDER.includes(stage)) {
      throw new PurchasesServiceError('Una política de compras está incompleta o no es válida.')
    }
    const value = metric === 'total' ? Number(policy.when.value) : Boolean(policy.when.value)
    if (metric === 'total' && !Number.isFinite(value)) throw new PurchasesServiceError('El monto de la política no es válido.')
    const min = Number(policy.require.min)
    return {
      id: cleanText(policy.id, 60) || `p${index + 1}`,
      label: cleanText(policy.label, 200),
      when: { metric, op, value },
      require: { stage, ...(Number.isInteger(min) && min > 0 ? { min } : {}) },
    }
  })
}

export function createPurchasesService({ prisma, broadcaster }) {
  async function ensureWorkflow(companyId, actorId) {
    const current = await prisma.purchaseWorkflow.findFirst({
      where: { companyId, enabled: true, isDefault: true },
      orderBy: { createdAt: 'asc' },
    })
    if (current) return current
    return prisma.purchaseWorkflow.create({
      data: { companyId, name: 'Flujo básico', preset: 'BASIC', isDefault: true, ...PURCHASE_PRESETS.BASIC, createdById: actorId || null },
    })
  }

  async function getSettings(companyId, actorId) {
    return { workflow: await ensureWorkflow(companyId, actorId), presets: PURCHASE_PRESETS, stageLabels: STAGE_LABELS }
  }

  async function getCapabilities(companyId, actorId) {
    const workflow = await ensureWorkflow(companyId, actorId)
    return { capabilities: workflow.capabilities, stages: workflow.stages, preset: workflow.preset, policies: workflow.policies ?? [] }
  }

  // Throws 409 CAPABILITY_DISABLED unless the gate (key or any-of array) is on.
  async function assertCapability(companyId, gate, actorId) {
    const workflow = await ensureWorkflow(companyId, actorId)
    if (!hasCapability(workflow.capabilities, gate)) {
      throw new PurchasesServiceError('Esta función está deshabilitada en el flujo de compras.', 409, 'CAPABILITY_DISABLED')
    }
    return workflow
  }

  async function updateSettings(companyId, actorId, input = {}) {
    const workflow = await ensureWorkflow(companyId, actorId)
    const preset = String(input.preset || workflow.preset).toUpperCase()
    const presetValues = PURCHASE_PRESETS[preset]
    if (!presetValues && preset !== 'CUSTOM') throw new PurchasesServiceError('La plantilla seleccionada no existe.')
    const presetChanged = preset !== workflow.preset
    const data = {
      name: cleanText(input.name, 120) || workflow.name,
      preset,
      capabilities: presetValues ? presetValues.capabilities : sanitizeCapabilities(input.capabilities, workflow.capabilities),
      stages: presetValues ? presetValues.stages : sanitizeStages(input.stages, workflow.stages),
      policies: sanitizePolicies(input.policies, presetValues && presetChanged ? presetValues.policies : workflow.policies),
    }
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.purchaseWorkflow.update({ where: { id: workflow.id }, data })
      await writeAudit(tx, { companyId, actorId, entityType: 'purchase_workflow', entityId: workflow.id, action: 'purchase.workflow.updated', before: workflow, after: result })
      return result
    })
    await broadcast(broadcaster, companyId, 'purchase.workflow.updated', { workflowId: updated.id })
    return updated
  }

  function monthKeys(count = 12) {
    const now = new Date()
    const keys = []
    for (let offset = count - 1; offset >= 0; offset -= 1) {
      const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - offset, 1))
      keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    return keys
  }

  async function dashboard(companyId, actorId) {
    const workflow = await ensureWorkflow(companyId, actorId)
    const capabilities = workflow.capabilities ?? {}
    const today = new Date(toLocalIso() + 'T00:00:00.000Z')
    const months = monthKeys(12)
    const since = new Date(months[0] + '-01T00:00:00.000Z')
    const openOrders = { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED'] }
    const payable = { in: ['PENDING', 'PARTIALLY_PAID'] }
    const counted = { notIn: ['CANCELLED', 'DRAFT'] }
    const [openCases, ordersOpen, orderedAgg, invoicedAgg, payableRows, overdueInvoices, pendingApprovals, pendingReceipts,
      monthOrders, monthInvoices, approvals, overdueList, awaitingReceipt, recentOrders, recentInvoices, recentRequests, recentReceipts] = await Promise.all([
      prisma.purchaseCase.count({ where: { companyId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      prisma.purchaseOrder.count({ where: { companyId, status: openOrders } }),
      prisma.purchaseOrder.aggregate({ where: { companyId, status: counted }, _sum: { total: true } }),
      prisma.purchaseInvoice.aggregate({ where: { companyId, status: counted }, _sum: { total: true } }),
      prisma.purchaseInvoice.findMany({ where: { companyId, status: payable }, select: { total: true, paidAmount: true } }),
      prisma.purchaseInvoice.count({ where: { companyId, status: payable, dueDate: { lt: today } } }),
      prisma.purchaseApproval.count({ where: { companyId, status: 'PENDING' } }),
      prisma.purchaseOrder.count({ where: { companyId, status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } } }),
      prisma.purchaseOrder.findMany({ where: { companyId, status: counted, issueDate: { gte: since } }, select: { issueDate: true, total: true } }),
      prisma.purchaseInvoice.findMany({ where: { companyId, status: counted, issueDate: { gte: since } }, select: { issueDate: true, total: true } }),
      prisma.purchaseApproval.findMany({ where: { companyId, status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 5 }),
      prisma.purchaseInvoice.findMany({ where: { companyId, status: payable, dueDate: { lt: today } }, orderBy: { dueDate: 'asc' }, take: 5 }),
      prisma.purchaseOrder.findMany({ where: { companyId, status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } }, orderBy: [{ expectedDate: 'asc' }, { issueDate: 'asc' }], take: 5 }),
      prisma.purchaseOrder.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.purchaseInvoice.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.purchaseRequest.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.purchaseReceipt.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 8 }),
    ])

    const monthly = months.map(month => ({ month, ordered: 0, invoiced: 0 }))
    const byMonth = new Map(monthly.map(entry => [entry.month, entry]))
    for (const row of monthOrders) { const entry = byMonth.get(dateKey(row.issueDate)?.slice(0, 7)); if (entry) entry.ordered += num(row.total) }
    for (const row of monthInvoices) { const entry = byMonth.get(dateKey(row.issueDate)?.slice(0, 7)); if (entry) entry.invoiced += num(row.total) }
    for (const entry of monthly) { entry.ordered = Math.round(entry.ordered * 100) / 100; entry.invoiced = Math.round(entry.invoiced * 100) / 100 }

    const topSuppliers = await rankSuppliers(companyId, capabilities)
    const pipeline = await pipelineCounts(companyId, workflow)

    // Hydrate the approval owners so the inbox preview has numbers/totals.
    const ownerRows = await approvalOwners(companyId, approvals)
    const receiptOrderIds = recentReceipts.map(row => row.orderId)
    const receiptOrders = receiptOrderIds.length
      ? await prisma.purchaseOrder.findMany({ where: { companyId, id: { in: receiptOrderIds } }, select: { id: true, supplierId: true, total: true, currency: true } })
      : []
    const receiptOrderMap = new Map(receiptOrders.map(row => [row.id, row]))
    const names = await supplierNames(prisma, companyId, [
      ...overdueList, ...awaitingReceipt, ...recentOrders, ...recentInvoices, ...receiptOrders, ...ownerRows.values(),
    ].map(row => row.supplierId))
    const docRow = (kind, row) => ({ ...plain(row), kind, supplierName: names.get(row.supplierId) ?? null, path: `${KINDS[kind].path}/${row.id}` })

    const recent = [
      ...recentOrders.map(row => ({ kind: 'orders', id: row.id, number: row.number, supplierName: names.get(row.supplierId) ?? null, total: num(row.total), currency: row.currency, status: row.status, date: row.createdAt })),
      ...recentInvoices.map(row => ({ kind: 'invoices', id: row.id, number: row.number, supplierName: names.get(row.supplierId) ?? null, total: num(row.total), currency: row.currency, status: row.status, date: row.createdAt })),
      ...recentRequests.map(row => ({ kind: 'requests', id: row.id, number: row.number, supplierName: null, total: num(row.estimatedTotal), currency: row.currency, status: row.status, date: row.createdAt })),
      ...recentReceipts.map(row => {
        const order = receiptOrderMap.get(row.orderId)
        return { kind: 'receipts', id: row.id, number: row.number, supplierName: names.get(order?.supplierId) ?? null, total: order ? num(order.total) : null, currency: order?.currency ?? null, status: row.status, date: row.createdAt }
      }),
    ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8)
      .map(row => ({ ...row, path: `${KINDS[row.kind].path}/${row.id}` }))

    return {
      metrics: {
        openCases,
        ordersOpen,
        orderedAmount: num(orderedAgg._sum.total),
        invoicedAmount: num(invoicedAgg._sum.total),
        payableAmount: Math.round(payableRows.reduce((sum, row) => sum + num(row.total) - num(row.paidAmount), 0) * 100) / 100,
        overdueInvoices,
        pendingApprovals,
        pendingReceipts,
      },
      monthly,
      topSuppliers,
      pipeline,
      attention: {
        approvals: approvals.map(approval => {
          const owner = ownerRows.get(approval.ownerId)
          return {
            ...plain(approval),
            ownerNumber: owner?.number ?? null,
            ownerTotal: owner ? num(owner.total ?? owner.estimatedTotal) : null,
            currency: owner?.currency ?? null,
            supplierName: names.get(owner?.supplierId) ?? null,
          }
        }),
        overdueInvoices: overdueList.map(row => docRow('invoices', row)),
        awaitingReceipt: awaitingReceipt.map(row => docRow('orders', row)),
      },
      recent,
    }
  }

  async function approvalOwners(companyId, approvals) {
    const map = new Map()
    const groups = { PURCHASE_REQUEST: 'purchaseRequest', PURCHASE_ORDER: 'purchaseOrder', PURCHASE_INVOICE: 'purchaseInvoice' }
    for (const [ownerType, model] of Object.entries(groups)) {
      const ids = approvals.filter(approval => approval.ownerType === ownerType).map(approval => approval.ownerId)
      if (!ids.length) continue
      const rows = await prisma[model].findMany({ where: { companyId, id: { in: ids } } })
      for (const row of rows) map.set(row.id, row)
    }
    return map
  }

  async function rankSuppliers(companyId, capabilities) {
    const useInvoices = capabilities.invoices !== false
    const model = useInvoices ? prisma.purchaseInvoice : prisma.purchaseOrder
    const grouped = await model.groupBy({
      by: ['supplierId'],
      where: { companyId, supplierId: { not: null }, status: { notIn: ['CANCELLED', 'DRAFT'] } },
      _sum: { total: true },
      _count: { _all: true },
    })
    const top = grouped.sort((a, b) => num(b._sum.total) - num(a._sum.total)).slice(0, 6)
    const names = await supplierNames(prisma, companyId, top.map(row => row.supplierId))
    return top.map(row => ({ id: row.supplierId, name: names.get(row.supplierId) ?? 'Proveedor', total: num(row._sum.total), documents: row._count._all }))
  }

  async function pipelineCounts(companyId, workflow) {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const counters = {
      REQUEST: () => prisma.purchaseRequest.count({ where: { companyId, status: { in: ['DRAFT', 'SUBMITTED'] } } }),
      QUOTES: () => prisma.purchaseQuote.count({ where: { companyId, status: 'RECEIVED' } }),
      APPROVAL: () => prisma.purchaseApproval.count({ where: { companyId, status: 'PENDING' } }),
      PURCHASE_ORDER: () => prisma.purchaseOrder.count({ where: { companyId, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } } }),
      RECEIPT: () => prisma.purchaseOrder.count({ where: { companyId, status: { in: ['ISSUED', 'PARTIALLY_RECEIVED'] } } }),
      INVOICE: () => prisma.purchaseInvoice.count({ where: { companyId, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } }),
      PAYMENT: () => prisma.purchaseInvoice.count({ where: { companyId, status: { in: ['PENDING', 'PARTIALLY_PAID'] } } }),
      RELATE: () => prisma.entityRelation.count({ where: { companyId, sourceModule: 'runly.purchases', targetType: 'inventory_item', createdAt: { gte: since } } }),
      CLOSE: () => prisma.purchaseCase.count({ where: { companyId, status: 'CLOSED', closedAt: { gte: since } } }),
    }
    const stages = enabledStages(workflow)
    const counts = await Promise.all(stages.map(stage => counters[stage.type]?.() ?? 0))
    return stages.map((stage, index) => ({ stage: stage.type, label: STAGE_LABELS[stage.type], count: counts[index] }))
  }

  return { ensureWorkflow, getSettings, getCapabilities, assertCapability, updateSettings, dashboard }
}
