import { createRealtimeAccessService } from './services/realtime-access-service.js';
import { membershipAuthorizationRevision } from './services/membership-authorization-revision.js';
import { createCollaborationInvitationsService } from './services/collaboration-invitations-service.js';
import { createOfficeService } from "./services/office/service.js";
import { createOfficeRouter } from "./routes/office.js";
import { createFilesRouter } from "./routes/files.js";
import { createIdentitySessionsRouter } from "./routes/identity/identity-sessions-routes.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const { PrismaClient } = pkg;
import { createClient } from "@supabase/supabase-js";
import {
  moduleInstallSchema,
  setupInitializeSchema,
} from "@runly/validators";
import { toSlug, ensureSetupAdminRole } from "./lib/tenant-provisioning.js";
import {
  formatLogTimestamp,
  getConfiguredTimeZone,
} from "@runly/core";
import { getPermissionPresentation } from "./permission-catalog.js";
import {
  resolveActiveMembership,
  computeScopedPermissions,
  isSystemAdminMembership,
  createPermissionKeysCache,
  COMPANY_ADMIN_ROLE_KEYS,
} from "./lib/tenant-context.js";
import {
  createFilesService,
} from "./services/files-service.js";
import { createCompanyModuleService } from "./services/company-module-service.js";
import { verifySupabaseJwt } from "./services/jwt-verification.js";
import { createCompanyRouter } from "./routes/company-routes.js";
import { createContactsRouter } from "./routes/contacts-routes.js";
import { createHrRouter } from "./routes/hr-routes.js";
import { createIdentityRouter } from "./routes/identity/index.js";
import { createInventoryService, InventoryServiceError } from "./services/inventory-service.js";
import { createInventoryNotificationService } from "./services/inventory-notification-service.js";
import { createCommentsService, CommentsServiceError } from "./services/comments-service.js";
import { createInventoryRouter } from "./routes/inventory/index.js";
import { createModulesRouter } from "./routes/modules.js";
import {
  createPublicWebsiteRouter,
  createPublicCatalogRouter,
} from "./routes/public-website.js";
import { createPublicFormsRouter } from "./routes/website/forms-public-routes.js";
import { createPublicBookingsRouter } from "./routes/website/bookings-routes.js";
import { createPublicCheckoutRouter } from "./routes/website/checkout-routes.js";
import { createStorefrontRouter } from "./routes/storefront/storefront-router.js";
import { createWebsiteRouter } from "./routes/website/index.js";
import { createLedgerRouter } from "./routes/ledger/index.js";
import { createPfmRouter } from "./routes/pfm/index.js";
import { createUsersRouter } from './routes/users-routes.js'
import { createSearchRouter } from "./routes/search-routes.js";
import { createFleetRouter } from "./routes/fleet/index.js";
import { createCatalogRouter } from "./routes/catalog/index.js";
import { createPosRouter } from "./routes/pos/index.js";
import { createCalendarRouter } from "./routes/calendar/index.js";
import { createProjectsRouter } from "./routes/projects/index.js";
import { createSettingsRouter } from "./routes/settings-routes.js";
import { createActivityRouter } from "./routes/activity.js";
import { createNotificationsRouter } from "./routes/notifications.js";
import { createGrowthRouter } from "./routes/growth/growth-router.js";
import { createDocumentsRouter } from "./routes/documents/documents-router.js";
import { createSyncRouter } from "./routes/sync.js";
import { createPwaRouter } from "./routes/pwa.js";
import { createChatRouter } from "./routes/chat/index.js";
import { createCallsRouter } from "./routes/calls/index.js";
import { createNotesRouter } from "./routes/notes/index.js";
import { createSupportRouter } from "./routes/support-routes.js";
import { createSharesService as createNotesSharesService } from "./routes/notes/shares-service.js";
import { createCanvasService as createNotesCanvasService } from "./routes/notes/canvas-service.js";
import { createYDocService as createNotesYDocService } from "./routes/notes/ydoc-service.js";
import {
  publishActivityFromContext,
  getActivityContext,
} from "./services/activity-publisher.js";
import { createModuleBundlerService } from "./services/module-bundler-service.js";
import { createRouteLoaderService } from "./services/route-loader-service.js";
import { createDistServeService } from "./services/dist-serve-service.js";
import { createNotificationDeliveryWorker } from "./services/notification-delivery-worker.js";
import { createNotificationService } from "./services/notification-service.js";
import { createRealtimeBroadcaster } from "./services/realtime-broadcaster.js";
import { createSmtpService } from "./services/smtp-service.js";
import { sendPasswordResetEmail } from "./lib/send-password-reset-email.js";
import { uploadIdentityAvatar } from "./lib/upload-identity-avatar.js";
import { getSignedUrlByFileId } from "./lib/signed-url-by-file-id.js";
import { isForgotPasswordRateLimited } from "./lib/forgot-password-rate-limit.js";
import { createCompanyBrandService } from "./services/company-brand-service.js";
import {
  get as cacheGet,
  set as cacheSet,
  del as cacheDel,
  delByPrefix as cacheDelByPrefix,
  TTL,
} from "./lib/cache.js";
import { loadInstallerLiveKitDevEnv } from "./lib/livekit-dev-env.js";
import { getCachedSignedUrls } from "./lib/signed-url-cache.js";
import { wrapStorageForPublicUrls } from "./lib/supabase-public-url.js";
import { buildAvatarUrlMapByFileIds } from "./lib/avatar-url-map.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({
  path: [
    path.resolve(currentDir, "../.env.local"),
    path.resolve(currentDir, "../.env"),
    path.resolve(currentDir, "../../../.env.local"),
    path.resolve(currentDir, "../../../.env"),
  ],
});
if (loadInstallerLiveKitDevEnv({ currentDir })) {
  console.log("[env] LiveKit development config loaded from infra/installer/.env.local");
}

const prismaConnectionString =
  process.env.DATABASE_URL ?? process.env.DIRECT_URL;
// Use an explicit pg Pool with keepAlive so firewalls/VPS idle timeouts don't
// silently drop connections and cause "Connection terminated unexpectedly" crashes.
const pgPool = new pg.Pool({
  connectionString: prismaConnectionString,
  max: 20,
  min: 0,                         // don't hold idle connections — NAT/firewall kills them silently
  idleTimeoutMillis: 20000,       // release connections after 20s idle
  connectionTimeoutMillis: 30000, // remote VPS can be slow on cold start — give 30s
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

// Log and recover from pool-level errors (e.g. VPS firewall dropping idle conns)
pgPool.on("error", (err) => {
  console.error("[pg-pool] client error (pool will recover):", err?.message ?? err);
});
const prismaAdapter = new PrismaPg(pgPool);
const prisma = new PrismaClient({ adapter: prismaAdapter });

const getAllActivePermissionKeys = createPermissionKeysCache({
  prisma,
  cacheGet,
  cacheSet,
  ttlSeconds: TTL.PERMISSIONS,
});
// Exported so opt-in integration tests (see
// apps/api/src/__tests__/cross-tenant/) can call app.request(...) in-process
// against the real Hono app + real Prisma client, without needing to bind an
// actual TCP port. This export has no effect on normal `node src/index.js`
// execution — the server still boots exactly as before, below.
export const app = new Hono();
const port = Number(process.env.RUNLY_API_PORT ?? 4010);

// Wrapped so every signed/public Storage URL this instance mints (and every
// service/route below that receives it) is rewritten to RUNLY_SUPABASE_PUBLIC_URL
// before it reaches the browser — see lib/supabase-public-url.js. Uploads,
// downloads and signing requests still go straight to SUPABASE_URL internally.
const supabaseAdmin = wrapStorageForPublicUrls(
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY),
  process.env,
);
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);
const broadcaster = createRealtimeBroadcaster({
  prisma,
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const STORAGE_BUCKET_NAME = "runly-files";
const STOREFRONT_BUCKET_NAME = "runly-storefront";
const WEBSITE_BUCKET_NAME = "runly-website";
const filesService = createFilesService({ prisma, supabaseAdmin });
const officeService = createOfficeService({ prisma, supabaseAdmin, broadcaster });
const bundlerService = createModuleBundlerService({ prisma, supabaseAdmin });
const companyModuleService = createCompanyModuleService({ prisma });
const notificationDeliveryWorker = createNotificationDeliveryWorker({ prisma, supabaseAdmin });
const notificationService = createNotificationService({ prisma, broadcaster });
const distServeService = createDistServeService({ prisma, supabaseAdmin });
const inventoryService = createInventoryService({ prisma });
const inventoryNotifSvc = createInventoryNotificationService({ prisma, notificationService });
const commentsService = createCommentsService({ prisma });

function translateSupabaseCreateUserError(error) {
  const msg = error?.message?.toLowerCase?.() ?? "";
  if (
    msg.includes("already") ||
    msg.includes("registered") ||
    msg.includes("duplicate")
  ) {
    return "Ya existe un usuario con ese correo electrónico.";
  }
  if (msg.includes("password")) {
    return "La contraseña no cumple los requisitos de seguridad.";
  }
  return (
    error?.message ||
    "No se pudo crear el usuario administrador en Supabase Auth."
  );
}

function mapSetupError(err) {
  if (err?.message === "Logo upload failed") {
    return {
      status: 500,
      error: "No se pudo subir el logotipo.",
    };
  }
  if (err?.code === "P2022") {
    return {
      status: 500,
      error:
        "La base de datos está desactualizada. Ejecuta: pnpm db:migrate && pnpm db:seed",
    };
  }
  if (err?.code === "P2002") {
    return {
      status: 409,
      error:
        "Ya existe un registro con datos únicos duplicados (correo, slug o RFC).",
    };
  }
  if (err?.code === "P1001" || err?.code === "P1002") {
    return {
      status: 503,
      error:
        "No se pudo conectar a PostgreSQL. Verifica la conexión de base de datos y vuelve a intentar.",
    };
  }
  return { status: 500, error: "Error interno al inicializar la instancia." };
}

async function authMiddleware(c, next) {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token)
    return c.json({ error: "No autorizado. Debes iniciar sesion." }, 401);

  const cacheKey = `auth:token:${token.slice(-32)}`;
  let userId = cacheGet(cacheKey);
  if (!userId) {
    // Prefer local JWT verification — no network call, resilient to VPS connectivity issues.
    // SUPABASE_JWT_SECRET is the secret Supabase uses to sign its access tokens.
    const jwtSecret = process.env.SUPABASE_JWT_SECRET;
    const payload = jwtSecret ? verifySupabaseJwt(token, jwtSecret) : null;

    if (payload?.sub) {
      userId = payload.sub;
      // Cache until token expiry minus 30s buffer (cap at 5 min for safety)
      const ttlSecs = payload.exp
        ? Math.min(payload.exp - Math.floor(Date.now() / 1000) - 30, 300)
        : TTL.USER_CONTEXT;
      if (ttlSecs > 0) cacheSet(cacheKey, userId, ttlSecs);
    } else {
      // Fallback: verify via Supabase network call (handles unknown alg, rotated secrets)
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !data.user) {
        return c.json({ error: "No autorizado. Token invalido o expirado." }, 401);
      }
      userId = data.user.id;
      cacheSet(cacheKey, userId, TTL.USER_CONTEXT);
    }
  }

  c.set("authUserId", userId);
  await next();
}

