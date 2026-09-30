import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { purchasesMap, coreModules } from '../../manifests/official/core-modules.js'
import { PURCHASE_PRESETS, PURCHASES_NAV_CAPABILITY, isPurchasesNavVisible } from '../purchases-service.js'
import { createPurchasesRouter } from '../../routes/purchases/index.js'
import { PERMISSION_CATALOG } from '../../permission-catalog.js'

test('Compras se registra como módulo core oficial', () => {
  assert.equal(purchasesMap.key, 'runly.purchases')
  assert.equal(purchasesMap.core, true)
  assert.equal(purchasesMap.uninstallable, false)
  assert.ok(coreModules.some(module => module.key === 'runly.purchases'))
  assert.ok(purchasesMap.permissions.some(permission => permission.key === 'purchases.relation.manage'))
})

test('las plantillas separan capacidades de etapas', () => {
  assert.deepEqual(PURCHASE_PRESETS.SIMPLE.stages.map(stage => stage.type), ['INVOICE', 'RELATE', 'CLOSE'])
  assert.equal(PURCHASE_PRESETS.SIMPLE.capabilities.purchaseOrders, false)
  assert.equal(PURCHASE_PRESETS.INVENTORY.capabilities.receipts, true)
  assert.equal(PURCHASE_PRESETS.COMPLETE.capabilities.approvals, true)
  assert.ok(PURCHASE_PRESETS.COMPLETE.stages.every(stage => ['REQUIRED', 'OPTIONAL', 'CONDITIONAL', 'DISABLED'].includes(stage.mode)))
})

test('cada entrada de navegación tiene control de permiso', () => {
  for (const item of purchasesMap.navigation) {
    assert.ok(item.permissionKey, item.path)
    assert.ok(purchasesMap.permissions.some(permission => permission.key === item.permissionKey), item.permissionKey)
  }
})

test('la navegación sigue las capacidades (spec §8) y los permisos están en el catálogo', () => {
  const paths = purchasesMap.navigation.map(item => item.path)
  assert.deepEqual(paths, ['/purchases', '/purchases/cases', '/purchases/requests', '/purchases/approvals', '/purchases/orders',
    '/purchases/receipts', '/purchases/invoices', '/purchases/payments', '/purchases/suppliers', '/purchases/settings'])
  for (const path of Object.keys(PURCHASES_NAV_CAPABILITY)) assert.ok(paths.includes(path), path)
  const simple = PURCHASE_PRESETS.SIMPLE.capabilities
  assert.deepEqual(paths.filter(path => isPurchasesNavVisible(path, simple)), ['/purchases', '/purchases/invoices', '/purchases/suppliers', '/purchases/settings'])
  assert.equal(isPurchasesNavVisible('/purchases/cases', { ...simple, quotes: true }), true)
  for (const permission of purchasesMap.permissions) assert.ok(PERMISSION_CATALOG[permission.key], permission.key)
})

test('la configuración registra en auditoría el perfil interno y no el usuario de Supabase', async () => {
  const companyId = '11111111-1111-7111-8111-111111111111'
  const profileId = '22222222-2222-7222-8222-222222222222'
  const authUserId = '33333333-3333-7333-8333-333333333333'
  const workflow = {
    id: '44444444-4444-7444-8444-444444444444',
    companyId,
    name: 'Flujo simple',
    preset: 'SIMPLE',
    capabilities: PURCHASE_PRESETS.SIMPLE.capabilities,
    stages: PURCHASE_PRESETS.SIMPLE.stages,
    policies: [],
    enabled: true,
    isDefault: true,
  }
  let auditedActorId = null
  const prisma = {
    purchaseWorkflow: {
      findFirst: async () => workflow,
    },
    $transaction: async callback => callback({
      purchaseWorkflow: {
        update: async ({ data }) => ({ ...workflow, ...data }),
      },
      auditLog: {
        create: async ({ data }) => {
          auditedActorId = data.actorId
          return data
        },
      },
    }),
  }
  const requirePermission = () => async (c, next) => {
    c.set('companyId', companyId)
    c.set('authUserId', authUserId)
    c.set('userId', profileId)
    c.set('userContext', { profile: { id: profileId } })
    await next()
  }
  const app = new Hono()
  app.route('/', createPurchasesRouter({ prisma, requirePermission }))

  const response = await app.request('/purchases/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: 'BASIC' }),
  })

  assert.equal(response.status, 200)
  assert.equal(auditedActorId, profileId)
  assert.notEqual(auditedActorId, authUserId)
})

