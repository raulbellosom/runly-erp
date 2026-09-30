// runly.purchases HTTP routes. Composes the settings, documents, procurement
// and relations routers over one set of services. Auth is applied by
// mountWithAuth(); every route declares its own requirePermission(...) and the
// services assert the company workflow capability (409 CAPABILITY_DISABLED).
import { Hono } from 'hono'
import { createInventoryService } from '../../services/inventory-service.js'
import { createPurchasesService } from '../../services/purchases-service.js'
import { createPurchaseCaseBundle } from '../../services/purchase-case-bundle.js'
import { createRelationHydrator } from '../../services/purchase-relation-hydration.js'
import { createPurchaseListing } from '../../services/purchase-listing.js'
import { createPurchaseDocumentsService } from '../../services/purchase-documents-service.js'
import { createPurchaseProcurementService } from '../../services/purchase-procurement-service.js'
import { createPurchaseReceiptsService } from '../../services/purchase-receipts-service.js'
import { createPurchaseRelationsService } from '../../services/purchase-relations-service.js'
import { createPurchaseInventoryBridge } from '../../services/purchase-inventory-bridge.js'
import { createPurchaseSuppliersService } from '../../services/purchase-suppliers-service.js'
import { createPurchasesSettingsRouter } from './settings-routes.js'
import { createPurchasesDocumentsRouter } from './documents-routes.js'
import { createPurchasesProcurementRouter } from './procurement-routes.js'
import { createPurchasesRelationsRouter } from './relations-routes.js'

export function createPurchasesServices({ prisma, broadcaster, inventoryService, supabaseAdmin }) {
  const workflow = createPurchasesService({ prisma, broadcaster })
  const caseBundle = createPurchaseCaseBundle({ prisma })
  const hydrator = createRelationHydrator({ prisma })
  const deps = { prisma, broadcaster, workflowService: workflow, caseBundle, hydrator }
  let inventory = inventoryService ?? null
  return {
    workflow,
    caseBundle,
    hydrator,
    listing: createPurchaseListing({ prisma }),
    documents: createPurchaseDocumentsService(deps),
    procurement: createPurchaseProcurementService(deps),
    receipts: createPurchaseReceiptsService(deps),
    relations: createPurchaseRelationsService(deps),
    suppliers: createPurchaseSuppliersService({ prisma, broadcaster, supabaseAdmin }),
    inventory: createPurchaseInventoryBridge({
      ...deps,
      // Lazily built so Compras boots and works without runly.inventory.
      getInventoryService: () => (inventory ??= createInventoryService({ prisma })),
    }),
  }
}

export function createPurchasesRouter({ prisma, requirePermission, requireAnyPermission, broadcaster, inventoryService, supabaseAdmin }) {
  const router = new Hono()
  const services = createPurchasesServices({ prisma, broadcaster, inventoryService, supabaseAdmin })
  const deps = { requirePermission, requireAnyPermission, services }
  router.route('/', createPurchasesSettingsRouter(deps))
  router.route('/', createPurchasesRelationsRouter(deps))
  router.route('/', createPurchasesProcurementRouter(deps))
  router.route('/', createPurchasesDocumentsRouter(deps))
  return router
}
