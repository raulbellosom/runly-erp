import { Hono } from 'hono'
import { createCatalogRouter } from './catalog-routes.js'
import { createTicketRouter } from './ticket-routes.js'
import { createWeighingRouter } from './weighing-routes.js'
import { createExitRouter } from './exit-routes.js'
import { dispatchCleanupHandler } from './dispatch-cleanup.js'

export default function createDispatchRouter({ prisma, requirePermission, moduleContext }) {
  // Registers this module's reset/purge-data handler. moduleContext.cleanup is
  // bound to 'custom.dispatch' by the Route Loader — see
  // apps/api/src/services/route-loader-service.js.
  moduleContext?.cleanup?.registerHandler(dispatchCleanupHandler)

  const app = new Hono()
  app.route('', createCatalogRouter({ prisma, requirePermission }))
  app.route('', createTicketRouter({ prisma, requirePermission }))
  app.route('', createWeighingRouter({ prisma, requirePermission }))
  app.route('', createExitRouter({ prisma, requirePermission, moduleContext }))
  return app
}
