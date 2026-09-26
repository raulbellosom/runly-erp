// apps/api/src/routes/identity/index.js
//
// Composes the identity domain's 4 split route files (roles, users,
// user-detail, permission-grants) into one router, mounted once from
// index.js via mountWithAuth(). Extracted from index.js on 2026-09-25 —
// see identity-shared.js for the shared authorization helpers every one of
// these sub-routers depends on.
import { Hono } from "hono";
import { createIdentityRolesRouter } from "./identity-roles-routes.js";
import { createIdentityUsersRouter } from "./identity-users-routes.js";
import { createIdentityUserDetailRouter } from "./identity-user-detail-routes.js";
import { createIdentityPermissionGrantsRouter } from "./identity-permission-grants-routes.js";

export function createIdentityRouter({
  prisma,
  supabaseAdmin,
  requirePermission,
  getUserContext,
  resolveTenantContext,
  cacheDel,
  cacheDelByPrefix,
  storageBucketName,
}) {
  const app = new Hono();

  app.route("", createIdentityRolesRouter({ prisma, supabaseAdmin, requirePermission, cacheDelByPrefix }));
  app.route("", createIdentityUsersRouter({ prisma, supabaseAdmin, requirePermission, cacheDelByPrefix }));
  app.route("", createIdentityUserDetailRouter({ prisma, supabaseAdmin, requirePermission, cacheDel, cacheDelByPrefix, storageBucketName }));
  app.route("", createIdentityPermissionGrantsRouter({ prisma, getUserContext, resolveTenantContext, cacheDel }));

  return app;
}