// ── Router contract ─────────────────────────────────────────────────────────
const COMPANY = '11111111-1111-7111-8111-111111111111'
const PROFILE = '22222222-2222-7222-8222-222222222222'

function appWith(prisma, permissions = null) {
  const requirePermission = key => async (c, next) => {
    c.set('companyId', COMPANY)
    c.set('userId', PROFILE)
    c.set('userContext', { profile: { id: PROFILE }, isAdmin: !permissions, permissionSet: new Set(permissions ?? []) })
    if (permissions && !permissions.includes(key)) return c.json({ error: 'forbidden' }, 403)
    await next()
  }
  const app = new Hono()
  app.route('/', createPurchasesRouter({ prisma, requirePermission }))
  return app
}

function workflowPrisma(preset, extra = {}) {
  const workflow = { id: 'w1', companyId: COMPANY, preset, isDefault: true, enabled: true, policies: [], ...PURCHASE_PRESETS[preset] }
  return { purchaseWorkflow: { findFirst: async () => workflow }, ...extra }
}

const post = (app, path, payload) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })

test('rutas de capacidades deshabilitadas responden 409 CAPABILITY_DISABLED', async () => {
  const app = appWith(workflowPrisma('SIMPLE'))
  for (const path of ['/purchases/orders', '/purchases/requests', '/purchases/receipts', '/purchases/approvals', '/purchases/cases']) {
    const response = await app.request(path)
    assert.equal(response.status, 409, path)
    assert.equal((await response.json()).code, 'CAPABILITY_DISABLED', path)
  }
  const created = await post(app, '/purchases/orders', { lines: [] })
  assert.equal(created.status, 409)
})

test('transición inválida responde 409 INVALID_TRANSITION y aprobar exige permiso', async () => {
  const order = { id: 'o1', companyId: COMPANY, caseId: 'c1', status: 'CLOSED', total: 10 }
  const prisma = workflowPrisma('COMPLETE', { purchaseOrder: { findFirst: async () => order } })
  const admin = appWith(prisma)
  const invalid = await post(admin, '/purchases/orders/o1/transition', { action: 'issue' })
  assert.equal(invalid.status, 409)
  assert.equal((await invalid.json()).code, 'INVALID_TRANSITION')

  const limited = appWith(prisma, ['purchases.order.update'])
  const forbidden = await post(limited, '/purchases/orders/o1/transition', { action: 'approve' })
  assert.equal(forbidden.status, 403)
})

test('emitir una orden sin la aprobación requerida responde 409 POLICY_BLOCKED con motivos', async () => {
  const order = { id: 'o1', companyId: COMPANY, caseId: 'c1', status: 'DRAFT', total: 80000 }
  const empty = async () => []
  const prisma = workflowPrisma('COMPLETE', {
    purchaseOrder: { findFirst: async () => order, findMany: async () => [order] },
    purchaseCase: { findFirst: async () => ({ id: 'c1', companyId: COMPANY, status: 'OPEN' }) },
    purchaseRequest: { findMany: async () => [{ id: 'r1', status: 'APPROVED' }] },
    purchaseQuote: { findMany: async () => [{ status: 'RECEIVED' }, { status: 'RECEIVED' }, { status: 'SELECTED' }] },
    purchaseApproval: { findMany: empty },
    purchaseReceipt: { findMany: empty },
    purchaseInvoice: { findMany: empty },
    purchaseLine: { findMany: empty },
    entityRelation: { count: async () => 0 },
  })
  const response = await post(appWith(prisma), '/purchases/orders/o1/transition', { action: 'issue' })
  assert.equal(response.status, 409)
  const payload = await response.json()
  assert.equal(payload.code, 'POLICY_BLOCKED')
  assert.deepEqual(payload.reasons, ['Montos mayores a 50,000 requieren aprobación'])
})

test('candidatos de inventario degradan cuando Inventario no está habilitado', async () => {
  const prisma = workflowPrisma('BASIC', { runlyModule: { findFirst: async () => null } })
  const response = await appWith(prisma).request('/purchases/inventory/candidates')
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.deepEqual(payload.data, [])
  assert.equal(payload.available, false)
})