const ADMIN_ROLE_KEYS = new Set(["runly.admin", "system.admin"]);
const BASE_PERMISSION_KEYS = new Set(["profile.self.read"]);

const _userContextInFlight = new Map();

async function getUserContextByAuthId(authUserId) {
  const cacheKey = `user_ctx:${authUserId}`;
  // Authorization is loaded for every request. A cached membership must not
  // survive revocation, including writes made by a different API process.

  // Deduplicate concurrent requests for the same user — only one DB round-trip
  if (_userContextInFlight.has(authUserId)) {
    return _userContextInFlight.get(authUserId);
  }

  const promise = _loadUserContext(authUserId, cacheKey).finally(() => {
    _userContextInFlight.delete(authUserId);
  });
  _userContextInFlight.set(authUserId, promise);
  return promise;
}

async function _loadUserContext(authUserId, cacheKey) {

  const profile = await prisma.userProfile.findUnique({
    where: { authUserId },
  });
  if (!profile?.enabled) return null;
  const memberships = await prisma.membership.findMany({
    where: { userId: profile.id, enabled: true },
    include: {
      company: { select: { id: true, name: true, slug: true, enabled: true } },
      role: {
        include: {
          permissions: {
            where: { permission: { active: true } },
            include: {
              permission: {
                select: { key: true },
              },
            },
          },
        },
      },
    },
  });

  const activeMemberships = memberships.filter((membership) =>
    Boolean(membership?.role?.enabled !== false && membership?.company?.enabled
      && (!membership.role?.companyId || membership.role.companyId === membership.companyId)),
  );
  const adminMembership = activeMemberships.find((membership) =>
    ADMIN_ROLE_KEYS.has(membership?.role?.key),
  );
  const roleKey =
    adminMembership?.role?.key ?? activeMemberships[0]?.role?.key ?? null;
  const isAdmin = ADMIN_ROLE_KEYS.has(roleKey);
  const permissionSet = new Set(BASE_PERMISSION_KEYS);
  const roleKeySet = new Set();
  for (const membership of activeMemberships) {
    for (const rolePermission of membership.role?.permissions ?? []) {
      const key = rolePermission?.permission?.key;
      if (key) { permissionSet.add(key); roleKeySet.add(key); }
    }
  }

  // Additive per-user grants (ALLOW-only). Union with the role's permissions;
  // never subtracts. Scoped to the companies of the active memberships, active
  // permissions only. See
  // docs/superpowers/specs/2026-09-08-per-user-permission-grants.md
  //
  // grantsByCompany additionally keeps the SAME rows broken out per company
  // (not merged), so a per-request tenant resolution (see resolveTenantContext,
  // apps/api/src/lib/tenant-context.js) can apply only the active company's
  // grants instead of this file's own legacy cross-company union below.
  // See docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md
  const grantKeySet = new Set();
  const grantsByCompany = new Map();
  const grantCompanyIds = [...new Set(activeMemberships.map((m) => m.companyId).filter(Boolean))];
  if (grantCompanyIds.length) {
    const grants = await prisma.userPermissionGrant.findMany({
      where: {
        userId: profile.id,
        companyId: { in: grantCompanyIds },
        permission: { active: true },
      },
      include: { permission: { select: { key: true } } },
    });
    for (const g of grants) {
      const key = g.permission?.key;
      if (!key) continue;
      permissionSet.add(key);
      grantKeySet.add(key);
      if (!grantsByCompany.has(g.companyId)) grantsByCompany.set(g.companyId, new Set());
      grantsByCompany.get(g.companyId).add(key);
    }
  }

  if (isAdmin) {
    const allPermissions = await prisma.permission.findMany({
      where: { active: true },
      select: { key: true },
      take: 1000,
    });
    for (const permission of allPermissions) {
      permissionSet.add(permission.key);
    }
  }

  const context = {
    profile,
    memberships: activeMemberships,
    grantsByCompany,
    roleKey,
    isAdmin,
    permissions: [...permissionSet].sort(),
    permissionSet,
    roleKeys: [...roleKeySet].sort(),
    grantKeys: [...grantKeySet].sort(),
  };
  cacheSet(cacheKey, context, TTL.USER_CONTEXT);
  return context;
}

async function getOrLoadUserContext(c) {
  const current = c.get("userContext");
  if (current) return current;
  const authUserId = c.get("authUserId");
  if (!authUserId) return null;
  try {
    const context = await getUserContextByAuthId(authUserId);
    if (!context) return null;
    c.set("userContext", context);
    return context;
  } catch (err) {
    console.error("[getOrLoadUserContext] DB error:", err?.message ?? err);
    if (err?.stack) console.error(err.stack);
    return null;
  }
}

// Resolves the single active company for THIS request from the
// X-Runly-Company-Id header, validated against the caller's own
// memberships, and computes permissions scoped to only that company. See
// docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
//
// strict=true (default): ambiguous multi-company requests with no header are
// a 400 — used by requirePermission/requireAnyPermission, the gate in front
// of actual tenant-scoped business data.
// strict=false: ambiguous resolves to "no active company" instead of erroring
// — used by bootstrap-time endpoints (requireModuleAccess, /runtime/modules,
// /blueprints, /user/me) that must stay reachable before the frontend has
// necessarily chosen a company yet.
export async function resolveTenantContext(c, context, { strict = true } = {}) {
  const requestedCompanyId = c.req.header("X-Runly-Company-Id") || null;
  const result = resolveActiveMembership({
    memberships: context.memberships,
    requestedCompanyId,
    strict,
  });
  if (!result.ok) {
    return {
      ok: false,
      response: c.json({ error: result.code, message: result.message }, result.status),
    };
  }

  const activeMembership = result.membership;
  const isSystemAdmin = isSystemAdminMembership(context.memberships);
  const roleKey = activeMembership?.role?.key ?? null;
  const isCompanyAdminRole = Boolean(roleKey && COMPANY_ADMIN_ROLE_KEYS.has(roleKey));

  let grantKeysForCompany = [];
  if (activeMembership) {
    const set = context.grantsByCompany?.get(activeMembership.companyId);
    if (set) grantKeysForCompany = [...set];
  }

  const allPermissionKeys =
    isSystemAdmin || isCompanyAdminRole ? await getAllActivePermissionKeys() : [];

  const { permissionSet, isCompanyAdmin } = computeScopedPermissions({
    activeMembership,
    grantKeysForCompany,
    allPermissionKeys,
    basePermissionKeys: [...BASE_PERMISSION_KEYS],
    isSystemAdmin,
  });

  return {
    ok: true,
    tenant: {
      companyId: activeMembership?.companyId ?? null,
      membership: activeMembership,
      role: activeMembership?.role ?? null,
      permissionSet,
      isCompanyAdmin,
      isSystemAdmin,
      // Deprecated alias kept for the Plan 1/2 migration window — every
      // function that still reads context.isAdmin for an authorization
      // decision (userCanAccessModule, filterModuleNavigation) accepts this
      // same shape. See spec §5.2.
      isAdmin: isCompanyAdmin || isSystemAdmin,
    },
  };
}

function forbiddenMessage(permissionKey) {
  if (!permissionKey) return "No tienes permisos para realizar esta accion.";
  const label = getPermissionPresentation(permissionKey).name.toLowerCase();
  return `No tienes permisos para ${label}.`;
}

function requirePermission(permissionKey) {
  return async (c, next) => {
    const context = await getOrLoadUserContext(c);
    if (!context?.profile) {
      return c.json(
        { error: "No autorizado. Perfil de usuario no encontrado." },
        401,
      );
    }
    const resolved = await resolveTenantContext(c, context);
    if (!resolved.ok) return resolved.response;
    const { tenant } = resolved;
    c.set("companyId", tenant.companyId);
    c.set("tenantContext", tenant);
    c.set("userContext", { ...context, isAdmin: tenant.isAdmin, permissionSet: tenant.permissionSet });
    c.set("userId", context.profile.id);
    if (tenant.isAdmin || tenant.permissionSet.has(permissionKey)) {
      await next();
      return;
    }
    return c.json({ error: forbiddenMessage(permissionKey) }, 403);
  };
}

function requireAnyPermission(permissionKeys = []) {
  return async (c, next) => {
    const context = await getOrLoadUserContext(c);
    if (!context?.profile) {
      return c.json(
        { error: "No autorizado. Perfil de usuario no encontrado." },
        401,
      );
    }
    const resolved = await resolveTenantContext(c, context);
    if (!resolved.ok) return resolved.response;
    const { tenant } = resolved;
    c.set("companyId", tenant.companyId);
    c.set("tenantContext", tenant);
    c.set("userContext", { ...context, isAdmin: tenant.isAdmin, permissionSet: tenant.permissionSet });
    c.set("userId", context.profile.id);
    if (tenant.isAdmin) {
      await next();
      return;
    }
    const keys = Array.isArray(permissionKeys) ? permissionKeys : [];
    const allowed = keys.some((key) => tenant.permissionSet.has(key));
    if (!allowed) {
      return c.json({ error: forbiddenMessage(keys.join(" o ")) }, 403);
    }
    await next();
  };
}

function getModuleRequiredPermission(moduleRow) {
  const manifest = moduleRow?.manifest ?? {};
  const aclModule = manifest?.acl?.module;
  if (typeof aclModule === "string" && aclModule.trim().length > 0) {
    return aclModule.trim();
  }
  return null;
}

function filterModuleNavigation(moduleRow, permissionSet, isAdmin) {
  const manifest = moduleRow?.manifest ?? {};
  const navigation = Array.isArray(manifest.navigation)
    ? manifest.navigation
    : [];
  const filteredNavigation = navigation.filter((item) => {
    const navPermission = item?.permissionKey;
    if (isAdmin) return true;
    if (!navPermission) return false;
    return permissionSet.has(navPermission);
  });
  return {
    ...manifest,
    navigation: filteredNavigation,
  };
}

