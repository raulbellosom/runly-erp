// Loads everything that belongs to a purchase case (the "expediente") so the
// pure policy/stage-map functions can evaluate it. Company-scoped throughout.
import { buildStageMap, contextFromBundle, evaluatePolicies, policyBlockers } from './purchase-policies.js'
import { num } from './purchases-shared.js'

// Gated action per document kind and the stage it must not skip past.
export const POLICY_ACTIONS = {
  orders: { action: 'issue', beforeStage: 'PURCHASE_ORDER' },
  invoices: { action: 'pay', beforeStage: 'PAYMENT' },
  cases: { action: 'close', beforeStage: 'CLOSE' },
  requests: { action: 'convert', beforeStage: 'PURCHASE_ORDER' },
}

export function policyCheckFor(workflow, bundle, kind, doc) {
  const gate = POLICY_ACTIONS[kind]
  const total = doc ? num(doc.total ?? doc.estimatedTotal) : undefined
  const context = contextFromBundle(bundle, kind === 'cases' || total == null ? {} : { total })
  const requirements = evaluatePolicies(workflow, context)
  if (!gate) return { action: null, blocked: false, reasons: [], requirements }
  const blockers = policyBlockers(workflow, context, gate.beforeStage)
  return { action: gate.action, blocked: blockers.length > 0, reasons: blockers.map(blocker => blocker.reason), blockers, requirements, context }
}

export function createPurchaseCaseBundle({ prisma }) {
  async function loadBundle(companyId, caseId, client = prisma) {
    if (!caseId) return { case: null, requests: [], quotes: [], approvals: [], orders: [], receipts: [], invoices: [], lines: [], relatedItems: 0 }
    const [purchaseCase, requests, quotes, approvals, orders, receipts, invoices] = await Promise.all([
      client.purchaseCase.findFirst({ where: { id: caseId, companyId } }),
      client.purchaseRequest.findMany({ where: { companyId, caseId }, orderBy: { createdAt: 'asc' } }),
      client.purchaseQuote.findMany({ where: { companyId, caseId }, orderBy: { createdAt: 'asc' } }),
      client.purchaseApproval.findMany({ where: { companyId, caseId }, orderBy: { createdAt: 'asc' } }),
      client.purchaseOrder.findMany({ where: { companyId, caseId }, orderBy: { createdAt: 'asc' } }),
      client.purchaseReceipt.findMany({ where: { companyId, caseId }, orderBy: { createdAt: 'asc' } }),
      client.purchaseInvoice.findMany({ where: { companyId, caseId }, orderBy: { createdAt: 'asc' } }),
    ])
    const ownerIds = [...orders, ...invoices].map(doc => doc.id)
    const docIds = [caseId, ...requests.map(doc => doc.id), ...ownerIds, ...receipts.map(doc => doc.id)]
    const [lines, relatedItems] = await Promise.all([
      ownerIds.length ? client.purchaseLine.findMany({ where: { companyId, ownerId: { in: ownerIds } }, orderBy: { sortOrder: 'asc' } }) : [],
      client.entityRelation.count({ where: { companyId, sourceModule: 'runly.purchases', sourceId: { in: docIds }, targetType: 'inventory_item' } }),
    ])
    return { case: purchaseCase, requests, quotes, approvals, orders, receipts, invoices, lines, relatedItems }
  }

  async function stageMapFor(workflow, companyId, caseId) {
    const bundle = await loadBundle(companyId, caseId)
    return { bundle, stageMap: buildStageMap(workflow, bundle) }
  }

  return { loadBundle, stageMapFor }
}
