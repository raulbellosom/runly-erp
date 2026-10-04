// Ledger, fleet and personal-finance services for RME3 modules (spec
// 2026-10-04-module-services-v2-design §6.1). Writes run the module's own
// MirAI action: prepare() validates and applies the per-record access checks
// (ledger canWriteAccount, pfm canWriteWallet, company scoping) without
// writing, execute() writes through the same service + effects as the HTTP
// routes. Reads call the module services and map to stable English keys
// (never the Spanish, LLM-facing tool output).
import { SERVICE_CONTRACTS } from '@runly/module-engine/contracts'
import { createLedgerService } from '../../routes/ledger/ledger-service.js'
import { createCategoriesService as createLedgerCategoriesService } from '../../routes/ledger/categories-service.js'
import { createLedgerEffects } from '../../routes/ledger/ledger-effects.js'
import { readableAccounts } from '../../routes/ledger/ledger-mirai-queries.js'
import { createLedgerMiraiActions } from '../../routes/ledger/mirai-actions.js'
import { createFleetService } from '../../routes/fleet/fleet-service.js'
import { createDriverService } from '../../routes/fleet/driver-service.js'
import { createInsuranceService } from '../../routes/fleet/insurance-service.js'
import { createFleetMiraiActions } from '../../routes/fleet/mirai-actions.js'
import { createWalletsService } from '../../routes/pfm/wallets-service.js'
import { createMovementsService } from '../../routes/pfm/movements-service.js'
import { createCategoriesService as createPfmCategoriesService } from '../../routes/pfm/categories-service.js'
import { createPfmCalendarBridge } from '../../routes/pfm/pfm-calendar-bridge.js'
import { createPfmMiraiActions } from '../../routes/pfm/mirai-actions.js'

// Fields whose action schema accepts null (clearing them). Other nulls are
// dropped, since those actions treat "absent" as "unchanged".
const NULLABLE = {
  'ledger.transaction.update': ['referencia', 'concepto', 'numero', 'categoryId'],
  'fleet.vehicle.update': ['driver'],
}

export function actionContext(prisma, ctx) {
  return { prisma, companyId: ctx.companyId, actorProfileId: ctx.actorId, actorAuthUserId: ctx.actorAuthId, actorProfile: ctx.actorProfile ?? null, turn: {} }
}

export function createActionBackedServices({ prisma, ServiceError }) {
  const ledgerService = createLedgerService({ prisma })
  const ledgerCategories = createLedgerCategoriesService({ prisma })
  const fleetService = createFleetService({ prisma })
  const driverService = createDriverService({ prisma })
  const insuranceService = createInsuranceService({ prisma })
  const wallets = createWalletsService({ prisma, calendarBridge: createPfmCalendarBridge({ prisma }) })
  const movements = createMovementsService({ prisma, wallets })
  const pfmCategories = createPfmCategoriesService({ prisma })

  // The statement import action needs a chat attachment: not offered.
  const actions = new Map([
    ...createLedgerMiraiActions({ prisma, ledgerService, effects: createLedgerEffects({ prisma }), attachmentAccess: null, aiImportService: null, aiRouter: null }),
    ...createFleetMiraiActions({ fleetService, driverService, insuranceService }),
    ...createPfmMiraiActions({ wallets, movements, categories: pfmCategories }),
  ].map((action) => [action.key, action]))

  function viaAction(serviceKey) {
    const actionKey = SERVICE_CONTRACTS[serviceKey].action
    const action = actions.get(actionKey)
    if (!action) throw new Error(`Acción ${actionKey} no encontrada para ${serviceKey}`)
    const nullable = NULLABLE[actionKey] ?? []
    return async (ctx, args) => {
      const input = Object.fromEntries(Object.entries(args).filter(([key, value]) => value !== null || nullable.includes(key)))
      const actx = actionContext(prisma, ctx)
      const prepared = await action.prepare(input, actx)
      if (!prepared || prepared.error) throw new ServiceError(prepared?.error ?? 'No se pudo preparar la operación.', 400, 'rejected')
      const result = await action.execute(prepared.input, actx)
      return { id: result?.id ?? null, summary: result?.summary ?? null, link: result?.link ?? null }
    }
  }

  const handlers = {
    'runly.ledger:accounts.list': async (ctx) => (await readableAccounts(ledgerService, actionContext(prisma, ctx)))
      .map((a) => ({ id: a.id, name: a.name, bank: a.bank ?? null, currency: a.currency, balance: Number(a.current_balance ?? 0) })),
    'runly.ledger:categories.list': async ({ companyId, actorId }) => ((await ledgerCategories.listCategories({ companyId, actorId })).data ?? [])
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind ?? null, system: Boolean(c.is_system) })),
    'runly.ledger:transactions.create': viaAction('runly.ledger:transactions.create'),
    'runly.ledger:transactions.update': viaAction('runly.ledger:transactions.update'),
    'runly.fleet:vehicles.search': async ({ companyId }, args) => {
      const result = await fleetService.listVehicles({ companyId, page: 1, pageSize: args.limit ?? 20, status: args.status ?? undefined, search: args.search ?? undefined })
      return {
        items: result.data.map((r) => ({ id: r.id, plate: r.plate, brand: r.vehicle_brand_name ?? r.brand ?? null, model: r.vehicle_model_name ?? r.model_name ?? null, year: r.vehicle_model_year ?? r.year ?? null, status: r.status, driverName: r.driver_name ?? null })),
        total: result.pagination.total,
      }
    },
    'runly.fleet:drivers.search': async ({ companyId }, args) => {
      const result = await driverService.listDrivers({ companyId, page: 1, pageSize: args.limit ?? 20, status: args.status ?? undefined, search: args.search ?? undefined })
      return {
        items: result.data.map((r) => ({ id: r.id, name: r.full_name, phone: r.phone ?? null, licenseNumber: r.license_number ?? null, status: r.status })),
        total: result.pagination.total,
      }
    },
    'runly.fleet:vehicles.create': viaAction('runly.fleet:vehicles.create'),
    'runly.fleet:vehicles.update': viaAction('runly.fleet:vehicles.update'),
    'runly.fleet:insurance.create': viaAction('runly.fleet:insurance.create'),
    'runly.fleet:insurance.update': viaAction('runly.fleet:insurance.update'),
    'runly.pfm:wallets.list': async ({ companyId, actorId }) => ((await wallets.listWallets({ companyId, actorId })).data ?? [])
      .map((w) => ({ id: w.id, name: w.name, kind: w.kind, currency: w.currency, balance: Number(w.currentBalance ?? 0), bankLinked: Boolean(w.ledgerAccountId) })),
    'runly.pfm:categories.list': async ({ companyId, actorId }, args) => ((await pfmCategories.listCategories({ companyId, actorId, kind: args.kind ?? undefined })).data ?? [])
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind })),
    'runly.pfm:movements.create': viaAction('runly.pfm:movements.create'),
    'runly.pfm:movements.update': viaAction('runly.pfm:movements.update'),
  }

  return { handlers, actions }
}