function userCanAccessModule(context, moduleRow) {
  if (!context) return false;
  if (context.isAdmin) return true;
  const modulePermission = getModuleRequiredPermission(moduleRow);
  if (!modulePermission) return false;
  return context.permissionSet.has(modulePermission);
}

function requireModuleAccess(moduleKey) {
  return async (c, next) => {
    const context = await getOrLoadUserContext(c);
    if (!context?.profile) {
      return c.json(
        { error: "No autorizado. Perfil de usuario no encontrado." },
        401,
      );
    }
    const resolved = await resolveTenantContext(c, context, { strict: false });
    if (!resolved.ok) return resolved.response;
    const { tenant } = resolved;
    c.set("companyId", tenant.companyId);
    c.set("tenantContext", tenant);
    c.set("userContext", { ...context, isAdmin: tenant.isAdmin, permissionSet: tenant.permissionSet });
    const moduleRow = await prisma.runlyModule.findUnique({
      where: { key: moduleKey },
      select: {
        key: true,
        status: true,
        enabled: true,
        manifest: true,
      },
    });
    if (!moduleRow) {
      return c.json({ error: "Modulo no encontrado." }, 404);
    }
    if (!userCanAccessModule(tenant, moduleRow)) {
      return c.json(
        { error: `No tienes permisos para acceder al modulo ${moduleKey}.` },
        403,
      );
    }
    await next();
  };
}

async function syncAdminRolesPermissions(db) {
  const adminRoles = await db.role.findMany({
    where: { key: { in: ["runly.admin", "system.admin"] } },
    select: { id: true },
  });
  if (adminRoles.length === 0) return;

  const permissions = await db.permission.findMany({
    select: { id: true },
  });

  for (const adminRole of adminRoles) {
    await db.rolePermission.deleteMany({
      where: { roleId: adminRole.id },
    });
    if (!permissions.length) continue;
    await db.rolePermission.createMany({
      data: permissions.map((permission) => ({
        roleId: adminRole.id,
        permissionId: permission.id,
      })),
      skipDuplicates: true,
    });
  }
}

const companyBrandService = createCompanyBrandService({ prisma, supabaseAdmin });

async function ensureBuckets() {
  // Self-hosted Supabase Storage has been observed to silently reject
  // createBucket calls that pass `public: true` (and/or a non-null
  // allowedMimeTypes) up front — the request never creates the bucket at
  // all, and since every call site here is wrapped in .catch(() => {}), that
  // failure was previously invisible. createBucket() with only the minimal,
  // always-accepted { public: false } shape is what has actually been
  // proven to work end-to-end; every bucket is created that way first, then
  // its real desired config (public/size/mime types) is applied via a
  // direct SQL UPDATE against storage.buckets — the same workaround this
  // function already needed for WEBSITE_BUCKET_NAME's allowedMimeTypes:null
  // case, now applied uniformly instead of only where it was first noticed.
  async function ensureBucket(name, { public: isPublic, fileSizeLimit = null, allowedMimeTypes = null } = {}) {
    await supabaseAdmin.storage.createBucket(name, { public: false }).catch(() => {});
    await prisma.$executeRaw`
      UPDATE storage.buckets
      SET public = ${isPublic}, allowed_mime_types = ${allowedMimeTypes}::text[], file_size_limit = ${fileSizeLimit}
      WHERE id = ${name}
    `.catch((e) => console.error(`[ensureBuckets] SQL update failed for ${name}:`, e.message));
  }
  await ensureBucket(STORAGE_BUCKET_NAME, { public: false });
  await ensureBucket(STOREFRONT_BUCKET_NAME, {
    public: true,
    fileSizeLimit: 104857600,
    allowedMimeTypes: ['image/*', 'audio/*', 'video/*', 'application/pdf'],
  });
  await ensureBucket(WEBSITE_BUCKET_NAME, { public: true, fileSizeLimit: 104857600, allowedMimeTypes: null });
  await ensureBucket("runly-chat", { public: false, fileSizeLimit: 52428800 }); // 50 MB
  await ensureBucket("runly-notes", { public: true, fileSizeLimit: 20971520, allowedMimeTypes: ['image/*'] }); // 20 MB
}

function serializeModulesForResponse(modules, context, options = {}) {
  const { filterByPermission = false, filterNavigation = false } = options;

  return modules
    .filter((moduleRow) => {
      if (!filterByPermission) return true;
      return userCanAccessModule(context, moduleRow);
    })
    .map((mod) => {
      const compatibility = mod.dependencies.map((dep) => {
        const active =
          dep.dependency?.status === "INSTALLED" && dep.dependency?.enabled;
        return {
          key: dep.dependency?.key,
          name: dep.dependency?.name,
          required: !dep.optional,
          versionRange: dep.versionRange ?? null,
          active: Boolean(active),
        };
      });
      const blocking = compatibility.filter(
        (dep) => dep.required && !dep.active,
      );
      const manifest =
        filterNavigation && context
          ? filterModuleNavigation(mod, context.permissionSet, context.isAdmin)
          : mod.manifest;
      return {
        ...mod,
        manifest,
        compatibility,
        compatibilityStatus: blocking.length === 0 ? "OK" : "BLOCKED",
        compatibilityBlocking: blocking,
      };
    });
}

const routeLoader = createRouteLoaderService({
  prisma,
  authMiddleware,
  requirePermission,
  cache: {
    get: cacheGet,
    set: cacheSet,
    del: cacheDel,
    delByPrefix: cacheDelByPrefix,
    TTL,
  },
});

app.use(
  "*",
  cors({
    origin: (origin) => origin || "*",
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Runly-Company", "X-Runly-Company-Id", "X-Runly-Site", "Idempotency-Key"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Runly-Company", "X-Runly-Company-Id"],
  }),
);

await routeLoader.initialize(app);
await bundlerService.restoreModuleBundlesOnBoot();
// The dev watcher holds an open fs.watch handle that keeps the process alive
// indefinitely — desired for `node --watch src/index.js`, but it would
// prevent the opt-in cross-tenant test suite (which imports this module,
// see ATLAS_API_TEST_MODE above) from ever exiting after its tests finish.
if (process.env.RUNLY_API_TEST_MODE !== "1") {
  bundlerService.startDevWatcher();
}

ensureBuckets();

app.get("/health", (c) => {
  const now = new Date();
  return c.json({
    ok: true,
    name: "Runly API",
    time: now.toISOString(),
    localTime: formatLogTimestamp(now),
    timeZone: getConfiguredTimeZone(),
  });
});

// Public, unauthenticated self-service password recovery for the login
// screen. Always answers with the same generic message so this can't be
// used to enumerate which emails have an account.
app.post("/auth/forgot-password", async (c) => {
  const GENERIC_RESPONSE = {
    data: { ok: true, message: "Si el correo existe, enviamos un enlace para restablecer la contraseña." },
  };
  try {
    const body = await c.req.json().catch(() => ({}));
    const email = String(body?.email ?? "").trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return c.json({ error: "Ingresa un correo válido." }, 400);
    }
    if (isForgotPasswordRateLimited(email)) {
      return c.json(GENERIC_RESPONSE);
    }
    await sendPasswordResetEmail(email, { requestedByAdmin: false, prisma, supabaseAdmin, companyBrandService });
    return c.json(GENERIC_RESPONSE);
  } catch {
    return c.json(GENERIC_RESPONSE);
  }
});

const BRAND_DIR = path.resolve(currentDir, "../../../apps/desktop/public/brand");
const ALLOWED_BRAND_FILES = new Set([
  "runly-logo-horizontal.png",
  "runly-logo-primary.png",
  "runly-logo-isotype.png",
  "runly-logo-vertical.png",
  "runly-logo-monochrome-light.png",
  "runly-logo-monochrome-dark.png",
]);
app.get("/brand/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (!ALLOWED_BRAND_FILES.has(filename)) return c.notFound();
  const filePath = path.join(BRAND_DIR, filename);
  try {
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return c.notFound();
  }
});

// Public notes — no auth. Registered early so it's never wrapped by auth middleware.
const _publicNotesShares = createNotesSharesService({ prisma, broadcaster });
const _publicNotesCanvas = createNotesCanvasService({ prisma });
const _publicNotesYDoc = createNotesYDocService({ prisma });
app.get("/public/notes/:slug", async (c) => {
  try {
    const slug = c.req.param("slug");
    const note = await _publicNotesShares.getPublicNote(slug);
    return c.json({ note });
  } catch (e) {
    return c.json({ error: e.message }, e.status ?? 500);
  }
});

// Public canvas scene — no auth. Sibling of GET /public/notes/:slug above;
// registered here so it is never wrapped by auth middleware.
app.get("/public/notes/:slug/canvas", async (c) => {
  try {
    const slug = c.req.param("slug");
    const scene = await _publicNotesCanvas.getPublicScene(slug);
    return c.json({ scene });
  } catch (e) {
    return c.json({ error: e.message }, e.status ?? 500);
  }
});

// Public Y.js document state — no auth. Lets the public note page join the
// same `note:ydoc:<id>` realtime broadcast topic (anon, receive-only — see
// migration 20260919120000_notes_ydoc_public_realtime) and render edits live
// instead of only refreshing on tab focus.
app.get("/public/notes/:slug/ydoc", async (c) => {
  try {
    const slug = c.req.param("slug");
    const data = await _publicNotesYDoc.getPublicState(slug);
    return c.json({ data });
  } catch (e) {
    return c.json({ error: e.message }, e.status ?? 500);
  }
});

app.get("/instance/status", async (c) => {
  try {
    const record = await prisma.instanceConfig.findUnique({
      where: { key: "initialized" },
    });
    const initialized = record?.value === "true";

    if (!initialized) {
      return c.json({ initialized: false, branding: null });
    }

    const companyIdRecord = await prisma.instanceConfig.findUnique({
      where: { key: "company_id" },
    });
    const company = companyIdRecord?.value
      ? await prisma.company.findUnique({
          where: { id: companyIdRecord.value },
          select: { name: true },
        })
      : null;
    const brandingConfig = companyIdRecord?.value
      ? await prisma.brandingConfig.findFirst({
          where: { companyId: companyIdRecord.value },
        })
      : null;

    let logoUrl = null;
    if (brandingConfig?.logoFileId) {
      const fileAsset = await prisma.fileAsset.findUnique({
        where: { id: brandingConfig.logoFileId },
        // Instance boot only needs the storage pointer, not the document schema.
        select: { bucket: true, objectKey: true },
      });
      if (fileAsset) {
        const { data: signedData } = await supabaseAdmin.storage
          .from(fileAsset.bucket)
          .createSignedUrl(fileAsset.objectKey, 3600);
        logoUrl = signedData?.signedUrl ?? null;
      }
    }

    return c.json({
      initialized: true,
      branding: {
        companyName: company?.name ?? null,
        primaryColor: brandingConfig?.primaryColor ?? "#0A7BFF",
        logoUrl,
      },
    });
  } catch {
    return c.json({ error: "Unable to read instance state" }, 503);
  }
});

