// apps/api/src/routes/ledger/index.js
import { Hono } from 'hono'
import { createAccountsRouter }      from './accounts-routes.js'
import { createTypesRouter }          from './types-routes.js'
import { createCategoriesRouter }     from './categories-routes.js'
import { createGroupsRouter }         from './groups-routes.js'
import { createCollaborationRouter }  from './collaboration-routes.js'
import { createAiImportRouter }       from './ai-import-routes.js'

export function createLedgerRouter({ prisma, requirePermission, requireAnyPermission }) {
  const app = new Hono()

  // Fallback for contexts that do not pass requireAnyPermission (e.g. some tests):
  // fall back to gating on the first key.
  const anyPermission =
    typeof requireAnyPermission === 'function'
      ? requireAnyPermission
      : (keys = []) => requirePermission(keys[0])

  app.route('/', createAccountsRouter({ prisma, requirePermission }))
  app.route('/', createTypesRouter({ prisma, requirePermission, requireAnyPermission: anyPermission }))
  app.route('/', createCategoriesRouter({ prisma, requirePermission, requireAnyPermission: anyPermission }))
  app.route('/', createGroupsRouter({ prisma, requirePermission }))
  app.route('/', createCollaborationRouter({ prisma, requirePermission }))
  app.route('/', createAiImportRouter({ prisma, requirePermission }))

  return app
}
