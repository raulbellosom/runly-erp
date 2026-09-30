// Pure workflow logic for runly.purchases: stage metadata, status/transition
// tables, policy evaluation and the stage map that powers the flow ribbon.
// Spec: docs/superpowers/specs/2026-09-30-purchases-core-redesign-design.md §4-§5.
// No I/O here — everything is unit-testable.

export const STAGE_ORDER = ['REQUEST', 'QUOTES', 'APPROVAL', 'PURCHASE_ORDER', 'RECEIPT', 'INVOICE', 'PAYMENT', 'RELATE', 'CLOSE']

export const STAGE_LABELS = {
  REQUEST: 'Solicitud',
  QUOTES: 'Cotizaciones',
  APPROVAL: 'Aprobación',
  PURCHASE_ORDER: 'Orden de compra',
  RECEIPT: 'Recepción',
  INVOICE: 'Factura',
  PAYMENT: 'Pago',
  RELATE: 'Relacionar',
  CLOSE: 'Cierre',
}

// Capability that must be on for a stage to exist at all. RELATE/CLOSE are
// structural (RELATE follows inventoryRelations, CLOSE is always present).
export const STAGE_CAPABILITY = {
  REQUEST: 'requests',
  QUOTES: 'quotes',
  APPROVAL: 'approvals',
  PURCHASE_ORDER: 'purchaseOrders',
  RECEIPT: 'receipts',
  INVOICE: 'invoices',
  PAYMENT: 'payments',
  RELATE: 'inventoryRelations',
  CLOSE: null,
}

export const STAGE_MODES = ['REQUIRED', 'OPTIONAL', 'CONDITIONAL', 'DISABLED']