app.post("/setup/initialize", async (c) => {
  try {
    const existing = await prisma.instanceConfig.findUnique({
      where: { key: "initialized" },
    });
    if (existing?.value === "true") {
      return c.json({ error: "Already initialized" }, 409);
    }

    const body = await c.req.parseBody();
    const fields = setupInitializeSchema.parse({
      adminFirstName: body.adminFirstName || undefined,
      adminLastName: body.adminLastName || undefined,
      adminEmail: body.adminEmail,
      adminPassword: body.adminPassword,
      companyName: body.companyName,
      primaryColor: body.primaryColor,
      legalName: body.legalName || undefined,
      rfc: body.rfc || undefined,
      companyType: body.companyType || undefined,
      companyTypeName: body.companyTypeName || undefined,
      companyIndustryKey: body.companyIndustryKey || undefined,
      companyIndustryName: body.companyIndustryName || undefined,
      companySize: body.companySize || undefined,
      contactEmail: body.contactEmail || undefined,
      phone: body.phone || undefined,
      website: body.website || undefined,
      country: body.country || undefined,
      state: body.state || undefined,
      city: body.city || undefined,
      colony: body.colony || undefined,
      street: body.street || undefined,
      extNumber: body.extNumber || undefined,
      intNumber: body.intNumber || undefined,
      postalCode: body.postalCode || undefined,
    });

    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email: fields.adminEmail,
        password: fields.adminPassword,
        email_confirm: true,
      });
    if (authError)
      return c.json(
        { error: translateSupabaseCreateUserError(authError) },
        400,
      );
    const authUserId = authData.user.id;

    const logoFile = body.logo;
    if (logoFile && logoFile instanceof File && logoFile.size > 0) {
      if (logoFile.size > 10 * 1024 * 1024) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        return c.json({ error: "Logo must be under 10 MB" }, 400);
      }
    }

    try {
      const slug = toSlug(fields.companyName);
      const now = new Date().toISOString();

      await prisma.$transaction(async (tx) => {
        const adminRole = await ensureSetupAdminRole(tx);
        const company = await tx.company.create({
          data: {
            name: fields.companyName,
            slug,
            legalName: fields.legalName,
            rfc: fields.rfc,
            companyType: fields.companyType,
            companyTypeName: fields.companyTypeName,
            industryKey: fields.companyIndustryKey,
            industryName: fields.companyIndustryName,
            companySize: fields.companySize,
            contactEmail: fields.contactEmail || null,
            phone: fields.phone || null,
            website: fields.website || null,
            country: fields.country,
            state: fields.state,
            city: fields.city,
            colony: fields.colony || null,
            street: fields.street,
            extNumber: fields.extNumber,
            intNumber: fields.intNumber,
            postalCode: fields.postalCode,
          },
        });
        const userProfile = await tx.userProfile.create({
          data: {
            authUserId,
            firstName: fields.adminFirstName,
            lastName: fields.adminLastName,
            displayName:
              `${fields.adminFirstName} ${fields.adminLastName}`.trim(),
            email: fields.adminEmail,
          },
        });
        await tx.membership.create({
          data: {
            companyId: company.id,
            userId: userProfile.id,
            roleId: adminRole.id,
          },
        });
        let logoFileAssetId = null;
        if (logoFile && logoFile instanceof File && logoFile.size > 0) {
          const ext = logoFile.name.split(".").pop() || "png";
          const random = Math.random().toString(36).slice(2, 10);
          const objectKey = `company/branding/${company.id}/logo-${Date.now()}-${random}.${ext}`;
          const arrayBuffer = await logoFile.arrayBuffer();
          const { error: storageError } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET_NAME)
            .upload(objectKey, arrayBuffer, {
              contentType: logoFile.type,
              upsert: false,
            });
          if (storageError) {
            throw new Error("Logo upload failed");
          }

          const fileAsset = await tx.fileAsset.create({
            data: {
              bucket: STORAGE_BUCKET_NAME,
              objectKey,
              originalName: logoFile.name,
              mimeType: logoFile.type,
              sizeBytes: logoFile.size,
              moduleKey: "runly.company",
              entityType: "BrandingConfig",
              entityId: company.id,
            },
          });
          logoFileAssetId = fileAsset.id;
        }
        await tx.brandingConfig.create({
          data: {
            companyId: company.id,
            primaryColor: fields.primaryColor,
            logoFileId: logoFileAssetId,
          },
        });
        await tx.instanceConfig.upsert({
          where: { key: "initialized" },
          update: { value: "true" },
          create: { key: "initialized", value: "true" },
        });
        await tx.instanceConfig.upsert({
          where: { key: "company_id" },
          update: { value: company.id },
          create: { key: "company_id", value: company.id },
        });
        await tx.instanceConfig.upsert({
          where: { key: "primary_company_id" },
          update: {},
          create: { key: "primary_company_id", value: company.id },
        });
        await tx.instanceConfig.upsert({
          where: { key: "completed_at" },
          update: { value: now },
          create: { key: "completed_at", value: now },
        });
        // Seed defaults so these keys always exist after initialization.
        // Users can override them later from Settings → General.
        await tx.instanceConfig.upsert({
          where: { key: "instance_name" },
          update: {},
          create: { key: "instance_name", value: fields.companyName },
        });
        await tx.instanceConfig.upsert({
          where: { key: "instance_time_zone" },
          update: {},
          create: { key: "instance_time_zone", value: "America/Mexico_City" },
        });
        await tx.instanceConfig.upsert({
          where: { key: "instance_currency" },
          update: {},
          create: { key: "instance_currency", value: "MXN" },
        });
      });
      await syncAdminRolesPermissions(prisma);

      return c.json({ ok: true });
    } catch (txError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
      throw txError;
    }
  } catch (err) {
    if (err?.name === "ZodError")
      return c.json(
        {
          error:
            err.errors?.[0]?.message ?? "Error de validación en el formulario.",
        },
        400,
      );
    console.error("[setup/initialize]", err);
    const mapped = mapSetupError(err);
    return c.json({ error: mapped.error }, mapped.status);
  }
});

