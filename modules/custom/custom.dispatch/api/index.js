import { Hono } from 'hono'
import { createCatalogRouter } from './catalog-routes.js'
import { createTicketRouter } from './ticket-routes.js'
import { createWeighingRouter } from './weighing-routes.js'
import { createExitRouter } from './exit-routes.js'

export default function createDispatchRouter({ prisma, requirePermission, moduleContext }) {
  const app = new Hono()
  app.route('', createCatalogRouter({ prisma, requirePermission }))
  app.route('', createTicketRouter({ prisma, requirePermission }))
  app.route('', createWeighingRouter({ prisma, requirePermission }))
  app.route('', createExitRouter({ prisma, requirePermission, moduleContext }))
  return app
}