export const STATUSES = {
  order: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'],
  invoice: ['DRAFT', 'PENDING_APPROVAL', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'],
  request: ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED'],
  quote: ['RECEIVED', 'SELECTED', 'DISCARDED'],
  approval: ['PENDING', 'APPROVED', 'REJECTED'],
  receipt: ['DRAFT', 'COMPLETED', 'CANCELLED'],
  case: ['OPEN', 'IN_PROGRESS', 'CLOSED', 'CANCELLED'],
}

// `to` null means the service decides (policy-driven or amount-driven).
export const TRANSITIONS = {
  orders: {
    submit: { from: ['DRAFT'], to: null },
    approve: { from: ['PENDING_APPROVAL'], to: 'APPROVED' },
    reject: { from: ['PENDING_APPROVAL'], to: 'DRAFT' },
    issue: { from: ['DRAFT', 'APPROVED'], to: 'ISSUED' },
    close: { from: ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED'], to: 'CLOSED' },
    cancel: { from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ISSUED'], to: 'CANCELLED' },
  },
  invoices: {
    submit: { from: ['DRAFT'], to: null },
    approve: { from: ['PENDING_APPROVAL'], to: 'PENDING' },
    reject: { from: ['PENDING_APPROVAL'], to: 'DRAFT' },
    pay: { from: ['PENDING', 'PARTIALLY_PAID'], to: null },
    cancel: { from: ['DRAFT', 'PENDING_APPROVAL', 'PENDING'], to: 'CANCELLED' },
  },
  requests: {
    submit: { from: ['DRAFT'], to: null },
    approve: { from: ['SUBMITTED'], to: 'APPROVED' },
    reject: { from: ['SUBMITTED'], to: 'REJECTED' },
    cancel: { from: ['DRAFT', 'SUBMITTED', 'APPROVED'], to: 'CANCELLED' },
    convert: { from: ['APPROVED'], to: 'ORDERED' },
  },
  quotes: {
    select: { from: ['RECEIVED', 'DISCARDED'], to: 'SELECTED' },
    discard: { from: ['RECEIVED', 'SELECTED'], to: 'DISCARDED' },
  },
  cases: {
    close: { from: ['OPEN', 'IN_PROGRESS'], to: 'CLOSED' },
    cancel: { from: ['OPEN', 'IN_PROGRESS'], to: 'CANCELLED' },
    reopen: { from: ['CLOSED', 'CANCELLED'], to: 'OPEN' },
  },
}

// Returns the transition definition or null when the action is not allowed
// from the current status.
export function resolveTransition(kind, action, status) {
  const def = TRANSITIONS[kind]?.[action]
  if (!def) return null
  return def.from.includes(status) ? def : null
}

export function enabledStages(workflow = {}) {
  const capabilities = workflow.capabilities ?? {}
  const stages = Array.isArray(workflow.stages) ? workflow.stages : []
  return stages
    .filter(stage => STAGE_ORDER.includes(stage?.type) && stage.mode !== 'DISABLED')
    .filter(stage => {
      const capability = STAGE_CAPABILITY[stage.type]
      return !capability || capabilities[capability] !== false
    })
    .sort((a, b) => STAGE_ORDER.indexOf(a.type) - STAGE_ORDER.indexOf(b.type))
}

function compare(actual, op, expected) {
  switch (op) {
    case 'gt': return Number(actual) > Number(expected)
    case 'gte': return Number(actual) >= Number(expected)
    case 'lt': return Number(actual) < Number(expected)
    case 'lte': return Number(actual) <= Number(expected)
    case 'neq': return actual !== expected
    case 'eq':
    default: return actual === expected
  }
}

export function policyMatches(policy, context = {}) {
  const when = policy?.when
  if (!when?.metric) return false
  return compare(context[when.metric], when.op ?? 'eq', when.value)
}

function isStageSatisfied(stage, min, context) {
  switch (stage) {
    case 'REQUEST': return Boolean(context.hasRequest)
    case 'QUOTES': return Number(context.quotesCount ?? 0) >= (min ?? 1)
    case 'APPROVAL': return Boolean(context.approved)
    case 'PURCHASE_ORDER': return Boolean(context.hasOrder)
    case 'RECEIPT': return Boolean(context.receivedAll)
    case 'INVOICE': return Boolean(context.hasInvoice)
    case 'PAYMENT': return Boolean(context.paid)
    default: return true
  }
}

// evaluatePolicies(workflow, context) → [{ stage, min?, reason, satisfied }]
// Context: { total, hasGoods, quotesCount, approved, receivedAll } plus the
// optional hasRequest / hasOrder / hasInvoice / paid flags.
export function evaluatePolicies(workflow = {}, context = {}) {
  const policies = Array.isArray(workflow.policies) ? workflow.policies : []
  const results = []
  for (const stage of enabledStages(workflow)) {
    if (stage.type === 'RELATE' || stage.type === 'CLOSE' || stage.mode === 'OPTIONAL') continue
    const matching = policies.filter(policy => policy?.require?.stage === stage.type && policyMatches(policy, context))
    if (stage.mode === 'CONDITIONAL' && !matching.length) continue
    const mins = matching.map(policy => Number(policy.require.min)).filter(value => Number.isFinite(value) && value > 0)
    const min = mins.length ? Math.max(...mins) : undefined
    const label = STAGE_LABELS[stage.type]
    const reason = stage.mode === 'REQUIRED' && !matching.length
      ? `La etapa ${label} es obligatoria en el flujo.`
      : (matching.find(policy => policy.label)?.label ?? `La política de compras requiere ${label}${min ? ` (mínimo ${min})` : ''}.`)
    results.push({ stage: stage.type, ...(min ? { min } : {}), reason, satisfied: isStageSatisfied(stage.type, min, context) })
  }
  return results
}

// Unsatisfied requirements that must be done before `beforeStage` happens.
export function policyBlockers(workflow, context, beforeStage) {
  const limit = STAGE_ORDER.indexOf(beforeStage)
  return evaluatePolicies(workflow, context)
    .filter(result => !result.satisfied && STAGE_ORDER.indexOf(result.stage) < limit)
}

const ACTIVE = status => status !== 'CANCELLED' && status !== 'DISCARDED'

function num(value) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

// Derives the policy context from a case bundle
// ({ case, requests, quotes, approvals, orders, receipts, invoices, lines, relatedItems }).
export function contextFromBundle(bundle = {}, overrides = {}) {
  const orders = (bundle.orders ?? []).filter(order => ACTIVE(order.status))
  const invoices = (bundle.invoices ?? []).filter(invoice => ACTIVE(invoice.status))
  const lines = bundle.lines ?? []
  const goodsLines = lines.filter(line => (line.itemKind ?? 'GOODS') === 'GOODS')
  const activeOrderIds = new Set(orders.map(order => order.id))
  const orderGoods = goodsLines.filter(line => line.ownerType === 'PURCHASE_ORDER' && activeOrderIds.has(line.ownerId))
  const totals = [...orders, ...invoices].map(doc => num(doc.total))
  const approvals = bundle.approvals ?? []
  return {
    total: totals.length ? Math.max(...totals) : num(bundle.case?.estimatedTotal),
    hasGoods: goodsLines.length > 0,
    quotesCount: (bundle.quotes ?? []).filter(quote => ACTIVE(quote.status)).length,
    approved: approvals.some(approval => approval.status === 'APPROVED')
      || orders.some(order => ['APPROVED', 'ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'].includes(order.status)),
    receivedAll: orders.length > 0 && orders.every(order => {
      if (['RECEIVED', 'CLOSED'].includes(order.status)) return true
      const own = orderGoods.filter(line => line.ownerId === order.id)
      return own.length > 0 && own.every(line => num(line.receivedQuantity) + 1e-9 >= num(line.quantity))
    }),
    hasRequest: (bundle.requests ?? []).some(request => ['APPROVED', 'ORDERED'].includes(request.status)),
    hasOrder: orders.some(order => order.status !== 'DRAFT'),
    hasInvoice: invoices.some(invoice => invoice.status !== 'DRAFT'),
    paid: invoices.length > 0 && invoices.every(invoice => invoice.status === 'PAID'),
    ...overrides,
  }
}

function ref(type, doc) {
  return { type, id: doc.id, number: doc.number ?? doc.reference ?? null, status: doc.status }
}

function stageDocs(type, bundle) {
  switch (type) {
    case 'REQUEST': return (bundle.requests ?? []).map(doc => ref('purchase_request', doc))
    case 'QUOTES': return (bundle.quotes ?? []).map(doc => ref('purchase_quote', doc))
    case 'APPROVAL': return (bundle.approvals ?? []).map(doc => ({ type: 'purchase_approval', id: doc.id, number: null, status: doc.status }))
    case 'PURCHASE_ORDER': return (bundle.orders ?? []).map(doc => ref('purchase_order', doc))
    case 'RECEIPT': return (bundle.receipts ?? []).map(doc => ref('purchase_receipt', doc))
    case 'INVOICE': return (bundle.invoices ?? []).map(doc => ref('purchase_invoice', doc))
    case 'PAYMENT': return (bundle.invoices ?? []).filter(doc => ['PARTIALLY_PAID', 'PAID'].includes(doc.status)).map(doc => ref('purchase_invoice', doc))
    default: return []
  }
}

function stageDone(type, bundle, context) {
  const active = list => (list ?? []).filter(doc => ACTIVE(doc.status))
  switch (type) {
    case 'REQUEST': return context.hasRequest
    case 'QUOTES': return (bundle.quotes ?? []).some(quote => quote.status === 'SELECTED')
    case 'APPROVAL': {
      const approvals = bundle.approvals ?? []
      return approvals.some(approval => approval.status === 'APPROVED') && !approvals.some(approval => approval.status === 'PENDING')
    }
    case 'PURCHASE_ORDER': return active(bundle.orders).some(order => ['ISSUED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED'].includes(order.status))
    case 'RECEIPT': return active(bundle.orders).length > 0 && active(bundle.orders).every(order => ['RECEIVED', 'CLOSED'].includes(order.status))
    case 'INVOICE': return context.hasInvoice && !active(bundle.invoices).some(invoice => ['DRAFT', 'PENDING_APPROVAL'].includes(invoice.status))
    case 'PAYMENT': return context.paid
    case 'RELATE': return Number(bundle.relatedItems ?? 0) > 0
    case 'CLOSE': return bundle.case?.status === 'CLOSED'
    default: return false
  }
}

function stageBlocked(type, bundle) {
  if (type === 'REQUEST') {
    const requests = bundle.requests ?? []
    return requests.length > 0 && requests.every(request => ['REJECTED', 'CANCELLED'].includes(request.status))
  }
  if (type === 'APPROVAL') {
    const approvals = bundle.approvals ?? []
    return approvals.some(approval => approval.status === 'REJECTED') && !approvals.some(approval => ['APPROVED', 'PENDING'].includes(approval.status))
  }
  return false
}

// buildStageMap(workflow, caseBundle) →
// [{ type, label, mode, state: done|current|pending|skipped|blocked, refs }]
export function buildStageMap(workflow = {}, bundle = {}) {
  const context = contextFromBundle(bundle)
  const required = new Set(evaluatePolicies(workflow, context).map(result => result.stage))
  const caseStatus = bundle.case?.status
  const stages = enabledStages(workflow)
  const raw = stages.map(stage => {
    const refs = stageDocs(stage.type, bundle)
    const done = stageDone(stage.type, bundle, context)
    return { type: stage.type, label: STAGE_LABELS[stage.type], mode: stage.mode, refs, done, blocked: !done && stageBlocked(stage.type, bundle) }
  })
  const lastDoneIndex = raw.reduce((last, stage, index) => (stage.done ? index : last), -1)
  let currentAssigned = false
  return raw.map((stage, index) => {
    let state
    if (stage.done) state = 'done'
    else if (caseStatus === 'CANCELLED' || (caseStatus === 'CLOSED' && stage.type !== 'CLOSE')) state = 'skipped'
    else if (stage.blocked) state = 'blocked'
    else if (!required.has(stage.type) && stage.type !== 'CLOSE' && !stage.refs.length && (stage.mode !== 'REQUIRED') && index < lastDoneIndex) state = 'skipped'
    else if (!currentAssigned) { state = 'current'; currentAssigned = true }
    else state = 'pending'
    if (state === 'blocked') currentAssigned = true
    return { type: stage.type, label: stage.label, mode: stage.mode, state, refs: stage.refs }
  })
}