app.get("/user/me", authMiddleware, async (c) => {
  const authUserId = c.get("authUserId");
  try {
    const context = await getOrLoadUserContext(c);
    if (!context?.profile) return c.json({ error: "Profile not found" }, 404);
    const resolved = await resolveTenantContext(c, context, { strict: false });
    if (!resolved.ok) return resolved.response;
    const { tenant } = resolved;
    const avatarUrl = await getSignedUrlByFileId(
      context.profile.avatarFileId,
      "card",
      { prisma, supabaseAdmin },
    );
    return c.json({
      id: context.profile.id,
      firstName: context.profile.firstName,
      lastName: context.profile.lastName,
      displayName: context.profile.displayName,
      email: context.profile.email,
      avatarUrl,
      role: tenant.role?.key ?? null,
      isAdmin: tenant.isAdmin,
      // Distinct from isAdmin (company admin OR system admin): only a true
      // platform-scope admin can create new companies (see POST /companies)
      // or manage another company's modules — a company-scoped runly.admin
      // must not see those affordances.
      isSystemAdmin: tenant.isSystemAdmin,
      permissions: [...tenant.permissionSet].sort(),
      colony: context.profile.colony,
      companyId: tenant.companyId,
      availableForChat: context.profile.availableForChat ?? false,
    });
  } catch {
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get(
  "/profile/me",
  authMiddleware,
  requirePermission("profile.self.read"),
  async (c) => {
    const authUserId = c.get("authUserId");
    try {
      const context = await getOrLoadUserContext(c);
      if (!context?.profile)
        return c.json({ error: "Perfil no encontrado." }, 404);
      const avatarUrl = await getSignedUrlByFileId(
        context.profile.avatarFileId,
        "card",
        { prisma, supabaseAdmin },
      );
      return c.json({
        data: {
          id: context.profile.id,
          firstName: context.profile.firstName,
          lastName: context.profile.lastName,
          displayName: context.profile.displayName,
          email: context.profile.email,
          avatarUrl,
          avatarFileId: context.profile.avatarFileId,
          birthDate: context.profile.birthDate,
          gender: context.profile.gender,
          phone: context.profile.phone,
          country: context.profile.country,
          state: context.profile.state,
          city: context.profile.city,
          colony: context.profile.colony,
          street: context.profile.street,
          extNumber: context.profile.extNumber,
          intNumber: context.profile.intNumber,
          postalCode: context.profile.postalCode,
          bio: context.profile.bio,
          role: context.roleKey,
        },
      });
    } catch {
      return c.json({ error: "No se pudo cargar el perfil." }, 500);
    }
  },
);

app.put(
  "/profile/me",
  authMiddleware,
  requirePermission("profile.self.update"),
  async (c) => {
    const authUserId = c.get("authUserId");
    try {
      const context = await getOrLoadUserContext(c);
      if (!context?.profile)
        return c.json({ error: "Perfil no encontrado." }, 404);
      const body = await c.req.json();
      const firstName = String(
        body.firstName ?? context.profile.firstName ?? "",
      ).trim();
      const lastName = String(
        body.lastName ?? context.profile.lastName ?? "",
      ).trim();
      if (!firstName || !lastName) {
        return c.json({ error: "Nombre y apellidos son obligatorios." }, 400);
      }
      const birthDate = body.birthDate ? new Date(body.birthDate) : null;
      if (body.birthDate && Number.isNaN(birthDate?.getTime())) {
        return c.json({ error: "Fecha de nacimiento invalida." }, 400);
      }
      const updated = await prisma.userProfile.update({
        where: { id: context.profile.id },
        data: {
          firstName,
          lastName,
          displayName: `${firstName} ${lastName}`.trim(),
          birthDate,
          gender: body.gender ? String(body.gender).trim() : null,
          phone: body.phone ? String(body.phone).trim() : null,
          country: body.country ? String(body.country).trim() : null,
          state: body.state ? String(body.state).trim() : null,
          city: body.city ? String(body.city).trim() : null,
          colony: body.colony ? String(body.colony).trim() : null,
          street: body.street ? String(body.street).trim() : null,
          extNumber: body.extNumber ? String(body.extNumber).trim() : null,
          intNumber: body.intNumber ? String(body.intNumber).trim() : null,
          postalCode: body.postalCode ? String(body.postalCode).trim() : null,
          bio: body.bio ? String(body.bio).trim() : null,
        },
      });
      const avatarUrl = await getSignedUrlByFileId(
        updated.avatarFileId,
        "card",
        { prisma, supabaseAdmin },
      );
      cacheDel(`user_ctx:${authUserId}`);
      return c.json({
        data: {
          id: updated.id,
          firstName: updated.firstName,
          lastName: updated.lastName,
          displayName: updated.displayName,
          email: updated.email,
          avatarUrl,
          avatarFileId: updated.avatarFileId,
          birthDate: updated.birthDate,
          gender: updated.gender,
          phone: updated.phone,
          country: updated.country,
          state: updated.state,
          city: updated.city,
          colony: updated.colony,
          street: updated.street,
          extNumber: updated.extNumber,
          intNumber: updated.intNumber,
          postalCode: updated.postalCode,
          bio: updated.bio,
          role: context.roleKey,
        },
      });
    } catch {
      return c.json({ error: "No se pudo actualizar el perfil." }, 500);
    }
  },
);

app.post(
  "/profile/me/avatar",
  authMiddleware,
  requirePermission("profile.avatar.update"),
  async (c) => {
    const authUserId = c.get("authUserId");
    try {
      const context = await getOrLoadUserContext(c);
      if (!context?.profile) {
        return c.json({ error: "Perfil no encontrado." }, 404);
      }
      const body = await c.req.parseBody();
      const file = body.avatar;
      if (!(file instanceof File) || file.size <= 0) {
        return c.json({ error: "Selecciona una imagen valida." }, 400);
      }
      if (file.size > 10 * 1024 * 1024) {
        return c.json({ error: "La imagen no puede superar 10 MB." }, 400);
      }
      if (!file.type.startsWith("image/")) {
        return c.json({ error: "Solo se permiten imagenes." }, 400);
      }

      const asset = await uploadIdentityAvatar({
        profileId: context.profile.id,
        file,
        prisma,
        supabaseAdmin,
        bucket: STORAGE_BUCKET_NAME,
      });
      cacheDel(`user_ctx:${authUserId}`);
      const avatarUrl = await getSignedUrlByFileId(asset.id, "card", { prisma, supabaseAdmin });
      return c.json({ data: { avatarUrl, avatarFileId: asset.id } });
    } catch {
      return c.json({ error: "No se pudo actualizar el avatar." }, 500);
    }
  },
);

app.get(
  "/profile/me/avatar/signed-url",
  authMiddleware,
  requirePermission("profile.self.read"),
  async (c) => {
    try {
      const context = await getOrLoadUserContext(c);
      if (!context?.profile) {
        return c.json({ error: "Perfil no encontrado." }, 404);
      }
      const variant = c.req.query("variant") || "full";
      const signedUrl = await getSignedUrlByFileId(
        context.profile.avatarFileId,
        variant,
        { prisma, supabaseAdmin },
      );
      return c.json({ data: { signedUrl } });
    } catch {
      return c.json({ error: "No se pudo generar el enlace del avatar." }, 500);
    }
  },
);

app.post(
  "/profile/me/password",
  authMiddleware,
  requirePermission("profile.password.update"),
  async (c) => {
    const authUserId = c.get("authUserId");
    try {
      const context = await getOrLoadUserContext(c);
      if (!context?.profile) {
        return c.json({ error: "Perfil no encontrado." }, 404);
      }

      const body = await c.req.json();
      const currentPassword = String(body.currentPassword ?? "");
      const newPassword = String(body.newPassword ?? "");
      const confirmPassword = String(body.confirmPassword ?? "");

      if (!currentPassword || !newPassword || !confirmPassword) {
        return c.json(
          { error: "Debes completar contraseña actual, nueva y confirmación." },
          400,
        );
      }
      if (newPassword.length < 8) {
        return c.json(
          { error: "La nueva contraseña debe tener al menos 8 caracteres." },
          400,
        );
      }
      if (newPassword !== confirmPassword) {
        return c.json({ error: "La confirmación no coincide." }, 400);
      }
      if (currentPassword === newPassword) {
        return c.json(
          { error: "La nueva contraseña debe ser diferente a la actual." },
          400,
        );
      }

      const { error: authCheckError } =
        await supabaseAdmin.auth.signInWithPassword({
          email: context.profile.email,
          password: currentPassword,
        });
      if (authCheckError) {
        return c.json({ error: "La contraseña actual no es correcta." }, 400);
      }

      const { error: updateError } =
        await supabaseAdmin.auth.admin.updateUserById(authUserId, {
          password: newPassword,
        });
      if (updateError) {
        return c.json(
          { error: "No se pudo actualizar la contraseña. Intenta de nuevo." },
          500,
        );
      }

      return c.json({ data: { ok: true } });
    } catch {
      return c.json({ error: "No se pudo actualizar la contraseña." }, 500);
    }
  },
);

app.get("/profile/me/preferences/:key", authMiddleware, async (c) => {
  try {
    const context = await getOrLoadUserContext(c);
    if (!context?.profile)
      return c.json({ error: "Perfil no encontrado." }, 404);
    const key = c.req.param("key");
    const pref = await prisma.userPreference.findUnique({
      where: { userId_key: { userId: context.profile.id, key } },
    });
    return c.json({ value: pref?.value ?? null });
  } catch {
    return c.json({ error: "No se pudo obtener la preferencia." }, 500);
  }
});

app.get(
  "/profile/me/table-preferences/:tableKey",
  authMiddleware,
  async (c) => {
    try {
      const context = await getOrLoadUserContext(c);
      if (!context?.profile)
        return c.json({ error: "Perfil no encontrado." }, 404);
      const tableKey = c.req.param("tableKey");
      const pref = await prisma.userTablePreference.findUnique({
        where: { userId_tableKey: { userId: context.profile.id, tableKey } },
      });
      return c.json({ data: pref?.config ?? null });
    } catch {
      return c.json({ error: "No se pudo obtener la preferencia." }, 500);
    }
  },
);

app.put("/profile/me/preferences/:key", authMiddleware, async (c) => {
  try {
    const context = await getOrLoadUserContext(c);
    if (!context?.profile)
      return c.json({ error: "Perfil no encontrado." }, 404);
    const key = c.req.param("key");
    const body = await c.req.json();
    if (body.value === undefined) {
      return c.json({ error: "Se requiere el campo 'value'." }, 400);
    }
    const { value } = body;
    const pref = await prisma.userPreference.upsert({
      where: { userId_key: { userId: context.profile.id, key } },
      update: { value },
      create: { userId: context.profile.id, key, value },
    });
    return c.json({ value: pref.value });
  } catch {
    return c.json({ error: "No se pudo guardar la preferencia." }, 500);
  }
});

app.put(
  "/profile/me/table-preferences/:tableKey",
  authMiddleware,
  async (c) => {
    try {
      const context = await getOrLoadUserContext(c);
      if (!context?.profile)
        return c.json({ error: "Perfil no encontrado." }, 404);
      const tableKey = c.req.param("tableKey");
      const config = await c.req.json();
      const pref = await prisma.userTablePreference.upsert({
        where: { userId_tableKey: { userId: context.profile.id, tableKey } },
        update: { config },
        create: { userId: context.profile.id, tableKey, config },
      });
      return c.json({ data: pref.config });
    } catch {
      return c.json({ error: "No se pudo guardar la preferencia." }, 500);
    }
  },
);

app.delete(
  "/profile/me/table-preferences/:tableKey",
  authMiddleware,
  async (c) => {
    try {
      const context = await getOrLoadUserContext(c);
      if (!context?.profile)
        return c.json({ error: "Perfil no encontrado." }, 404);
      const tableKey = c.req.param("tableKey");
      await prisma.userTablePreference.deleteMany({
        where: { userId: context.profile.id, tableKey },
      });
      return c.json({ data: { ok: true } });
    } catch {
      return c.json({ error: "No se pudo eliminar la preferencia." }, 500);
    }
  },
);

app.get("/memberships/me", authMiddleware, async (c) => {
  const authUserId = c.get("authUserId");
  try {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId },
    });
    if (!profile?.enabled) return c.json({ error: "Perfil no disponible." }, 401);
    const memberships = await prisma.membership.findMany({
      where: { userId: profile.id, enabled: true, company: { enabled: true }, OR: [{ roleId: null }, { role: { enabled: true } }] },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        company: {
          include: { brandingConfig: true },
        },
      },
    });

    const grants = await prisma.userPermissionGrant.findMany({
      where: { userId: profile.id, permission: { active: true } },
      select: { companyId: true, permission: { select: { key: true, active: true } } },
    });
    // Batch-load all logo file assets in a single query, then batch signed URLs per bucket.
    const logoFileIds = memberships
      .map((m) => m.company?.brandingConfig?.logoFileId)
      .filter(Boolean);
    const logoUrlMap = new Map();
    if (logoFileIds.length > 0) {
      const logoAssets = await prisma.fileAsset.findMany({
        where: { id: { in: logoFileIds } },
        select: { id: true, bucket: true, objectKey: true },
      });
      const byBucket = new Map();
      for (const asset of logoAssets) {
        if (!byBucket.has(asset.bucket)) byBucket.set(asset.bucket, []);
        byBucket.get(asset.bucket).push(asset);
      }
      await Promise.all(
        [...byBucket.entries()].map(async ([bucket, assets]) => {
          const paths = assets.map((a) => a.objectKey);
          const signedByPath = await getCachedSignedUrls(supabaseAdmin, bucket, paths, 3600);
          for (const asset of assets) {
            logoUrlMap.set(asset.id, signedByPath.get(asset.objectKey) ?? null);
          }
        }),
      );
    }

    const data = memberships.filter((m) => !m.role?.companyId || m.role.companyId === m.companyId).map((m) => {
      const logoFileId = m.company?.brandingConfig?.logoFileId;
      return {
        ...m,
        role: m.role ? { ...m.role, permissions: undefined } : null,
        authorizationRevision: membershipAuthorizationRevision(m, grants),
        company: m.company
          ? {
              id: m.company.id,
              name: m.company.name,
              slug: m.company.slug,
              logoUrl: logoFileId ? (logoUrlMap.get(logoFileId) ?? null) : null,
              primaryColor: m.company.brandingConfig?.primaryColor ?? null,
            }
          : null,
      };
    });

    const [scope] = await prisma.$queryRaw`SELECT revision::text FROM realtime_authorization_revision WHERE id`;
    return c.json({ data, authorizationRevision: scope.revision });
  } catch (e) {
    console.error("[GET /memberships/me]", e);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get(
  "/instance/config",
  authMiddleware,
  // Instance name / timezone / currency are needed by the app shell for every
  // authenticated user (tab title, date + money formatting) and expose nothing
  // sensitive. Only the PUT below is gated behind core.instance.update.
  requirePermission("profile.self.read"),
  async (c) => {
    try {
      const records = await prisma.instanceConfig.findMany({
        where: {
          key: {
            in: [
              "initialized",
              "company_id",
              "completed_at",
              "instance_name",
              "instance_time_zone",
              "instance_currency",
              "instance_description",
            ],
          },
        },
      });
      const values = Object.fromEntries(records.map((r) => [r.key, r.value]));
      return c.json({
        data: {
          initialized: values.initialized === "true",
          companyId: values.company_id ?? null,
          completedAt: values.completed_at ?? null,
          instanceName: values.instance_name ?? "Runly ERP",
          timeZone: values.instance_time_zone ?? "America/Mexico_City",
          currency: values.instance_currency ?? "MXN",
          description: values.instance_description ?? "",
        },
      });
    } catch {
      return c.json({ error: "No se pudo cargar la configuracion." }, 500);
    }
  },
);

app.put(
  "/instance/config",
  authMiddleware,
  requirePermission("core.instance.update"),
  async (c) => {
    try {
      const body = await c.req.json();
      const instanceName = String(body.instanceName ?? "").trim();
      const timeZone = String(body.timeZone ?? "").trim();
      const currency = String(body.currency ?? "")
        .trim()
        .toUpperCase();
      const description = String(body.description ?? "").trim();
      if (!instanceName || !timeZone || !currency) {
        return c.json(
          { error: "instanceName, timeZone y currency son obligatorios." },
          400,
        );
      }
      if (description.length > 500) {
        return c.json(
          { error: "La descripcion no puede exceder 500 caracteres." },
          400,
        );
      }
      const pairs = [
        ["instance_name", instanceName],
        ["instance_time_zone", timeZone],
        ["instance_currency", currency],
        ["instance_description", description],
      ];
      await prisma.$transaction(
        pairs.map(([key, value]) =>
          prisma.instanceConfig.upsert({
            where: { key },
            update: { value },
            create: { key, value },
          }),
        ),
      );
      return c.json({
        data: { instanceName, timeZone, currency, description },
      });
    } catch {
      return c.json({ error: "No se pudo guardar la configuracion." }, 500);
    }
  },
);

app.route("/", createOfficeRouter({ officeService, authMiddleware, requirePermission }));
app.route("/", createFilesRouter({ prisma, supabaseAdmin, filesService, authMiddleware, requirePermission }));
app.route("/", createIdentitySessionsRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission }));


