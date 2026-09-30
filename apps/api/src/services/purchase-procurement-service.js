// runly.purchases — cases (expedientes), requests, quotes and approvals.
import { buildStageMap, resolveTransition } from './purchase-policies.js'
import { policyCheckFor } from './purchase-case-bundle.js'
import {
  DECISION_STATUS, KINDS, MODULE_KEY, OWNER_TYPE_TO_KIND, PurchasesServiceError, SUPPLIER_SELECT, asDate, asMoney, assertLineCategories,
  assertSupplier, broadcast, cleanText, createApproval, createCase, currency, dateKey, invalidTransition, allocateNumber, normalizeLine,
  notFound, num, pagination, plain, policyBlocked, relate, replaceLines, resolveApprovals, statusFilter, supplierNames, totalsFromLines, writeAudit,
} from './purchases-shared.js'

const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT']
const CASE_GATE = ['requests', 'quotes', 'approvals']

export function createPurchaseProcurementService({ prisma, broadcaster, workflowService, caseBundle, hydrator }) {
  async function find(kind, companyId, id) {
    const row = await prisma[KINDS[kind].model].findFirst({ where: { id, companyId } })
    if (!row) throw notFound()
    return row
  }

  async function audited(companyId, actorId, entityType, entityId, action, work, event = action) {
    const result = await prisma.$transaction(async tx => {
      const value = await work(tx)
      await writeAudit(tx, { companyId, actorId, entityType, entityId: entityId ?? value.id, action, after: value?.id ? { id: value.id, status: value.status } : undefined })
      return value
    })
    await broadcast(broadcaster, companyId, event, { id: entityId ?? result?.id, caseId: result?.caseId ?? null, status: result?.status ?? null })
    return result
  }

  // ── Cases ────────────────────────────────────────────────────────────────
  async function getCase(companyId, id, canRead) {
    const workflow = await workflowService.ensureWorkflow(companyId)
    const bundle = await caseBundle.loadBundle(companyId, id)
    if (!bundle.case) throw notFound('El expediente no existe o pertenece a otra empresa.')
    const names = await supplierNames(prisma, companyId, [bundle.case.supplierId, ...bundle.orders.map(row => row.supplierId), ...bundle.invoices.map(row => row.supplierId), ...bundle.quotes.map(row => row.supplierId)])
    const withSupplier = (kind, row) => ({ ...plain(row), supplierName: names.get(row.supplierId) ?? null, path: `${KINDS[kind].path}/${row.id}` })
    const supplier = bundle.case.supplierId ? await prisma.contact.findFirst({ where: { id: bundle.case.supplierId, companyId }, select: SUPPLIER_SELECT }) : null
    return {
      ...plain(bundle.case),
      supplier,
      supplierName: supplier?.name ?? null,
      lines: [],
      relations: await hydrator.relationsFor(companyId, MODULE_KEY, 'purchase_case', id, canRead),
      stageMap: buildStageMap(workflow, bundle),
      approvals: bundle.approvals.map(plain),
      requests: bundle.requests.map(row => ({ ...plain(row), path: `/purchases/requests/${row.id}` })),
      quotes: bundle.quotes.map(row => withSupplier('quotes', row)),
      orders: bundle.orders.map(row => withSupplier('orders', row)),
      receipts: bundle.receipts.map(row => ({ ...plain(row), receivedAt: dateKey(row.receivedAt), path: `/purchases/receipts/${row.id}` })),
      invoices: bundle.invoices.map(row => withSupplier('invoices', row)),
      policyCheck: strip(policyCheckFor(workflow, bundle, 'cases', null)),
    }
  }

  function strip(check) {
    const { context: _context, blockers: _blockers, ...rest } = check
    return rest
  }

  async function createCaseDoc(companyId, actorId, input = {}) {
    const workflow = await workflowService.assertCapability(companyId, CASE_GATE, actorId)
    await assertSupplier(prisma, companyId, input.supplierId)
    const title = cleanText(input.title, 255)
    if (!title) throw new PurchasesServiceError('El expediente necesita un título.')
    return plain(await audited(companyId, actorId, 'purchase_case', null, 'purchase.case.created', async tx => {
      const created = await createCase(tx, { companyId, actorId, workflowId: workflow.id, number: input.number, title, currency: input.currency, estimatedTotal: input.estimatedTotal != null ? asMoney(input.estimatedTotal) : null, supplierId: input.supplierId })
      if (input.description) return tx.purchaseCase.update({ where: { id: created.id }, data: { description: cleanText(input.description) } })
      return created
    }))
  }

  async function transitionCase(companyId, actorId, id, action) {
    const workflow = await workflowService.assertCapability(companyId, CASE_GATE, actorId)
    const row = await find('cases', companyId, id)
    const rule = resolveTransition('cases', action, row.status)
    if (!rule) throw invalidTransition()
    if (action === 'close') {
      const check = policyCheckFor(workflow, await caseBundle.loadBundle(companyId, id), 'cases', null)
      if (check.blocked) throw policyBlocked(check.blockers)
    }
    const data = { status: rule.to, closedAt: action === 'close' ? new Date() : action === 'reopen' ? null : row.closedAt }
    return plain(await audited(companyId, actorId, 'purchase_case', id, `purchase.case.${action}`, tx => tx.purchaseCase.update({ where: { id }, data })))
  }

  // ── Requests ─────────────────────────────────────────────────────────────
  async function getRequest(companyId, id, canRead) {
    const workflow = await workflowService.ensureWorkflow(companyId)
    const row = await find('requests', companyId, id)
    const [bundle, lines, relations] = await Promise.all([
      caseBundle.loadBundle(companyId, row.caseId),
      prisma.purchaseLine.findMany({ where: { companyId, ownerType: 'PURCHASE_REQUEST', ownerId: id }, orderBy: { sortOrder: 'asc' } }),
      hydrator.relationsFor(companyId, MODULE_KEY, 'purchase_request', id, canRead),
    ])
    const names = await supplierNames(prisma, companyId, [...bundle.quotes, ...bundle.orders].map(doc => doc.supplierId))
    return {
      ...plain(row),
      neededBy: dateKey(row.neededBy),
      supplier: null,
      lines: lines.map(plain),
      relations,
      case: bundle.case ? { id: bundle.case.id, number: bundle.case.number, title: bundle.case.title, status: bundle.case.status } : null,
      stageMap: buildStageMap(workflow, bundle),
      approvals: bundle.approvals.filter(approval => approval.ownerId === id).map(plain),
      quotes: bundle.quotes.map(quote => ({ ...plain(quote), issueDate: dateKey(quote.issueDate), validUntil: dateKey(quote.validUntil), supplierName: names.get(quote.supplierId) ?? null })),
      orders: bundle.orders.map(order => ({ ...plain(order), supplierName: names.get(order.supplierId) ?? null, path: `/purchases/orders/${order.id}` })),
      policyCheck: strip(policyCheckFor(workflow, bundle, 'requests', row)),
    }
  }

  async function requestData(companyId, input, existing) {
    const data = {}
    if (!existing || 'title' in input) {
      data.title = cleanText(input.title, 255)
      if (!data.title) throw new PurchasesServiceError('La solicitud necesita un título.')
    }
    if (!existing || 'justification' in input) data.justification = cleanText(input.justification)
    if (!existing || 'neededBy' in input) data.neededBy = asDate(input.neededBy)
    if (!existing || 'priority' in input) {
      const priority = String(input.priority || 'NORMAL').toUpperCase()
      data.priority = PRIORITIES.includes(priority) ? priority : 'NORMAL'
    }
    if (!existing || 'currency' in input) data.currency = currency(input.currency, existing?.currency)
    if (input.requesterId) {
      const member = await prisma.membership.findFirst({ where: { companyId, userId: input.requesterId, enabled: true }, select: { id: true } })
      if (!member) throw notFound('El solicitante no pertenece a esta empresa.')
      data.requesterId = input.requesterId
    }
    return data
  }

  async function createRequest(companyId, actorId, input = {}) {
    const workflow = await workflowService.assertCapability(companyId, 'requests', actorId)
    const lines = (Array.isArray(input.lines) ? input.lines : []).map(normalizeLine).filter(Boolean)
    await assertLineCategories(prisma, companyId, lines)
    const data = await requestData(companyId, input)
    const estimatedTotal = lines.length ? totalsFromLines(lines).total : asMoney(input.estimatedTotal)
    let caseRow = null
    if (input.caseId) {
      caseRow = await prisma.purchaseCase.findFirst({ where: { id: input.caseId, companyId } })
      if (!caseRow) throw notFound('El expediente no existe.')
    }
    return plain(await audited(companyId, actorId, 'purchase_request', null, 'purchase.request.created', async tx => {
      const { sequence, number } = await allocateNumber(tx, { companyId, kind: 'requests', number: input.number })
      const purchaseCase = caseRow ?? await createCase(tx, { companyId, actorId, workflowId: workflow.id, title: data.title, currency: data.currency, estimatedTotal })
      const request = await tx.purchaseRequest.create({
        data: { companyId, caseId: purchaseCase.id, number, sequence, ...data, estimatedTotal, status: 'DRAFT', requesterId: data.requesterId ?? actorId ?? null, createdById: actorId || null },
      })
      if (!caseRow) await tx.purchaseCase.update({ where: { id: purchaseCase.id }, data: { requestId: request.id } })
      await replaceLines(tx, companyId, 'PURCHASE_REQUEST', request.id, lines)
      await relate(tx, { companyId, actorId, sourceType: 'purchase_case', sourceId: purchaseCase.id, targetType: 'purchase_request', targetId: request.id, relationType: 'CONTAINS', origin: 'AUTOMATIC' })
      return request
    }))
  }

  async function updateRequest(companyId, actorId, id, input = {}) {
    await workflowService.assertCapability(companyId, 'requests', actorId)
    const before = await find('requests', companyId, id)
    if (before.status !== 'DRAFT') throw invalidTransition('Solo se pueden editar solicitudes en borrador.')
    const lines = Array.isArray(input.lines) ? input.lines.map(normalizeLine).filter(Boolean) : null
    if (lines) await assertLineCategories(prisma, companyId, lines)
    const data = await requestData(companyId, input, before)
    if (lines) data.estimatedTotal = totalsFromLines(lines).total
    else if ('estimatedTotal' in input) data.estimatedTotal = asMoney(input.estimatedTotal)
    // The folio is user data; the internal sequence never changes.
    if (input.number !== undefined) data.number = cleanText(input.number, 40) || before.number
    return plain(await audited(companyId, actorId, 'purchase_request', id, 'purchase.request.updated', async tx => {
      const row = await tx.purchaseRequest.update({ where: { id }, data })
      if (lines) await replaceLines(tx, companyId, 'PURCHASE_REQUEST', id, lines)
      return row
    }))
  }

  async function transitionRequest(companyId, actorId, id, action, payload = {}) {
    const workflow = await workflowService.assertCapability(companyId, 'requests', actorId)
    const row = await find('requests', companyId, id)
    if (!resolveTransition('requests', action, row.status)) throw invalidTransition()
    const bundle = await caseBundle.loadBundle(companyId, row.caseId)
    const check = policyCheckFor(workflow, bundle, 'requests', row)
    if (action === 'convert') return convertRequest(companyId, actorId, row, payload, check)
    let status = TRANSITION_TO[action]
    let approvalReason = null
    if (action === 'submit') {
      const approval = check.requirements.find(requirement => requirement.stage === 'APPROVAL' && !requirement.satisfied)
      status = approval ? 'SUBMITTED' : 'APPROVED'
      approvalReason = approval?.reason ?? null
    }
    const decision = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : null
    return plain(await audited(companyId, actorId, 'purchase_request', id, `purchase.request.${action}`, async tx => {
      const updated = await tx.purchaseRequest.update({ where: { id }, data: { status } })
      if (approvalReason) await createApproval(tx, { companyId, caseId: row.caseId, ownerType: 'PURCHASE_REQUEST', ownerId: id, reason: approvalReason, actorId })
      if (decision) await resolveApprovals(tx, { companyId, ownerType: 'PURCHASE_REQUEST', ownerId: id, decision, actorId, comment: payload.comment })
      if (action === 'cancel') await resolveApprovals(tx, { companyId, ownerType: 'PURCHASE_REQUEST', ownerId: id, decision: 'REJECTED', actorId, comment: 'Solicitud cancelada' })
      return updated
    }))
  }

  const TRANSITION_TO = { approve: 'APPROVED', reject: 'REJECTED', cancel: 'CANCELLED' }

  // Approved request -> draft order (lines copied, supplier from payload or selected quote).
  async function convertRequest(companyId, actorId, request, payload, check) {
    await workflowService.assertCapability(companyId, 'purchaseOrders', actorId)
    if (check.blocked) throw policyBlocked(check.blockers)
    const selected = await prisma.purchaseQuote.findFirst({ where: { companyId, caseId: request.caseId, status: 'SELECTED' } })
    const supplierId = payload.supplierId || selected?.supplierId || null
    await assertSupplier(prisma, companyId, supplierId)
    const lines = await prisma.purchaseLine.findMany({ where: { companyId, ownerType: 'PURCHASE_REQUEST', ownerId: request.id }, orderBy: { sortOrder: 'asc' } })
    const copies = lines.map(line => ({
      description: line.description, quantity: line.quantity, unitAmount: line.unitAmount, taxAmount: line.taxAmount, total: line.total,
      sortOrder: line.sortOrder, itemKind: line.itemKind, unit: line.unit, taxRate: line.taxRate, inventoryCategoryId: line.inventoryCategoryId,
    }))
    const subtotal = copies.reduce((sum, line) => sum + num(line.total) - num(line.taxAmount), 0)
    const tax = copies.reduce((sum, line) => sum + num(line.taxAmount), 0)
    const totals = copies.length
      ? { subtotal: Math.round(subtotal * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((subtotal + tax) * 100) / 100 }
      : { subtotal: num(selected?.subtotal ?? request.estimatedTotal), tax: num(selected?.tax), total: num(selected?.total ?? request.estimatedTotal) }
    const order = await prisma.$transaction(async tx => {
      const { sequence, number } = await allocateNumber(tx, { companyId, kind: 'orders', number: payload.number })
      const created = await tx.purchaseOrder.create({
        data: { companyId, caseId: request.caseId, supplierId, number, sequence, issueDate: asDate(null, { fallbackToday: true }), status: 'DRAFT', currency: request.currency, ...totals, notes: request.justification, createdById: actorId || null },
      })
      await replaceLines(tx, companyId, 'PURCHASE_ORDER', created.id, copies)
      await tx.purchaseRequest.update({ where: { id: request.id }, data: { status: 'ORDERED' } })
      await tx.purchaseCase.updateMany({ where: { id: request.caseId, companyId, status: 'OPEN' }, data: { status: 'IN_PROGRESS', ...(supplierId ? { supplierId } : {}) } })
      await relate(tx, { companyId, actorId, sourceType: 'purchase_case', sourceId: request.caseId, targetType: 'purchase_order', targetId: created.id, relationType: 'CONTAINS', origin: 'AUTOMATIC' })
      await relate(tx, { companyId, actorId, sourceType: 'purchase_order', sourceId: created.id, targetType: 'purchase_request', targetId: request.id, relationType: 'FULFILLS', origin: 'AUTOMATIC' })
      await writeAudit(tx, { companyId, actorId, entityType: 'purchase_request', entityId: request.id, action: 'purchase.request.convert', metadata: { orderId: created.id } })
      await writeAudit(tx, { companyId, actorId, entityType: 'purchase_order', entityId: created.id, action: 'purchase.order.created', after: created })
      return created
    })
    await broadcast(broadcaster, companyId, 'purchase.request.convert', { id: request.id, orderId: order.id, caseId: request.caseId })
    await broadcast(broadcaster, companyId, 'purchase.order.created', { id: order.id, caseId: order.caseId })
    return plain(order)
  }

  // ── Quotes ───────────────────────────────────────────────────────────────
  async function getQuote(companyId, id, canRead) {
    const workflow = await workflowService.ensureWorkflow(companyId)
    const row = await find('quotes', companyId, id)
    const bundle = await caseBundle.loadBundle(companyId, row.caseId)
    const names = await supplierNames(prisma, companyId, bundle.quotes.map(quote => quote.supplierId))
    const supplier = row.supplierId ? await prisma.contact.findFirst({ where: { id: row.supplierId, companyId }, select: SUPPLIER_SELECT }) : null
    return {
      ...plain(row), issueDate: dateKey(row.issueDate), validUntil: dateKey(row.validUntil),
      supplier, supplierName: supplier?.name ?? null, lines: [],
      relations: await hydrator.relationsFor(companyId, MODULE_KEY, 'purchase_quote', id, canRead),
      stageMap: buildStageMap(workflow, bundle), approvals: [],
      quotes: bundle.quotes.map(quote => ({ ...plain(quote), supplierName: names.get(quote.supplierId) ?? null })),
      policyCheck: strip(policyCheckFor(workflow, bundle, 'quotes', null)),
    }
  }

  async function createQuote(companyId, actorId, input = {}) {
    const workflow = await workflowService.assertCapability(companyId, 'quotes', actorId)
    await assertSupplier(prisma, companyId, input.supplierId)
    let caseId = null
    let requestId = null
    if (input.requestId) {
      const request = await find('requests', companyId, input.requestId)
      requestId = request.id
      caseId = request.caseId
    }
    if (input.caseId) {
      const found = await prisma.purchaseCase.findFirst({ where: { id: input.caseId, companyId }, select: { id: true } })
      if (!found) throw notFound('El expediente no existe.')
      if (caseId && caseId !== found.id) throw new PurchasesServiceError('La solicitud pertenece a otro expediente.')
      caseId = found.id
    }
    const subtotal = asMoney(input.subtotal ?? input.total)
    const tax = asMoney(input.tax)
    const deliveryDays = input.deliveryDays == null || input.deliveryDays === '' ? null : Math.max(0, Math.round(Number(input.deliveryDays) || 0))
    return plain(await audited(companyId, actorId, 'purchase_quote', null, 'purchase.quote.created', async tx => {
      const targetCase = caseId ?? (await createCase(tx, { companyId, actorId, workflowId: workflow.id, title: 'Cotización ' + (cleanText(input.reference, 100) || ''), currency: input.currency, supplierId: input.supplierId })).id
      const quote = await tx.purchaseQuote.create({
        data: {
          companyId, caseId: targetCase, requestId, supplierId: input.supplierId || null, reference: cleanText(input.reference, 100),
          issueDate: asDate(input.issueDate, { fallbackToday: true }), validUntil: asDate(input.validUntil), currency: currency(input.currency),
          subtotal, tax, total: asMoney(input.total ?? subtotal + tax), deliveryDays, status: 'RECEIVED', notes: cleanText(input.notes), createdById: actorId || null,
        },
      })
      await relate(tx, { companyId, actorId, sourceType: 'purchase_case', sourceId: targetCase, targetType: 'purchase_quote', targetId: quote.id, relationType: 'CONTAINS', origin: 'AUTOMATIC' })
      return quote
    }))
  }

  async function transitionQuote(companyId, actorId, id, action) {
    await workflowService.assertCapability(companyId, 'quotes', actorId)
    const row = await find('quotes', companyId, id)
    const rule = resolveTransition('quotes', action, row.status)
    if (!rule) throw invalidTransition()
    return plain(await audited(companyId, actorId, 'purchase_quote', id, `purchase.quote.${action}`, async tx => {
      if (action === 'select') {
        await tx.purchaseQuote.updateMany({ where: { companyId, caseId: row.caseId, id: { not: id }, status: { in: ['RECEIVED', 'SELECTED'] } }, data: { status: 'DISCARDED' } })
        if (row.supplierId) await tx.purchaseCase.updateMany({ where: { id: row.caseId, companyId }, data: { supplierId: row.supplierId } })
      }
      return tx.purchaseQuote.update({ where: { id }, data: { status: rule.to } })
    }))
  }

  // ── Approvals ────────────────────────────────────────────────────────────
  async function listApprovals(companyId, query = {}) {
    await workflowService.assertCapability(companyId, 'approvals')
    const { page, pageSize, skip, take } = pagination(query)
    const where = { companyId }
    const status = statusFilter(query.status)
    if (status) where.status = status
    if (query.ownerType) where.ownerType = String(query.ownerType).toUpperCase()
    const [rows, total] = await Promise.all([
      prisma.purchaseApproval.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.purchaseApproval.count({ where }),
    ])
    const owners = new Map()
    for (const [ownerType, kind] of Object.entries(OWNER_TYPE_TO_KIND)) {
      const ids = rows.filter(row => row.ownerType === ownerType).map(row => row.ownerId)
      if (!ids.length) continue
      const found = await prisma[KINDS[kind].model].findMany({ where: { companyId, id: { in: ids } } })
      for (const owner of found) owners.set(owner.id, { kind, owner })
    }
    const caseRows = rows.length ? await prisma.purchaseCase.findMany({ where: { companyId, id: { in: rows.map(row => row.caseId) } }, select: { id: true, number: true, title: true } }) : []
    const cases = new Map(caseRows.map(row => [row.id, row]))
    const names = await supplierNames(prisma, companyId, [...owners.values()].map(entry => entry.owner.supplierId))
    const data = rows.map(row => {
      const entry = owners.get(row.ownerId)
      const owner = entry?.owner
      return {
        ...plain(row),
        ownerKind: entry?.kind ?? null,
        ownerNumber: owner?.number ?? null,
        ownerTitle: owner?.title ?? null,
        ownerStatus: owner?.status ?? null,
        ownerTotal: owner ? num(owner.total ?? owner.estimatedTotal) : null,
        currency: owner?.currency ?? null,
        supplierName: names.get(owner?.supplierId) ?? null,
        ownerPath: entry ? `${KINDS[entry.kind].path}/${owner.id}` : null,
        caseNumber: cases.get(row.caseId)?.number ?? null,
        caseTitle: cases.get(row.caseId)?.title ?? null,
      }
    })
    return { data, total, page, pageSize, pagination: { page, pageSize, total } }
  }

  async function decideApproval(companyId, actorId, id, input = {}) {
    await workflowService.assertCapability(companyId, 'approvals', actorId)
    const decision = String(input.decision ?? '').toUpperCase()
    if (!['APPROVED', 'REJECTED'].includes(decision)) throw new PurchasesServiceError('La decisión debe ser APPROVED o REJECTED.')
    const approval = await prisma.purchaseApproval.findFirst({ where: { id, companyId } })
    if (!approval) throw notFound('La aprobación no existe.')
    if (approval.status !== 'PENDING') throw invalidTransition('La aprobación ya fue resuelta.')
    const kind = OWNER_TYPE_TO_KIND[approval.ownerType]
    const statusMap = DECISION_STATUS[approval.ownerType]
    const result = await prisma.$transaction(async tx => {
      const updated = await tx.purchaseApproval.update({
        where: { id },
        data: { status: decision, decidedById: actorId || null, decidedAt: new Date(), comment: cleanText(input.comment, 1000) },
      })
      if (kind && statusMap) {
        await tx[KINDS[kind].model].updateMany({ where: { id: approval.ownerId, companyId, status: statusMap.waiting }, data: { status: statusMap[decision] } })
      }
      await writeAudit(tx, { companyId, actorId, entityType: 'purchase_approval', entityId: id, action: 'purchase.approval.decided', before: { status: approval.status }, after: { status: decision }, metadata: { ownerType: approval.ownerType, ownerId: approval.ownerId } })
      return updated
    })
    await broadcast(broadcaster, companyId, 'purchase.approval.decided', { id, decision, ownerType: approval.ownerType, ownerId: approval.ownerId, caseId: approval.caseId })
    return plain(result)
  }

  return {
    getCase, createCase: createCaseDoc, transitionCase,
    getRequest, createRequest, updateRequest, transitionRequest,
    getQuote, createQuote, transitionQuote,
    listApprovals, decideApproval,
  }
}