const realtimeAccess = createRealtimeAccessService({ prisma, broadcaster });
app.get('/realtime/revision', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json({ revision: await realtimeAccess.revision() });
});
app.post('/realtime/broadcast', authMiddleware, async (c) => {
  const context = await getOrLoadUserContext(c);
  if (!context?.profile?.enabled) return c.json({ error: 'Recurso no disponible.' }, 404);
  const body = await c.req.json();
  const ok = await realtimeAccess.relay({ topic: body.topic, event: body.event, payload: body.payload, actorId: context.profile.id });
  return c.json({ ok }, ok ? 200 : 404);
});
app.post('/realtime/presence', authMiddleware, async (c) => {
  const context = await getOrLoadUserContext(c);
  if (!context?.profile?.enabled) return c.json({ error: 'Recurso no disponible.' }, 404);
  const body = await c.req.json();
  const data = await realtimeAccess.presence({ topic: body.topic, actorId: context.profile.id, leave: body.leave === true });
  return data ? c.json({ data }) : c.json({ error: 'Recurso no disponible.' }, 404);
});

const collaborationInvitations = createCollaborationInvitationsService({ prisma });
app.get('/collaboration/invitations', authMiddleware, requirePermission('profile.self.read'), async (c) => {
  try {
    return c.json({ data: await collaborationInvitations.list({ resourceType: c.req.query('resourceType'), resourceId: c.req.query('resourceId'), companyId: c.get('companyId'), actorId: c.get('userId') }) });
  } catch (err) { return c.json({ error: 'Recurso no encontrado o no disponible.' }, err.status ?? 400); }
});
app.post('/collaboration/invitations', authMiddleware, requirePermission('profile.self.read'), async (c) => {
  try {
    const body = await c.req.json();
    return c.json({ data: await collaborationInvitations.create({ resourceType: body.resourceType, resourceId: body.resourceId, permission: body.permission, email: body.email, roleId: body.roleId, companyId: c.get('companyId'), actorId: c.get('userId') }) }, 201);
  } catch (err) { return c.json({ error: 'Recurso no encontrado o no disponible.' }, err.status ?? 400); }
});
app.post('/collaboration/invitations/accept', authMiddleware, async (c) => {
  try {
    const context = await getOrLoadUserContext(c);
    if (!context?.profile?.enabled) return c.json({ error: 'Recurso no encontrado o no disponible.' }, 404);
    const body = await c.req.json();
    return c.json({ data: await collaborationInvitations.accept({ token: body.token, actorId: context.profile.id }) });
  } catch (err) { return c.json({ error: 'Recurso no encontrado o no disponible.' }, err.status ?? 400); }
});
app.delete('/collaboration/invitations/:id', authMiddleware, requirePermission('profile.self.read'), async (c) => {
  try {
    return c.json(await collaborationInvitations.revoke({ invitationId: c.req.param('id'), actorId: c.get('userId'), companyId: c.get('companyId') }));
  } catch (err) { return c.json({ error: 'Recurso no encontrado o no disponible.' }, err.status ?? 400); }
});


app.get("/runtime/modules", authMiddleware, async (c) => {
  const context = await getOrLoadUserContext(c);
  if (!context?.profile) {
    return c.json(
      { error: "No autorizado. Perfil de usuario no encontrado." },
      401,
    );
  }
  const resolved = await resolveTenantContext(c, context, { strict: false });
  if (!resolved.ok) return resolved.response;
  const { tenant } = resolved;

  // Cache raw DB data — the per-user access filter is applied below on each request.
  // Invalidated by module lifecycle events (same points as blueprints:raw).
  let modulesRaw = cacheGet("runtime:modules:raw");
  if (!modulesRaw) {
    modulesRaw = await prisma.runlyModule.findMany({
      orderBy: [{ core: "desc" }, { name: "asc" }],
      include: {
        dependencies: {
          include: {
            dependency: {
              select: {
                id: true,
                key: true,
                name: true,
                status: true,
                enabled: true,
                version: true,
              },
            },
          },
        },
      },
    });
    cacheSet("runtime:modules:raw", modulesRaw, TTL.BLUEPRINTS);
  }

  let visibleModules = modulesRaw;
  if (tenant.companyId) {
    const disabledIds = await companyModuleService.listDisabledModuleIds(tenant.companyId);
    visibleModules = modulesRaw.filter((m) => m.core || !disabledIds.has(m.id));
  }

  return c.json({
    data: serializeModulesForResponse(visibleModules, tenant, {
      filterByPermission: true,
      filterNavigation: true,
    }),
  });
});

app.get("/blueprints", authMiddleware, async (c) => {
  const context = await getOrLoadUserContext(c);
  if (!context?.profile) {
    return c.json(
      { error: "No autorizado. Perfil de usuario no encontrado." },
      401,
    );
  }
  const resolved = await resolveTenantContext(c, context, { strict: false });
  if (!resolved.ok) return resolved.response;
  const { tenant } = resolved;

  // Cache raw DB data — the per-user access filter is applied below on each request.
  // Invalidated by module lifecycle events (install/enable/disable/uninstall/sync/reset).
  let blueprintRaw = cacheGet("blueprints:raw");
  if (!blueprintRaw) {
    const [blueprints, installedModuleRows] = await Promise.all([
      prisma.blueprint.findMany({
        where: { enabled: true },
        include: { module: true },
      }),
      prisma.runlyModule.findMany({
        where: { status: "INSTALLED", enabled: true },
        select: {
          id: true,
          key: true,
          name: true,
          status: true,
          enabled: true,
          version: true,
          manifest: true,
          hasBundle: true,
          core: true,
        },
      }),
    ]);
    const runlyViews = await prisma.runlyView.findMany({
      where: {
        enabled: true,
        moduleKey: { in: installedModuleRows.map((row) => row.key) },
      },
    });
    blueprintRaw = { blueprints, installedModuleRows, runlyViews };
    cacheSet("blueprints:raw", blueprintRaw, TTL.BLUEPRINTS);
  }

  const { blueprints, installedModuleRows, runlyViews } = blueprintRaw;
  const moduleRowsByKey = new Map(
    installedModuleRows.map((row) => [row.key, row]),
  );
  const disabledModuleIds = tenant.companyId
    ? await companyModuleService.listDisabledModuleIds(tenant.companyId)
    : new Set();
  const mergedByKey = new Map();

  for (const blueprint of blueprints) {
    if (!userCanAccessModule(tenant, blueprint.module)) continue;
    if (blueprint.module && !blueprint.module.core && disabledModuleIds.has(blueprint.module.id)) continue;
    mergedByKey.set(blueprint.key, {
      ...blueprint,
      source: "blueprint",
      module: blueprint.module
        ? {
            ...blueprint.module,
            has_bundle: blueprint.module.hasBundle ?? false,
          }
        : blueprint.module,
    });
  }

  for (const view of runlyViews) {
    const moduleRow = moduleRowsByKey.get(view.moduleKey);
    if (!moduleRow) continue;
    if (!userCanAccessModule(tenant, moduleRow)) continue;
    if (!moduleRow.core && disabledModuleIds.has(moduleRow.id)) continue;

    mergedByKey.set(view.key, {
      id: view.id,
      key: view.key,
      moduleKey: view.moduleKey,
      kind: view.type,
      version: moduleRow.version ?? "0.1.0",
      schema: view.schema,
      enabled: view.enabled,
      source: "runly-view",
      module: {
        key: moduleRow.key,
        name: moduleRow.name,
        status: moduleRow.status,
        enabled: moduleRow.enabled,
        has_bundle: moduleRow.hasBundle ?? false,
      },
    });
  }

  return c.json({ data: [...mergedByKey.values()] });
});

app.get(
  "/companies/:companyId/modules",
  authMiddleware,
  requireAnyPermission(["core.modules.read"]),
  async (c) => {
    const tenant = c.get("tenantContext");
    const companyId = c.req.param("companyId");
    if (!tenant.isSystemAdmin && companyId !== tenant.companyId) {
      return c.json({ error: "No autorizado." }, 403);
    }
    const [modules, companyModules] = await Promise.all([
      prisma.runlyModule.findMany({
        where: { status: "INSTALLED" },
        select: { id: true, key: true, name: true, core: true },
      }),
      companyModuleService.listForCompany(companyId),
    ]);
    const byModuleId = new Map(companyModules.map((cm) => [cm.moduleId, cm]));
    return c.json({
      data: modules.map((m) => ({
        moduleId: m.id,
        key: m.key,
        name: m.name,
        core: m.core,
        enabled: m.core ? true : (byModuleId.get(m.id)?.enabled ?? true),
      })),
    });
  },
);

app.patch(
  "/companies/:companyId/modules/:moduleId",
  authMiddleware,
  requirePermission("core.modules.update"),
  async (c) => {
    const tenant = c.get("tenantContext");
    if (!tenant.isSystemAdmin) {
      return c.json(
        { error: "Solo un administrador de plataforma puede cambiar los modulos de una empresa." },
        403,
      );
    }
    const companyId = c.req.param("companyId");
    const moduleId = c.req.param("moduleId");
    const body = await c.req.json().catch(() => ({}));
    if (typeof body.enabled !== "boolean") {
      return c.json({ error: "El campo enabled es obligatorio." }, 422);
    }
    const moduleRow = await prisma.runlyModule.findUnique({
      where: { id: moduleId },
      select: { core: true },
    });
    if (!moduleRow) return c.json({ error: "Modulo no encontrado." }, 404);
    if (moduleRow.core && !body.enabled) {
      return c.json({ error: "Los modulos core no se pueden deshabilitar por empresa." }, 400);
    }
    // No cache to bust here: runtime:modules:raw / blueprints:raw cache the
    // instance-wide RunlyModule/Blueprint rows, which this toggle never
    // changes — per-company enablement is read fresh from CompanyModule on
    // every request (see companyModuleService.listDisabledModuleIds above).
    const result = await companyModuleService.setEnabled({
      companyId,
      moduleId,
      enabled: body.enabled,
    });
    return c.json({ data: result });
  },
);

const publicWebsiteRouter = createPublicWebsiteRouter({
  prisma,
  supabaseAdmin,
});
app.route("/public/website", publicWebsiteRouter);

const publicCatalogRouter = createPublicCatalogRouter({ prisma });
app.route("/public/catalog", publicCatalogRouter);

const publicFormsRouter = createPublicFormsRouter({ prisma });
app.route("/public/website", publicFormsRouter);

const publicBookingsRouter = createPublicBookingsRouter({ prisma });
app.route("/public/website", publicBookingsRouter);

const publicCheckoutRouter = createPublicCheckoutRouter({ prisma });
app.route("/public/website", publicCheckoutRouter);

const storefrontRouter = createStorefrontRouter({ prisma, supabaseAdmin, supabaseAnon });
app.route("/public/storefront", storefrontRouter);

const pwaRouter = createPwaRouter({ prisma });
app.route("/pwa", pwaRouter);

// Chat and notes routers manage their own auth internally (internal.use("*", authMiddleware)).
// They MUST be registered before mountWithAuth() calls — the secured sub-apps created by
// mountWithAuth intercept every request via secured.use("*", authMiddleware), which returns
// 401 before the chat/notes public routes (e.g. POST /public/chat/session) can be reached.
//
// ⚠️ LOAD-BEARING — DO NOT CHANGE THIS ORDERING OR THE AUTH SCOPING BELOW WITHOUT
//    ASKING THE REPO OWNER (Raul) DIRECTLY FIRST.
//    These routers are mounted at "/" and are registered BEFORE the public website
//    handlers (`/public/site/*`, `/public/blueprints`, `/public/modules`, the
//    runly-sdk, the ERP badge) and BEFORE the dist-serve SPA-fallback middleware.
//    Any `use("*", authMiddleware)` installed at the ROOT of one of these sub-apps
//    (i.e. `sub.use("*", authMiddleware)` + `app.route("", sub)`) will therefore
//    swallow EVERY unmatched anonymous request with a 401 and take down the public
//    marketing website (nginx proxies `/` -> `/public/site/` and needs a 404 to
//    fall back to the SPA). Every auth guard in these routers MUST be scoped to a
//    concrete path prefix — `internal.use("*", ...)` + `app.route("/chat", internal)`,
//    `mirai.use("/chat/mirai/*", ...)`, etc. Regression on 2026-09-08 (MirAI
//    guard mounted at root, commit 59a439a6); see mirai-mount-scope.test.js.
app.route("/", createChatRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission, notificationService, broadcaster, resolveUserContext: getUserContextByAuthId, officeService }));
const callsSmtpService = createSmtpService({ prisma });
app.route("/", createCallsRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission, notificationService, broadcaster, deliveryWorker: notificationDeliveryWorker, smtpService: callsSmtpService }));
app.route("/", createNotesRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission, broadcaster, notificationService }));
app.route("/", createSupportRouter({ prisma, authMiddleware }));

app.get("/public", (c) => {
  return c.json({
    api: "Runly ERP Public API",
    version: "1.0",
    docs: "https://github.com/raulbellosom/runly-erp",
    endpoints: [
      // Discovery
      { method: "GET",  path: "/public",                                auth: "none",       description: "This index — lists all public endpoints" },
      { method: "GET",  path: "/public/modules",                        auth: "none",       description: "Installed and enabled modules (key, name, version, navigation)" },
      { method: "GET",  path: "/public/blueprints",                     auth: "none",       description: "Public custom views declared by modules (schema, component path)" },
      // Storefront auth
      { method: "POST", path: "/public/storefront/auth/register",       auth: "none",       description: "Register a storefront user account" },
      { method: "POST", path: "/public/storefront/auth/login",          auth: "none",       description: "Login and obtain access + refresh tokens" },
      { method: "POST", path: "/public/storefront/auth/refresh",        auth: "none",       description: "Refresh an expired access token" },
      { method: "GET",  path: "/public/storefront/auth/me",             auth: "storefront", description: "Get the authenticated storefront user profile" },
      { method: "POST", path: "/public/storefront/auth/logout",         auth: "storefront", description: "Invalidate the current session" },
      // Storefront config & realtime
      { method: "GET",  path: "/public/storefront/config",              auth: "none",       description: "Public instance configuration (company name, branding, features)" },
      { method: "GET",  path: "/public/storefront/realtime-config",     auth: "none",       description: "Supabase realtime connection credentials for live updates" },
      { method: "GET",  path: "/public/storefront/v1/config",           auth: "none",       description: "Storefront capture policy and capabilities" },
      { method: "POST", path: "/public/storefront/v1/events/batch",     auth: "optional",   description: "Submit a bounded analytics event batch" },
      { method: "GET",  path: "/public/storefront/v1/forms/:formId",    auth: "none",       description: "Get an enabled public form definition" },
      { method: "POST", path: "/public/storefront/v1/forms/:formId/submissions", auth: "optional", description: "Submit a public form with idempotency" },
      // Storefront files
      { method: "POST", path: "/public/storefront/files/upload",        auth: "storefront", description: "Upload a file as an authenticated storefront user" },
      { method: "GET",  path: "/public/storefront/files/:id/url",       auth: "none",       description: "Get a signed download URL for a public file" },
      { method: "DELETE", path: "/public/storefront/files/:id",         auth: "storefront", description: "Delete an owned file" },
      // Catalog
      { method: "GET",  path: "/public/catalog/categories",             auth: "none",       description: "Published product categories" },
      { method: "GET",  path: "/public/catalog/products",               auth: "none",       description: "Published products list (supports ?q, ?category, ?limit)" },
      { method: "GET",  path: "/public/catalog/products/:slug",         auth: "none",       description: "Single product detail by slug" },
      // Website / CMS
      { method: "GET",  path: "/public/website/resolve",                auth: "none",       description: "Resolve a website by domain or slug" },
      { method: "GET",  path: "/public/website/blog",                   auth: "none",       description: "Published blog posts" },
      { method: "POST", path: "/public/website/forms/:formId/submit",   auth: "none",       description: "Submit a website form" },
      { method: "POST", path: "/public/website/bookings",               auth: "none",       description: "Create a booking" },
      { method: "POST", path: "/public/website/checkout",               auth: "none",       description: "Initiate a checkout (Stripe)" },
      // Static site
      { method: "GET",  path: "/public/site/erp-badge-check",           auth: "optional",   description: "Check if the current session has ERP access (used by the injected beacon)" },
      { method: "GET",  path: "/public/site/*",                         auth: "none",       description: "Serve the compiled static website" },
    ],
    auth: {
      storefront: "Bearer <token> obtained from /public/storefront/auth/login, plus header X-Runly-Company: <company-slug>",
    },
  });
});

// Runly client SDK — served at /runly-sdk.js via nginx rewrite (/ → /public/site$uri).
// /public/site/atlas-sdk.js is kept serving the same file so pages generated
// before this rename (their static HTML hardcodes that script src) keep working.
// Concatenated from three source files — runly-sdk.js (auth/login +
// analytics/forms), runly-sdk-chat.js (guest-chat session/REST/realtime) and
// runly-sdk-chat-widget.js (the chat DOM widget, which reads the previous
// file's private window.__runlyChatApi bridge) — kept as separate files on
// disk so each stays under the project's file-size limit (CLAUDE.md "Atomic
// file size limit"), but served as the single script the README's embed
// snippet expects. Order matters: runly-sdk-chat.js must run before
// runly-sdk-chat-widget.js.
const RUNLY_SDK_PARTS = ['runly-sdk.js', 'runly-sdk-chat.js', 'runly-sdk-chat-widget.js']
async function serveRunlySdk(c) {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const __dir = dirname(fileURLToPath(import.meta.url))
  try {
    const parts = await Promise.all(
      RUNLY_SDK_PARTS.map((name) => readFile(join(__dir, 'public', name), 'utf8')),
    )
    c.header('Content-Type', 'application/javascript; charset=utf-8')
    c.header('Cache-Control', 'public, max-age=3600')
    return c.text(parts.join('\n'))
  } catch {
    return c.text('/* runly-sdk not found */', 404)
  }
}
app.get("/public/site/runly-sdk.js", serveRunlySdk)
app.get("/public/site/atlas-sdk.js", serveRunlySdk)

// ERP beacon check — called client-side by the injected badge script.
// Returns { show: true } only when the request carries a valid Atlas session
// with platform.erp.access. No auth middleware: missing/invalid tokens return false.
app.get("/public/site/erp-badge-check", async (c) => {
  c.header("Cache-Control", "no-store")
  const authHeader = c.req.header("Authorization")
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null
  if (!token) return c.json({ show: false })
  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data.user) return c.json({ show: false })
  try {
    const context = await getUserContextByAuthId(data.user.id)
    return c.json({ show: Boolean(context?.permissionSet.has("platform.erp.access")) })
  } catch {
    return c.json({ show: false })
  }
})

// Public site catch-all — must be registered last among public routes
app.get("/public/site/*", async (c) => {
  const fullPath = c.req.path.replace(/^\/public\/site/, '') || '/'
  const result = await distServeService.serve(c, fullPath)
  if (result === null) {
    // Builder mode: return 404 so nginx falls back to the React SPA,
    // which loads PublicWebsiteEntry and renders the builder client-side.
    return c.notFound()
  }
  return result
})

app.get("/public/blueprints", async (c) => {
  try {
    const cacheKey = "public:blueprints:raw";
    let publicViews = cacheGet(cacheKey);
    if (!publicViews) {
      publicViews = await prisma.runlyView.findMany({
        where: {
          type: "CUSTOM",
          enabled: true,
          schema: { path: ["public"], equals: true },
        },
      });
      cacheSet(cacheKey, publicViews, TTL.BLUEPRINTS);
    }
    return c.json({
      data: publicViews.map((v) => ({
        key: v.key,
        kind: v.type,
        moduleKey: v.moduleKey,
        schema: {
          component: v.schema?.component,
          path: v.schema?.path,
          title: v.schema?.title,
          public: v.schema?.public,
        },
        source: "runly-view",
      })),
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[public/blueprints]", err?.message);
    }
    return c.json({ error: "No se pudieron cargar las vistas públicas." }, 500);
  }
});

app.get("/public/modules", async (c) => {
  try {
    const cacheKey = "public:modules:raw";
    let modulesRaw = cacheGet(cacheKey);
    if (!modulesRaw) {
      modulesRaw = await prisma.runlyModule.findMany({
        where: { status: "INSTALLED", enabled: true },
        orderBy: [{ core: "desc" }, { name: "asc" }],
        select: {
          key: true,
          name: true,
          version: true,
          kind: true,
          enabled: true,
          manifest: true,
        },
      });
      cacheSet(cacheKey, modulesRaw, TTL.BLUEPRINTS);
    }
    return c.json({
      data: modulesRaw.map((m) => ({
        key: m.key,
        name: m.name,
        version: m.version,
        kind: m.kind,
        enabled: m.enabled,
        navigation: m.manifest?.navigation ?? [],
        exposes: m.manifest?.exposes ?? [],
      })),
    });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[public/modules]", err?.message);
    }
    return c.json({ error: "No se pudieron cargar los modulos." }, 500);
  }
});


const modulesRouter = createModulesRouter({
  prisma,
  authMiddleware,
  requirePermission,
  routeLoader,
  bundlerSvc: bundlerService,
});
app.route("/modules", modulesRouter);

// Dist-serve middleware — must be registered BEFORE mountWithAuth() calls.
// In Hono v4, secured.use("*", authMiddleware) inside a sub-app mounted at "/"
// intercepts every unmatched path before the wildcard route at the bottom can fire.
// Moving this up as a use() middleware means it runs first for browser GETs to
// non-API paths and calls next() for everything else (API AJAX calls, etc.).
const API_PREFIX_RE = /^\/(modules|blueprints|files|wopi|contacts|company|identity|finance|hr|website|ledger|pfm|calendar|projects|catalog|pos|storefront|activity|notifications|inventory|chat|calls|public|auth|health|p|app|user|users|memberships|profile|settings|sync)\b/i
// Static dist files that aren't HTML pages but live in the dist root (robots.txt, sitemap, webmanifest).
const DIST_STATIC_RE = /\.(txt|xml|webmanifest|ico|rss|atom)$/i
app.use('*', async (c, next) => {
  if (c.req.method !== 'GET') return next()
  const path = c.req.path
  if (API_PREFIX_RE.test(path)) return next()
  const accept = c.req.header('Accept') ?? ''
  const isPageNav = accept.includes('text/html')
  const isStaticDistFile = DIST_STATIC_RE.test(path)
  if (!isPageNav && !isStaticDistFile) return next()
  const result = await distServeService.serve(c, path)
  if (result === null) return next()
  return result
})

function mountWithAuth(baseApp, router) {
  const secured = new Hono();
  secured.use("*", authMiddleware);
  secured.route("/", router);
  baseApp.route("/", secured);
}

mountWithAuth(app, createCompanyRouter({ prisma, supabaseAdmin, requirePermission, cacheDel }));
mountWithAuth(app, createContactsRouter({ prisma, requirePermission }));
mountWithAuth(app, createHrRouter({ prisma, supabaseAdmin, requirePermission }));
mountWithAuth(app, createIdentityRouter({
  prisma,
  supabaseAdmin,
  requirePermission,
  getUserContext: getOrLoadUserContext,
  resolveTenantContext,
  cacheDel,
  cacheDelByPrefix,
  storageBucketName: STORAGE_BUCKET_NAME,
}));
mountWithAuth(app, createSettingsRouter({ prisma, requirePermission, supabaseAdmin }));
mountWithAuth(app, createWebsiteRouter({ prisma, requirePermission, supabaseAdmin }));
mountWithAuth(app, createLedgerRouter({ prisma, requirePermission, requireAnyPermission }));
mountWithAuth(app, createPfmRouter({ prisma, requirePermission, requireAnyPermission, supabaseAdmin, filesService, notificationService }));
mountWithAuth(app, createUsersRouter({ prisma, requirePermission }));
mountWithAuth(app, createSearchRouter({ prisma, getUserContext: getOrLoadUserContext, resolveTenantContext }));
mountWithAuth(app, createFleetRouter({ prisma, requirePermission, enrichFilesWithSignedUrls: filesService.enrichFilesWithSignedUrls.bind(filesService) }));
mountWithAuth(app, createCatalogRouter({ prisma, requirePermission, requireAnyPermission, supabaseAdmin }));
mountWithAuth(app, createPosRouter({ prisma, requirePermission, broadcaster }));
mountWithAuth(app, createCalendarRouter({ prisma, requirePermission, broadcaster }));
mountWithAuth(app, createProjectsRouter({ prisma, requirePermission, notificationService, enrichFileAssets: filesService.enrichFileAssets.bind(filesService), broadcaster }));
mountWithAuth(app, createActivityRouter({ prisma, requirePermission }));
mountWithAuth(app, createNotificationsRouter({ prisma, requirePermission }));
mountWithAuth(app, createGrowthRouter({ prisma, requirePermission, notificationService, enrichFileAssets: filesService.enrichFileAssets.bind(filesService) }));
mountWithAuth(
  app,
  createDocumentsRouter({ prisma, supabaseAdmin, requirePermission }),
);
mountWithAuth(app, createSyncRouter({ prisma, getUserContext: getOrLoadUserContext, resolveTenantContext }));
mountWithAuth(
  app,
  createInventoryRouter({
    prisma,
    requirePermission,
    inventoryService,
    InventoryServiceError,
    inventoryNotifSvc,
    commentsService,
    CommentsServiceError,
    filesService,
    enrichFilesWithSignedUrls: filesService.enrichFilesWithSignedUrls.bind(filesService),
  }),
);



app.post("/internal/notifications/process-deliveries", async (c) => {
  const secret = c.req.header("x-internal-secret");
  if (
    process.env.NODE_ENV === "production" &&
    secret !== process.env.RUNLY_INTERNAL_SECRET
  ) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const body = await c.req.json().catch(() => ({}));
    const limit = Number(body?.limit ?? c.req.query("limit") ?? 50);
    const channel = String(body?.channel ?? c.req.query("channel") ?? "email");
    if (channel === "all") {
      const [email, webPush] = await Promise.all([
        notificationDeliveryWorker.processPendingNotificationDeliveries({
          channel: "email",
          limit,
        }),
        notificationDeliveryWorker.processPendingNotificationDeliveries({
          channel: "web_push",
          limit,
        }),
      ]);
      return c.json({ data: { email, webPush } });
    }
    const result =
      await notificationDeliveryWorker.processPendingNotificationDeliveries({
        channel,
        limit,
      });
    return c.json({ data: result });
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Error interno." },
      500,
    );
  }
});

// ATLAS_API_TEST_MODE=1 is set only by the opt-in cross-tenant integration
// suite (apps/api/src/__tests__/cross-tenant/run.mjs), which imports this
// module for app.request(...) and must never also bind the real port —
// nothing else in the codebase sets this variable, and it defaults to
// starting the server exactly as before.
if (process.env.RUNLY_API_TEST_MODE !== "1") {
  const server = serve({ fetch: app.fetch, port });
  console.log(`Runly API running on http://localhost:${port}`);

  process.on("SIGTERM", () => server.close(() => process.exit(0)));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
}

// Prevent stale-connection errors from the Prisma pg pool from crashing the
// API process. These are transient and Prisma will reconnect on the next query.
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason ?? "");
  console.error("[api] unhandledRejection (non-fatal):", msg);
});
process.on("uncaughtException", (err) => {
  const msg = err?.message ?? String(err);
  // Re-throw anything that isn't a transient DB connection error — those should
  // still crash the process so we don't silently swallow real bugs.
  const isConnectionError =
    msg.includes("Connection terminated") ||
    msg.includes("Connection reset") ||
    msg.includes("Server has closed the connection") ||
    msg.includes("EPIPE") ||
    msg.includes("timeout exceeded when trying to connect") ||
    msg.includes("connection timeout") ||
    err?.code === "P1001" ||
    err?.code === "P1017";
  if (isConnectionError) {
    console.error("[api] uncaughtException (transient DB error, continuing):", msg);
    return;
  }
  console.error("[api] uncaughtException (fatal):", err);
  process.exit(1);
});
