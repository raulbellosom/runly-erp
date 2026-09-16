import { createOfficeService } from "./services/office/service.js";
import { createOfficeRouter } from "./routes/office.js";
import { createFilesRouter } from "./routes/files.js";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import pkg from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const { PrismaClient } = pkg;
import { createClient } from "@supabase/supabase-js";
import {
  createUserSchema,
  hrCatalogCreateSchema,
  hrCatalogEnabledSchema,
  hrCatalogUpdateSchema,
  hrEmployeeCreateSchema,
  hrEmployeeEnabledSchema,
  hrEmployeeUpdateSchema,
  moduleInstallSchema,
  setupInitializeSchema,
} from "@runly/validators";
import {
  formatLogTimestamp,
  getConfiguredTimeZone,
  toLocalIso,
  formatLocalDateTime,
} from "@runly/core";
import {
  getPermissionPresentation,
  groupPermissionsForUi,
} from "./permission-catalog.js";
import {
  resolveActiveMembership,
  computeScopedPermissions,
  isSystemAdminMembership,
  createPermissionKeysCache,
  COMPANY_ADMIN_ROLE_KEYS,
} from "./lib/tenant-context.js";
import {
  createContactsService,
  ContactsServiceError,
} from "./services/contacts-service.js";
import {
  createFilesService,
} from "./services/files-service.js";
import {
  createCompanyService,
  CompanyServiceError,
} from "./services/company-service.js";
import { createHrService, HrServiceError } from "./services/hr-service.js";
import { createCompanyModuleService } from "./services/company-module-service.js";
import { verifySupabaseJwt } from "./services/jwt-verification.js";
import { createInventoryService, InventoryServiceError } from "./services/inventory-service.js";
import { createInventoryNotificationService } from "./services/inventory-notification-service.js";
import { createCommentsService, CommentsServiceError } from "./services/comments-service.js";
import { createInventoryRouter } from "./routes/inventory/index.js";
import { buildEmployeesExcelBuffer } from "./services/hr-export-service.js";
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
import { createSharesService as createNotesSharesService } from "./routes/notes/shares-service.js";
import { createCanvasService as createNotesCanvasService } from "./routes/notes/canvas-service.js";
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
import {
  get as cacheGet,
  set as cacheSet,
  del as cacheDel,
  delByPrefix as cacheDelByPrefix,
  TTL,
} from "./lib/cache.js";
import {
  filterGrantableKeys,
  findEscalatingKeys,
  diffGrantKeys,
} from "./lib/permission-grants.js";
import {
  signedUrlWithVariant,
  signedUrlsWithVariant,
} from "./lib/image-variants.js";
import { loadInstallerLiveKitDevEnv } from "./lib/livekit-dev-env.js";

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
const contactsService = createContactsService({ prisma });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);
const broadcaster = createRealtimeBroadcaster({
  supabaseUrl: process.env.SUPABASE_URL,
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
const STORAGE_BUCKET_NAME = "runly-files";
const STOREFRONT_BUCKET_NAME = "runly-storefront";
const WEBSITE_BUCKET_NAME = "runly-website";
const filesService = createFilesService({ prisma, supabaseAdmin });
const officeService = createOfficeService({ prisma, supabaseAdmin, broadcaster });
const companyService = createCompanyService({ prisma, supabaseAdmin });
const bundlerService = createModuleBundlerService({ prisma, supabaseAdmin });
const hrService = createHrService({ prisma });
const companyModuleService = createCompanyModuleService({ prisma });
const notificationDeliveryWorker = createNotificationDeliveryWorker({ prisma, supabaseAdmin });
const notificationService = createNotificationService({ prisma, broadcaster });
const distServeService = createDistServeService({ prisma, supabaseAdmin });
const inventoryService = createInventoryService({ prisma });
const inventoryNotifSvc = createInventoryNotificationService({ prisma, notificationService });
const commentsService = createCommentsService({ prisma });

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

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

const ADMIN_ROLE_KEYS = new Set(["runly.admin", "atlas.admin", "system.admin"]);
const BASE_PERMISSION_KEYS = new Set(["profile.self.read"]);

const _userContextInFlight = new Map();

async function getUserContextByAuthId(authUserId) {
  const cacheKey = `user_ctx:${authUserId}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

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
  if (!profile) return null;
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
    Boolean(membership?.role?.enabled),
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
    where: { key: { in: ["runly.admin", "atlas.admin", "system.admin"] } },
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

async function ensureSetupAdminRole(db) {
  // Role.key is no longer globally unique (Role is now company-scoped, see
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §9.3).
  // Prisma rejects `null` inside a compound-unique where (companyId_key), so
  // this system role (companyId IS NULL) is upserted by hand via findFirst.
  const existing = await db.role.findFirst({
    where: { companyId: null, key: { in: ["runly.admin", "atlas.admin"] } },
  });
  const data = {
    enabled: true,
    system: true,
    name: "Runly Admin",
    description: "Acceso total del sistema",
  };
  if (existing) {
    return db.role.update({ where: { id: existing.id }, data });
  }
  return db.role.create({ data: { key: "runly.admin", ...data } });
}

async function getSignedUrlByFileId(fileId, variant = "full") {
  if (!fileId) return null;
  const fileAsset = await prisma.fileAsset.findUnique({
    where: { id: fileId },
  });
  if (!fileAsset) return null;
  return signedUrlWithVariant(
    supabaseAdmin,
    fileAsset.bucket,
    fileAsset.objectKey,
    variant,
  );
}

function toPositiveInt(value, fallback, { min = 1, max = 500 } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.floor(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function normalizeIdentityUsersQuery(query = {}) {
  const page = toPositiveInt(query.page, 1, { min: 1, max: 100000 });
  const pageSize = toPositiveInt(query.pageSize, 20, { min: 1, max: 200 });
  const search = String(query.search ?? "").trim();
  const enabledRaw = String(query.enabled ?? "")
    .trim()
    .toLowerCase();
  const enabled =
    enabledRaw === "true" ? true : enabledRaw === "false" ? false : null;
  const sortByRaw = String(query.sortBy ?? "").trim();
  const sortDirRaw = String(query.sortDir ?? "")
    .trim()
    .toLowerCase();
  const sortDir = sortDirRaw === "asc" ? "asc" : "desc";

  return { page, pageSize, search, enabled, sortBy: sortByRaw, sortDir };
}

function toIdentitySortOrder(sortBy, sortDir) {
  const dir = sortDir === "asc" ? "asc" : "desc";
  switch (sortBy) {
    case "firstName":
      return [{ firstName: dir }, { createdAt: "desc" }];
    case "lastName":
      return [{ lastName: dir }, { createdAt: "desc" }];
    case "displayName":
      return [{ displayName: dir }, { createdAt: "desc" }];
    case "email":
      return [{ email: dir }, { createdAt: "desc" }];
    case "enabled":
      return [{ enabled: dir }, { createdAt: "desc" }];
    case "createdAt":
      return [{ createdAt: dir }];
    default:
      return [{ createdAt: "desc" }];
  }
}

function parseIdentityUserIds(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean)
    .filter((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      ),
    );
}

const PROTECTED_IDENTITY_ROLE_KEYS = new Set(["runly.admin", "atlas.admin", "system.admin"]);

function hasProtectedIdentityAdminRole(user) {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  return memberships.some((membership) => {
    if (!membership?.enabled) return false;
    const roleKey = String(membership?.role?.key ?? "")
      .trim()
      .toLowerCase();
    return PROTECTED_IDENTITY_ROLE_KEYS.has(roleKey);
  });
}

function buildIdentityUsersWhere({ search, enabled, companyId }) {
  // Bot profiles (e.g. the per-company MeridIAn assistant, is_bot = true) have no
  // login and are not administrable users — never list them in the users screen
  // or in any user picker that reads this endpoint (chat "Anadir miembros",
  // CreateChatModal, etc.).
  //
  // memberships.some({ companyId }) scopes every result to the caller's
  // active company — this is what actually enforces the tenant boundary.
  // When companyId is null (the zero-membership admin edge case) this can
  // never match any row (Membership.companyId is NOT NULL), so the query
  // safely returns zero users instead of every instance user.
  const where = {
    isBot: false,
    memberships: { some: { enabled: true, companyId } },
  };
  if (typeof enabled === "boolean") {
    where.enabled = enabled;
  }
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      {
        memberships: {
          some: {
            enabled: true,
            companyId,
            role: { name: { contains: search, mode: "insensitive" } },
          },
        },
      },
    ];
  }
  return where;
}

// Returns true only if `id` names a UserProfile with an enabled Membership
// in `companyId`. Every /identity/users/:id* route must call this before
// reading or mutating a specific user — without it, a caller with
// identity.users.* in Company A could act on any user UUID in the instance.
async function assertUserInCompany(id, companyId) {
  if (!companyId || !id) return false;
  const row = await prisma.userProfile.findFirst({
    where: { id, memberships: { some: { enabled: true, companyId } } },
    select: { id: true },
  });
  return Boolean(row);
}

// Same check, batched: returns only the subset of `ids` that belong to
// companyId. Used by the bulk endpoints instead of erroring one at a time.
async function filterUserIdsInCompany(ids, companyId) {
  if (!ids.length || !companyId) return [];
  const rows = await prisma.userProfile.findMany({
    where: { id: { in: ids }, memberships: { some: { enabled: true, companyId } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

async function buildAvatarUrlMapByFileIds(fileIds, variant = "thumb") {
  const avatarUrlMap = new Map();
  if (!fileIds.length) return avatarUrlMap;

  const fileAssets = await prisma.fileAsset.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, bucket: true, objectKey: true },
  });
  const byBucket = new Map();
  for (const asset of fileAssets) {
    if (!byBucket.has(asset.bucket)) byBucket.set(asset.bucket, []);
    byBucket.get(asset.bucket).push(asset);
  }
  await Promise.all(
    [...byBucket.entries()].map(async ([bucket, assets]) => {
      const paths = assets.map((asset) => asset.objectKey);
      const signedUrls = await signedUrlsWithVariant(
        supabaseAdmin,
        bucket,
        paths,
        variant,
      );
      assets.forEach((asset, index) => {
        avatarUrlMap.set(asset.id, signedUrls[index] ?? null);
      });
    }),
  );

  return avatarUrlMap;
}

function serializeIdentityUser(user, avatarUrlMap) {
  return {
    ...user,
    avatarUrl: user.avatarFileId
      ? (avatarUrlMap.get(user.avatarFileId) ?? null)
      : null,
    memberships: (user.memberships ?? []).map((membership) => ({
      id: membership.id,
      companyId: membership.companyId,
      companyName: membership.company?.name ?? null,
      roleId: membership.roleId,
      roleKey: membership.role?.key ?? null,
      roleName: membership.role?.name ?? null,
      enabled: membership.enabled,
    })),
  };
}

async function uploadIdentityAvatar({ profileId, file }) {
  const ext = file.name.split(".").pop() || "png";
  const objectKey = `modules/atlas-identity/userprofile/${profileId}/${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET_NAME)
    .upload(objectKey, arrayBuffer, {
      contentType: file.type,
      upsert: true,
    });
  if (uploadError) {
    throw new Error("UPLOAD_FAILED");
  }

  const asset = await prisma.fileAsset.create({
    data: {
      bucket: STORAGE_BUCKET_NAME,
      objectKey,
      originalName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      moduleKey: "runly.identity",
      entityType: "UserProfile",
      entityId: profileId,
    },
  });

  await prisma.userProfile.update({
    where: { id: profileId },
    data: { avatarFileId: asset.id },
  });

  return asset;
}

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
    allowHeaders: ["Content-Type", "Authorization", "X-Runly-Company", "X-Runly-Company-Id", "X-Runly-Site"],
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
      });
      cacheDel(`user_ctx:${authUserId}`);
      const avatarUrl = await getSignedUrlByFileId(asset.id, "card");
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
    if (!profile) return c.json({ data: [] });
    const memberships = await prisma.membership.findMany({
      where: { userId: profile.id, enabled: true },
      include: {
        role: true,
        company: {
          include: { brandingConfig: true },
        },
      },
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
          const { data: signedList } = await supabaseAdmin.storage
            .from(bucket)
            .createSignedUrls(paths, 3600);
          if (Array.isArray(signedList)) {
            for (let i = 0; i < assets.length; i++) {
              logoUrlMap.set(assets[i].id, signedList[i]?.signedUrl ?? null);
            }
          }
        }),
      );
    }

    const data = memberships.map((m) => {
      const logoFileId = m.company?.brandingConfig?.logoFileId;
      return {
        ...m,
        company: m.company
          ? {
              id: m.company.id,
              name: m.company.name,
              logoUrl: logoFileId ? (logoUrlMap.get(logoFileId) ?? null) : null,
              primaryColor: m.company.brandingConfig?.primaryColor ?? null,
            }
          : null,
      };
    });

    return c.json({ data });
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

// ── Companies: create a new tenant ──────────────────────────────────────────
// Distinct from /company/profile|address|branding below (which always
// operate on the REQUESTER'S active company). Gated to any admin of their
// currently-active company (tenant.isAdmin — runly.admin or system.admin),
// not system.admin alone: in the common case of a single-company instance,
// the owner's account is an runly.admin for that one company, never
// system.admin (that role is seeded separately and often held by nobody in
// practice) — restricting this to system.admin would make "create a second
// company" unreachable for the exact person who needs it. Creating a new
// company never grants access to any OTHER existing company's data, so this
// is not a cross-tenant privilege — just "can this admin spin up an
// additional workspace they'll immediately own." Reuses the existing
// company.profile.create permission (already seeded, already granted to
// runly.admin/system.admin via the isAdmin-gets-everything path) rather than
// inventing a new permission key just for this.
app.post(
  "/companies",
  authMiddleware,
  requirePermission("company.profile.create"),
  async (c) => {
    const tenant = c.get("tenantContext");
    if (!tenant.isAdmin) {
      return c.json(
        { error: "Solo un administrador puede crear nuevas empresas." },
        403,
      );
    }
    try {
      const body = await c.req.json().catch(() => ({}));
      const name = String(body.name ?? "").trim();
      if (!name) {
        return c.json({ error: "El nombre de la empresa es obligatorio." }, 422);
      }

      const baseSlug = toSlug(name) || "empresa";
      let slug = baseSlug;
      let suffix = 1;
      // eslint-disable-next-line no-await-in-loop -- sequential by design: each check depends on the previous candidate being taken
      while (await prisma.company.findUnique({ where: { slug }, select: { id: true } })) {
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
      }

      const userId = c.get("userId");
      const company = await prisma.$transaction(async (tx) => {
        const adminRole = await ensureSetupAdminRole(tx);
        const created = await tx.company.create({
          data: {
            name,
            slug,
            legalName: String(body.legalName ?? "").trim() || null,
            rfc: String(body.rfc ?? "").trim() || null,
            contactEmail: String(body.contactEmail ?? "").trim() || null,
            phone: String(body.phone ?? "").trim() || null,
            website: String(body.website ?? "").trim() || null,
            country: String(body.country ?? "").trim() || null,
            state: String(body.state ?? "").trim() || null,
            city: String(body.city ?? "").trim() || null,
            street: String(body.street ?? "").trim() || null,
            postalCode: String(body.postalCode ?? "").trim() || null,
          },
        });
        // The creator becomes this company's first admin immediately — no
        // separate invitation step needed to start using it. Uses their
        // EXISTING profile/login; unlike /setup/initialize (which bootstraps
        // the instance's very first company + a brand-new Supabase Auth
        // user), this never touches Supabase Auth at all.
        await tx.membership.create({
          data: { companyId: created.id, userId, roleId: adminRole.id },
        });
        await tx.brandingConfig.create({
          data: {
            companyId: created.id,
            primaryColor: /^#[0-9a-fA-F]{6}$/.test(String(body.primaryColor ?? ""))
              ? body.primaryColor
              : "#0A7BFF",
          },
        });
        return created;
      });

      // Take effect immediately: the creator's memberships list (and hence
      // the CompanySwitcher) must show the new company without waiting for
      // the user-context cache TTL to expire.
      cacheDel(`user_ctx:${c.get("authUserId")}`);

      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "company.create",
        severity: "success",
        entityType: "Company",
        entityId: company.id,
        summary: `${actorName} creó la empresa "${company.name}"`,
      });

      return c.json({ data: company }, 201);
    } catch (err) {
      if (err?.code === "P2002") {
        return c.json({ error: "Ya existe una empresa con datos únicos duplicados." }, 409);
      }
      console.error("[companies/create]", err);
      return c.json({ error: "No se pudo crear la empresa." }, 500);
    }
  },
);

// ── Company: Profile ─────────────────────────────────────────────────────────

app.get(
  "/company/profile",
  authMiddleware,
  requirePermission("company.profile.read"),
  async (c) => {
    try {
      const data = await companyService.getProfile(c.get("companyId"));
      return c.json({ data });
    } catch (err) {
      if (err instanceof CompanyServiceError)
        return c.json({ error: err.message }, err.status);
      return c.json(
        { error: "No se pudo cargar el perfil de la empresa." },
        500,
      );
    }
  },
);

app.put(
  "/company/profile",
  authMiddleware,
  requirePermission("company.profile.update"),
  async (c) => {
    try {
      const body = await c.req.json();
      const name = String(body.name ?? "").trim();
      if (!name)
        return c.json(
          { error: "El nombre de la empresa es obligatorio." },
          400,
        );
      const data = await companyService.updateProfile({
        name,
        legalName: String(body.legalName ?? "").trim(),
        rfc: String(body.rfc ?? "").trim(),
        companyType: String(body.companyType ?? "").trim(),
        companyTypeName: String(body.companyTypeName ?? "").trim(),
        industryKey: String(body.industryKey ?? "").trim(),
        industryName: String(body.industryName ?? "").trim(),
        companySize: String(body.companySize ?? "").trim(),
        contactEmail: String(body.contactEmail ?? "").trim(),
        phone: String(body.phone ?? "").trim(),
        website: String(body.website ?? "").trim(),
      }, c.get("companyId"));
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "company.profile.update",
        severity: "info",
        entityType: "Company",
        summary: `${actorName} actualizó el perfil de la empresa`,
      });
      return c.json({ data });
    } catch (err) {
      if (err instanceof CompanyServiceError)
        return c.json({ error: err.message }, err.status);
      return c.json(
        { error: "No se pudo actualizar el perfil de la empresa." },
        500,
      );
    }
  },
);

// ── Company: Address ─────────────────────────────────────────────────────────

app.get(
  "/company/address",
  authMiddleware,
  requirePermission("company.address.read"),
  async (c) => {
    try {
      const data = await companyService.getAddress(c.get("companyId"));
      return c.json({ data });
    } catch (err) {
      if (err instanceof CompanyServiceError)
        return c.json({ error: err.message }, err.status);
      return c.json(
        { error: "No se pudo cargar la direccion de la empresa." },
        500,
      );
    }
  },
);

app.put(
  "/company/address",
  authMiddleware,
  requirePermission("company.address.update"),
  async (c) => {
    try {
      const body = await c.req.json();
      const data = await companyService.updateAddress({
        country: String(body.country ?? "").trim(),
        state: String(body.state ?? "").trim(),
        city: String(body.city ?? "").trim(),
        colony: String(body.colony ?? "").trim(),
        street: String(body.street ?? "").trim(),
        extNumber: String(body.extNumber ?? "").trim(),
        intNumber: String(body.intNumber ?? "").trim(),
        postalCode: String(body.postalCode ?? "").trim(),
      }, c.get("companyId"));
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "company.address.update",
        severity: "info",
        entityType: "Company",
        summary: `${actorName} actualizó la dirección de la empresa`,
      });
      return c.json({ data });
    } catch (err) {
      if (err instanceof CompanyServiceError)
        return c.json({ error: err.message }, err.status);
      return c.json(
        { error: "No se pudo actualizar la direccion de la empresa." },
        500,
      );
    }
  },
);

// ── Company: Branding ────────────────────────────────────────────────────────

app.get(
  "/company/branding",
  authMiddleware,
  requirePermission("company.branding.read"),
  async (c) => {
    try {
      const data = await companyService.getBranding(c.get("companyId"));
      return c.json({ data });
    } catch (err) {
      if (err instanceof CompanyServiceError)
        return c.json({ error: err.message }, err.status);
      return c.json(
        { error: "No se pudo cargar la configuracion de marca." },
        500,
      );
    }
  },
);

app.put(
  "/company/branding",
  authMiddleware,
  requirePermission("company.branding.update"),
  async (c) => {
    try {
      const companyId = c.get("companyId");
      const body = await c.req.json();
      const primaryColor = String(body.primaryColor ?? "").trim();
      if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
        return c.json({ error: "primaryColor valido es obligatorio." }, 400);
      }
      const logoFileIdRaw = body.logoFileId;
      const logoFileId =
        logoFileIdRaw === null ||
        logoFileIdRaw === undefined ||
        logoFileIdRaw === ""
          ? null
          : String(logoFileIdRaw).trim();
      const data = await companyService.updateBranding(
        { primaryColor, logoFileId },
        companyId,
      );
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "company.branding.update",
        severity: "info",
        entityType: "Company",
        entityId: companyId,
        summary: `${actorName} actualizó la marca de la empresa`,
      });
      return c.json({ data });
    } catch (err) {
      if (err instanceof CompanyServiceError)
        return c.json({ error: err.message }, err.status);
      return c.json(
        { error: "No se pudo guardar la configuracion de marca." },
        500,
      );
    }
  },
);

app.route("/", createOfficeRouter({ officeService, authMiddleware, requirePermission }));
app.route("/", createFilesRouter({ prisma, supabaseAdmin, filesService, authMiddleware, requirePermission }));

app.get(
  "/identity/permissions",
  authMiddleware,
  requirePermission("identity.permissions.read"),
  async (c) => {
    try {
      const includeInactive = c.req.query("includeInactive") === "true";
      const permissions = await prisma.permission.findMany({
        where: includeInactive ? {} : { active: true },
        orderBy: [{ moduleId: "asc" }, { key: "asc" }],
      });
      const grouped = groupPermissionsForUi(permissions);
      return c.json({
        data: {
          permissions: permissions.map((permission) => {
            const presentation = getPermissionPresentation(permission.key);
            return {
              ...permission,
              name: presentation.name,
              description: presentation.description,
              groupKey: presentation.groupKey,
              groupLabel: presentation.groupLabel,
              sortOrder: presentation.sortOrder,
              isSystem: true,
            };
          }),
          groups: grouped,
        },
      });
    } catch {
      return c.json({ error: "No se pudieron cargar los permisos." }, 500);
    }
  },
);

// A role is editable/deletable/listable-in-detail by: (a) a system admin, for
// any role, or (b) a company-scoped caller, only for a role that belongs to
// THEIR OWN company. System roles (companyId === null, e.g.
// runly.admin/system.admin) are never touchable by a company-scoped caller,
// even one holding identity.roles.*/identity.permissions.* -- those
// permissions govern a company's own custom roles, not the platform's shared
// catalog. Returns null (→ 404 at the call site) rather than throwing, so
// existence is never confirmed/denied differently for an out-of-scope role.
async function loadCompanyEditableRole(id, tenant) {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) return null;
  if (tenant?.isSystemAdmin) return role;
  if (role.companyId && role.companyId === tenant?.companyId) return role;
  return null;
}

app.get(
  "/identity/roles",
  authMiddleware,
  requirePermission("identity.roles.read"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const roles = await prisma.role.findMany({
        where: tenant.isSystemAdmin
          ? {}
          : { OR: [{ companyId: null }, { companyId: tenant.companyId }] },
        include: {
          permissions: {
            select: {
              permission: {
                select: { id: true, key: true, name: true, moduleId: true },
              },
            },
          },
          _count: { select: { memberships: { where: { enabled: true } } } },
        },
        orderBy: { name: "asc" },
      });
      return c.json({
        data: roles.map((role) => ({
          ...role,
          permissionKeys: role.permissions.map((p) => p.permission.key),
          memberCount: role._count.memberships,
        })),
      });
    } catch {
      return c.json({ error: "No se pudieron cargar los roles." }, 500);
    }
  },
);

app.post(
  "/identity/roles",
  authMiddleware,
  requirePermission("identity.roles.create"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      if (!tenant.companyId) {
        return c.json({ error: "Selecciona una empresa activa para crear un rol." }, 400);
      }
      const body = await c.req.json();
      const key = String(body.key ?? "").trim();
      const name = String(body.name ?? "").trim();
      const description = String(body.description ?? "").trim() || null;
      if (!key || !name)
        return c.json({ error: "key y name son obligatorios." }, 400);
      const role = await prisma.role.create({
        data: { key, name, description, system: false, enabled: true, companyId: tenant.companyId },
      });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.role.create",
        severity: "success",
        entityType: "Role",
        entityId: role.id,
        summary: `${actorName} creó el rol "${role.name}"`,
      });
      return c.json({ data: role }, 201);
    } catch {
      return c.json({ error: "No se pudo crear el rol." }, 500);
    }
  },
);

app.put(
  "/identity/roles/:id",
  authMiddleware,
  requirePermission("identity.roles.update"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const id = c.req.param("id");
      const existing = await loadCompanyEditableRole(id, tenant);
      if (!existing) return c.json({ error: "Rol no encontrado." }, 404);
      const body = await c.req.json();
      const name = String(body.name ?? "").trim();
      const description = String(body.description ?? "").trim() || null;
      if (!name) return c.json({ error: "name es obligatorio." }, 400);
      const role = await prisma.role.update({
        where: { id },
        data: { name, description },
      });
      cacheDelByPrefix("user_ctx:");
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.role.update",
        severity: "info",
        entityType: "Role",
        entityId: id,
        summary: `${actorName} actualizó el rol "${role.name}"`,
      });
      return c.json({ data: role });
    } catch {
      return c.json({ error: "No se pudo actualizar el rol." }, 500);
    }
  },
);

app.patch(
  "/identity/roles/:id/enabled",
  authMiddleware,
  requirePermission("identity.roles.update"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const id = c.req.param("id");
      const existing = await loadCompanyEditableRole(id, tenant);
      if (!existing) return c.json({ error: "Rol no encontrado." }, 404);
      const body = await c.req.json();
      const enabled = Boolean(body.enabled);
      const role = await prisma.role.update({
        where: { id },
        data: { enabled },
      });
      // Disabled roles are dropped from the effective permission set — bust caches.
      cacheDelByPrefix("user_ctx:");
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: role.enabled ? "identity.role.enable" : "identity.role.disable",
        severity: role.enabled ? "info" : "warning",
        entityType: "Role",
        entityId: id,
        summary: `${actorName} ${role.enabled ? "habilitó" : "deshabilitó"} el rol "${role.name}"`,
      });
      return c.json({ data: role });
    } catch {
      return c.json({ error: "No se pudo actualizar el estado del rol." }, 500);
    }
  },
);

app.delete(
  "/identity/roles/:id",
  authMiddleware,
  requirePermission("identity.roles.delete"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const id = c.req.param("id");
      const role = await loadCompanyEditableRole(id, tenant);
      if (!role) return c.json({ error: "Rol no encontrado." }, 404);
      if (role.system || ADMIN_ROLE_KEYS.has(role.key)) {
        return c.json(
          { error: "No se puede eliminar un rol del sistema." },
          403,
        );
      }
      await prisma.role.delete({ where: { id } });
      cacheDelByPrefix("user_ctx:");
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.role.delete",
        severity: "critical",
        entityType: "Role",
        entityId: id,
        summary: `${actorName} eliminó el rol "${role.key}"`,
      });
      return c.json({ ok: true });
    } catch {
      return c.json({ error: "No se pudo eliminar el rol." }, 500);
    }
  },
);

app.patch(
  "/identity/roles/:id/permissions",
  authMiddleware,
  requirePermission("identity.permissions.update"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const id = c.req.param("id");
      const existing = await loadCompanyEditableRole(id, tenant);
      if (!existing) return c.json({ error: "Rol no encontrado." }, 404);
      const body = await c.req.json();
      const permissionKeys = Array.isArray(body.permissionKeys)
        ? body.permissionKeys
        : [];
      const permissions = await prisma.permission.findMany({
        where: { key: { in: permissionKeys }, active: true },
        select: { id: true },
      });
      await prisma.$transaction([
        prisma.rolePermission.deleteMany({ where: { roleId: id } }),
        ...(permissions.length
          ? [
              prisma.rolePermission.createMany({
                data: permissions.map((permission) => ({
                  roleId: id,
                  permissionId: permission.id,
                })),
              }),
            ]
          : []),
      ]);
      // A role's permission set feeds every member's cached user context
      // (permissions + navigation). Bust all user contexts so the change is
      // visible on the members' next request instead of after the 5-min TTL.
      cacheDelByPrefix("user_ctx:");
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.role.permissions.update",
        severity: "info",
        entityType: "Role",
        entityId: id,
        summary: `${actorName} actualizó los permisos del rol (${permissions.length})`,
      });
      return c.json({
        data: { roleId: id, permissionCount: permissions.length },
      });
    } catch {
      return c.json(
        { error: "No se pudieron actualizar los permisos del rol." },
        500,
      );
    }
  },
);

app.get(
  "/identity/users",
  authMiddleware,
  requirePermission("identity.users.read"),
  async (c) => {
    try {
      const normalizedQuery = normalizeIdentityUsersQuery(c.req.query());
      const tenant = c.get("tenantContext");
      const where = buildIdentityUsersWhere({ ...normalizedQuery, companyId: tenant.companyId });
      const orderBy = toIdentitySortOrder(
        normalizedQuery.sortBy,
        normalizedQuery.sortDir,
      );
      const skip = (normalizedQuery.page - 1) * normalizedQuery.pageSize;

      const [users, total] = await prisma.$transaction([
        prisma.userProfile.findMany({
          where,
          include: {
            memberships: {
              include: {
                role: true,
                company: true,
              },
              where: { enabled: true },
            },
          },
          orderBy,
          skip,
          take: normalizedQuery.pageSize,
        }),
        prisma.userProfile.count({ where }),
      ]);

      const avatarFileIds = users
        .map((user) => user.avatarFileId)
        .filter(Boolean);
      const avatarUrlMap = await buildAvatarUrlMapByFileIds(avatarFileIds);

      return c.json({
        data: users.map((user) => serializeIdentityUser(user, avatarUrlMap)),
        pagination: {
          page: normalizedQuery.page,
          pageSize: normalizedQuery.pageSize,
          total,
        },
      });
    } catch {
      return c.json({ error: "No se pudieron cargar los usuarios." }, 500);
    }
  },
);

app.get(
  "/identity/users/:id",
  authMiddleware,
  requirePermission("identity.users.read"),
  async (c) => {
    try {
      const id = c.req.param("id");
      const tenant = c.get("tenantContext");
      if (!(await assertUserInCompany(id, tenant.companyId))) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }
      const user = await prisma.userProfile.findUnique({
        where: { id },
        include: {
          memberships: {
            include: { role: true, company: true },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!user) return c.json({ error: "Usuario no encontrado." }, 404);

      const avatarFileIds = user.avatarFileId ? [user.avatarFileId] : [];
      const avatarUrlMap = await buildAvatarUrlMapByFileIds(avatarFileIds);
      const serialized = serializeIdentityUser(user, avatarUrlMap);

      return c.json({
        data: { ...serialized, membershipsTotal: serialized.memberships.length },
      });
    } catch {
      return c.json({ error: "No se pudo cargar el usuario." }, 500);
    }
  },
);

app.post(
  "/identity/users",
  authMiddleware,
  requirePermission("identity.users.create"),
  async (c) => {
    try {
      const body = await c.req.json();
      const fields = createUserSchema.parse(body);

      const { data: authData, error: authError } =
        await supabaseAdmin.auth.admin.createUser({
          email: fields.email,
          password: fields.password,
          email_confirm: true,
        });
      if (authError) {
        return c.json(
          { error: translateSupabaseCreateUserError(authError) },
          400,
        );
      }
      const authUserId = authData.user.id;

      const tenant = c.get("tenantContext");
      const companyId = tenant.companyId;
      if (!companyId) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        return c.json(
          { error: "No se pudo determinar la empresa activa." },
          400,
        );
      }

      if (fields.roleId) {
        const role = await prisma.role.findUnique({
          where: { id: fields.roleId },
          select: { companyId: true },
        });
        if (!role || (role.companyId !== null && role.companyId !== companyId)) {
          await supabaseAdmin.auth.admin.deleteUser(authUserId);
          return c.json({ error: "El rol seleccionado no pertenece a esta empresa." }, 400);
        }
      }

      try {
        const userProfile = await prisma.$transaction(async (tx) => {
          const profile = await tx.userProfile.create({
            data: {
              authUserId,
              firstName: fields.firstName,
              lastName: fields.lastName,
              displayName: `${fields.firstName} ${fields.lastName}`.trim(),
              email: fields.email,
            },
          });
          await tx.membership.create({
            data: {
              companyId,
              userId: profile.id,
              roleId: fields.roleId ?? null,
            },
          });
          return profile;
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.user.create",
          severity: "success",
          entityType: "UserProfile",
          entityId: userProfile.id,
          summary: `${actorName} creó al usuario ${fields.email}`,
        });
        return c.json({ data: userProfile }, 201);
      } catch (txError) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        throw txError;
      }
    } catch (err) {
      if (err?.name === "ZodError") {
        return c.json(
          { error: err.errors[0]?.message ?? "Datos inválidos." },
          400,
        );
      }
      return c.json({ error: "No se pudo crear el usuario." }, 500);
    }
  },
);

app.patch(
  "/identity/users/bulk/enabled",
  authMiddleware,
  requirePermission("identity.users.update"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const body = await c.req.json();
      const ids = parseIdentityUserIds(body?.ids);
      const enabled = body?.enabled;
      if (!ids.length) {
        return c.json(
          { error: "Debes enviar al menos un usuario valido." },
          400,
        );
      }
      if (typeof enabled !== "boolean") {
        return c.json({ error: "El campo enabled es obligatorio." }, 400);
      }
      const validIds = await filterUserIdsInCompany(ids, tenant.companyId);
      if (validIds.length !== ids.length) {
        return c.json({ error: "Uno o mas usuarios no pertenecen a tu empresa." }, 403);
      }
      const result = await prisma.userProfile.updateMany({
        where: { id: { in: validIds } },
        data: { enabled },
      });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: enabled
          ? "identity.user.bulk_enable"
          : "identity.user.bulk_disable",
        severity: enabled ? "info" : "warning",
        entityType: "UserProfile",
        summary: `${actorName} ${enabled ? "habilitó" : "deshabilitó"} ${result.count} usuario(s)`,
      });
      return c.json({ data: { count: result.count, enabled } });
    } catch {
      return c.json(
        { error: "No se pudo actualizar el estado de los usuarios." },
        500,
      );
    }
  },
);

app.delete(
  "/identity/users/bulk",
  authMiddleware,
  requirePermission("identity.users.delete"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const body = await c.req.json();
      const ids = parseIdentityUserIds(body?.ids);
      if (!ids.length) {
        return c.json(
          { error: "Debes enviar al menos un usuario valido." },
          400,
        );
      }

      const context = c.get("userContext");
      if (ids.includes(context?.profile?.id)) {
        return c.json({ error: "No puedes eliminar tu propia cuenta." }, 400);
      }

      const validIds = await filterUserIdsInCompany(ids, tenant.companyId);
      if (validIds.length !== ids.length) {
        return c.json({ error: "Uno o mas usuarios no pertenecen a tu empresa." }, 403);
      }

      const users = await prisma.userProfile.findMany({
        where: { id: { in: validIds } },
        select: {
          id: true,
          authUserId: true,
          memberships: {
            where: { enabled: true },
            select: {
              enabled: true,
              role: { select: { key: true } },
            },
          },
        },
      });
      if (!users.length) {
        return c.json({ data: { count: 0 } });
      }
      if (users.some(hasProtectedIdentityAdminRole)) {
        return c.json(
          {
            error:
              "No se pueden eliminar usuarios con rol Runly Admin o System Admin.",
          },
          400,
        );
      }

      for (const user of users) {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(
          user.authUserId,
        );
        if (error) {
          return c.json(
            { error: "No se pudo eliminar uno o mas usuarios en Auth." },
            500,
          );
        }
      }

      const deleted = await prisma.userProfile.deleteMany({
        where: { id: { in: users.map((user) => user.id) } },
      });
      for (const user of users) {
        cacheDel(`user_ctx:${user.authUserId}`);
      }

      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.user.bulk_delete",
        severity: "critical",
        entityType: "UserProfile",
        summary: `${actorName} eliminó ${deleted.count} usuario(s)`,
      });

      return c.json({ data: { count: deleted.count } });
    } catch {
      return c.json({ error: "No se pudieron eliminar los usuarios." }, 500);
    }
  },
);

app.post(
  "/identity/users/export/excel",
  authMiddleware,
  requirePermission("identity.users.read"),
  async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const ids = parseIdentityUserIds(body?.ids);
      const normalizedQuery = normalizeIdentityUsersQuery(c.req.query());
      const tenant = c.get("tenantContext");
      const where = buildIdentityUsersWhere({ ...normalizedQuery, companyId: tenant.companyId });
      if (ids.length) where.id = { in: ids };

      const users = await prisma.userProfile.findMany({
        where,
        include: {
          memberships: {
            include: { role: true, company: true },
            where: { enabled: true },
          },
        },
        orderBy: toIdentitySortOrder(
          normalizedQuery.sortBy,
          normalizedQuery.sortDir,
        ),
      });

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Usuarios");
      sheet.columns = [
        { header: "ID", key: "id", width: 40 },
        { header: "Nombre", key: "firstName", width: 20 },
        { header: "Apellidos", key: "lastName", width: 24 },
        { header: "Nombre completo", key: "displayName", width: 30 },
        { header: "Correo", key: "email", width: 32 },
        { header: "Rol", key: "roleName", width: 24 },
        { header: "Empresa", key: "companyName", width: 28 },
        { header: "Estado", key: "enabled", width: 12 },
        { header: "Telefono", key: "phone", width: 18 },
        { header: "Fecha nacimiento", key: "birthDate", width: 18 },
        { header: "Sexo", key: "gender", width: 18 },
        { header: "Pais", key: "country", width: 18 },
        { header: "Estado/Provincia", key: "state", width: 20 },
        { header: "Ciudad", key: "city", width: 20 },
        { header: "Colonia", key: "colony", width: 20 },
        { header: "Calle", key: "street", width: 20 },
        { header: "Numero exterior", key: "extNumber", width: 16 },
        { header: "Numero interior", key: "intNumber", width: 16 },
        { header: "Codigo postal", key: "postalCode", width: 16 },
        { header: "Biografia", key: "bio", width: 40 },
        { header: "Creado", key: "createdAt", width: 20 },
      ];
      sheet.getRow(1).font = { bold: true };

      for (const user of users) {
        const membership = user.memberships?.[0] ?? null;
        sheet.addRow({
          id: user.id,
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          displayName: user.displayName ?? "",
          email: user.email ?? "",
          roleName: membership?.role?.name ?? "",
          companyName: membership?.company?.name ?? "",
          enabled: user.enabled ? "Activo" : "Inactivo",
          phone: user.phone ?? "",
          birthDate: user.birthDate
            ? // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date calendar value
              new Date(user.birthDate).toISOString().slice(0, 10)
            : "",
          gender: user.gender ?? "",
          country: user.country ?? "",
          state: user.state ?? "",
          city: user.city ?? "",
          colony: user.colony ?? "",
          street: user.street ?? "",
          extNumber: user.extNumber ?? "",
          intNumber: user.intNumber ?? "",
          postalCode: user.postalCode ?? "",
          bio: user.bio ?? "",
          createdAt: user.createdAt
            ? formatLocalDateTime(user.createdAt)
            : "",
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `usuarios-${toLocalIso()}.xlsx`;
      c.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      c.header("X-Atlas-Export-Count", String(users.length));
      return c.body(buffer);
    } catch {
      return c.json({ error: "No se pudo generar el archivo Excel." }, 500);
    }
  },
);

app.post(
  "/identity/users/export/pdf",
  authMiddleware,
  requirePermission("identity.users.read"),
  async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const ids = parseIdentityUserIds(body?.ids);
      const normalizedQuery = normalizeIdentityUsersQuery(c.req.query());
      const tenant = c.get("tenantContext");
      const where = buildIdentityUsersWhere({ ...normalizedQuery, companyId: tenant.companyId });
      if (ids.length) where.id = { in: ids };

      const users = await prisma.userProfile.findMany({
        where,
        include: {
          memberships: {
            include: { role: true, company: true },
            where: { enabled: true },
          },
        },
        orderBy: toIdentitySortOrder(normalizedQuery.sortBy, normalizedQuery.sortDir),
      });

      const authUserId = c.get("userId");
      const membership = await prisma.membership.findFirst({ where: { userId: authUserId, enabled: true } });
      const companyId = membership?.companyId ?? null;

      const { resolvePdfDocumentCtor, resolveCompanyBranding, drawPdfHeader, drawPdfFooter, formatDateEs, toSafeText } =
        await import("./services/pdf-branding-service.js");
      const PDFDocument = await resolvePdfDocumentCtor();
      const branding = await resolveCompanyBranding({ prisma, companyId });

      const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));

      const HEADER_H = 90;
      const FOOTER_H = 36;
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const bodyTop = 40 + HEADER_H + 10;
      const bodyBottom = pageH - 40 - FOOTER_H - 10;

      function drawTableHeader(y) {
        doc.rect(40, y, pageW - 80, 20).fill(branding.primaryColor || "#2563eb");
        doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
        doc.text("Nombre completo", 48, y + 6, { width: 130 });
        doc.text("Correo", 184, y + 6, { width: 130 });
        doc.text("Rol", 320, y + 6, { width: 90 });
        doc.text("Estado", 416, y + 6, { width: 55 });
        doc.text("Ingreso", 476, y + 6, { width: 80 });
        doc.fillColor("#000000").font("Helvetica");
        return y + 20;
      }

      let page = 0;
      let y = bodyTop;

      drawPdfHeader(doc, branding, { title: "Directorio de usuarios", subtitle: `${users.length} registro${users.length !== 1 ? "s" : ""}`, folio: `RPT-USR-${new Date().getFullYear()}` });
      y = drawTableHeader(y);

      for (let i = 0; i < users.length; i++) {
        const u = users[i];
        const m = u.memberships?.[0] ?? null;
        const rowH = 18;

        if (y + rowH > bodyBottom) {
          drawPdfFooter(doc, branding, { pageNum: ++page });
          doc.addPage();
          drawPdfHeader(doc, branding, { title: "Directorio de usuarios", subtitle: `${users.length} registro${users.length !== 1 ? "s" : ""}`, folio: `RPT-USR-${new Date().getFullYear()}` });
          y = bodyTop;
          y = drawTableHeader(y);
        }

        const bg = i % 2 === 0 ? "#ffffff" : "#f8f9fb";
        doc.rect(40, y, pageW - 80, rowH).fill(bg);
        doc.fillColor("#1a1a1a").fontSize(8).font("Helvetica");
        doc.text(toSafeText(u.displayName || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()), 48, y + 5, { width: 130, ellipsis: true });
        doc.text(toSafeText(u.email ?? ""), 184, y + 5, { width: 130, ellipsis: true });
        doc.text(toSafeText(m?.role?.name ?? "—"), 320, y + 5, { width: 90, ellipsis: true });
        doc.text(u.enabled ? "Activo" : "Inactivo", 416, y + 5, { width: 55 });
        doc.text(u.createdAt ? formatDateEs(u.createdAt) : "—", 476, y + 5, { width: 80 });
        y += rowH;
      }

      drawPdfFooter(doc, branding, { pageNum: ++page });
      doc.end();

      const buffer = await new Promise((resolve, reject) => {
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
      });

      const filename = `usuarios-${toLocalIso()}.pdf`;
      c.header("Content-Type", "application/pdf");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      c.header("X-Atlas-Export-Count", String(users.length));
      return c.body(buffer);
    } catch (err) {
      console.error("[identity/export/pdf]", err);
      return c.json({ error: "No se pudo generar el PDF." }, 500);
    }
  },
);

app.post(
  "/identity/users/:id/avatar",
  authMiddleware,
  requirePermission("identity.users.update"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const id = c.req.param("id");
      const target = await prisma.userProfile.findFirst({
        where: { id, memberships: { some: { enabled: true, companyId: tenant.companyId } } },
        select: { id: true, authUserId: true },
      });
      if (!target) return c.json({ error: "Usuario no encontrado." }, 404);

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

      const asset = await uploadIdentityAvatar({ profileId: target.id, file });
      cacheDel(`user_ctx:${target.authUserId}`);
      const avatarUrl = await getSignedUrlByFileId(asset.id, "card");
      return c.json({ data: { avatarUrl, avatarFileId: asset.id } });
    } catch {
      return c.json(
        { error: "No se pudo actualizar el avatar del usuario." },
        500,
      );
    }
  },
);

app.get(
  "/identity/users/:id/avatar/signed-url",
  authMiddleware,
  requirePermission("identity.users.read"),
  async (c) => {
    try {
      const tenant = c.get("tenantContext");
      const id = c.req.param("id");
      const target = await prisma.userProfile.findFirst({
        where: { id, memberships: { some: { enabled: true, companyId: tenant.companyId } } },
        select: { avatarFileId: true },
      });
      if (!target) return c.json({ error: "Usuario no encontrado." }, 404);
      const variant = c.req.query("variant") || "full";
      const signedUrl = await getSignedUrlByFileId(target.avatarFileId, variant);
      return c.json({ data: { signedUrl } });
    } catch {
      return c.json(
        { error: "No se pudo generar el enlace del avatar." },
        500,
      );
    }
  },
);

app.delete(
  "/identity/users/:id",
  authMiddleware,
  requirePermission("identity.users.delete"),
  async (c) => {
    try {
      const id = c.req.param("id");
      const context = c.get("userContext");
      const tenant = c.get("tenantContext");

      if (id === context.profile.id) {
        return c.json({ error: "No puedes eliminar tu propia cuenta." }, 400);
      }
      if (!(await assertUserInCompany(id, tenant.companyId))) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }

      const targetUser = await prisma.userProfile.findUnique({
        where: { id },
        include: {
          memberships: {
            where: { enabled: true },
            include: { role: { select: { key: true } } },
          },
        },
      });
      if (!targetUser) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }
      if (hasProtectedIdentityAdminRole(targetUser)) {
        return c.json(
          {
            error:
              "No se puede eliminar un usuario con rol Runly Admin o System Admin.",
          },
          400,
        );
      }

      await supabaseAdmin.auth.admin.deleteUser(targetUser.authUserId);
      await prisma.userProfile.delete({ where: { id } });

      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.user.delete",
        severity: "critical",
        entityType: "UserProfile",
        entityId: id,
        summary: `${actorName} eliminó al usuario ${targetUser.email ?? id}`,
      });

      return c.json({ ok: true });
    } catch {
      return c.json({ error: "No se pudo eliminar el usuario." }, 500);
    }
  },
);

app.patch(
  "/identity/users/:id",
  authMiddleware,
  requirePermission("identity.users.update"),
  async (c) => {
    try {
      const id = c.req.param("id");
      const tenant = c.get("tenantContext");
      if (!(await assertUserInCompany(id, tenant.companyId))) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }
      const body = await c.req.json();
      const patch = {};

      // Disabling an Atlas Admin / System Admin here would achieve the same
      // lockout the protected-role guard on DELETE already exists to prevent
      // — this PATCH route had no equivalent check.
      if (body.enabled === false) {
        const targetForDisable = await prisma.userProfile.findUnique({
          where: { id },
          include: {
            memberships: {
              where: { enabled: true },
              include: { role: { select: { key: true } } },
            },
          },
        });
        if (targetForDisable && hasProtectedIdentityAdminRole(targetForDisable)) {
          return c.json(
            {
              error:
                "No se puede deshabilitar un usuario con rol Runly Admin o System Admin.",
            },
            400,
          );
        }
      }

      if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
      if (typeof body.firstName === "string")
        patch.firstName = body.firstName.trim();
      if (typeof body.lastName === "string")
        patch.lastName = body.lastName.trim();
      // Extended personal fields
      if (typeof body.phone === "string")
        patch.phone = body.phone.trim() || null;
      if (body.phone === null) patch.phone = null;
      if (typeof body.bio === "string") patch.bio = body.bio.trim() || null;
      if (body.bio === null) patch.bio = null;
      if (typeof body.gender === "string")
        patch.gender = body.gender.trim() || null;
      if (body.gender === null) patch.gender = null;
      if (typeof body.birthDate === "string") {
        const d = body.birthDate ? new Date(body.birthDate) : null;
        patch.birthDate = d && !Number.isNaN(d.getTime()) ? d : null;
      }
      if (body.birthDate === null) patch.birthDate = null;

      // Address fields
      if (typeof body.country === "string")
        patch.country = body.country.trim() || null;
      if (body.country === null) patch.country = null;
      if (typeof body.state === "string")
        patch.state = body.state.trim() || null;
      if (body.state === null) patch.state = null;
      if (typeof body.city === "string") patch.city = body.city.trim() || null;
      if (body.city === null) patch.city = null;
      if (typeof body.colony === "string")
        patch.colony = body.colony.trim() || null;
      if (body.colony === null) patch.colony = null;
      if (typeof body.street === "string")
        patch.street = body.street.trim() || null;
      if (body.street === null) patch.street = null;
      if (typeof body.extNumber === "string")
        patch.extNumber = body.extNumber.trim() || null;
      if (body.extNumber === null) patch.extNumber = null;
      if (typeof body.intNumber === "string")
        patch.intNumber = body.intNumber.trim() || null;
      if (body.intNumber === null) patch.intNumber = null;
      if (typeof body.postalCode === "string")
        patch.postalCode = body.postalCode.trim() || null;
      if (body.postalCode === null) patch.postalCode = null;

      const user = await prisma.userProfile.update({
        where: { id },
        data: patch,
      });

      if (patch.firstName !== undefined || patch.lastName !== undefined) {
        const newDisplay =
          `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
        if (newDisplay !== user.displayName) {
          await prisma.userProfile.update({
            where: { id },
            data: { displayName: newDisplay },
          });
          user.displayName = newDisplay;
        }
      }

      // Email update — requires both DB and Supabase auth update
      if (typeof body.email === "string" && body.email.trim()) {
        const newEmail = body.email.trim().toLowerCase();
        const { error: authEmailError } =
          await supabaseAdmin.auth.admin.updateUserById(user.authUserId, {
            email: newEmail,
          });
        if (authEmailError) {
          return c.json(
            { error: "No se pudo actualizar el correo del usuario." },
            500,
          );
        }
        try {
          await prisma.userProfile.update({
            where: { id },
            data: { email: newEmail },
          });
          user.email = newEmail;
        } catch {
          await supabaseAdmin.auth.admin.updateUserById(user.authUserId, {
            email: user.email,
          });
          return c.json(
            { error: "No se pudo sincronizar el correo. Intenta de nuevo." },
            500,
          );
        }
      }

      // Membership / role update.
      // Two guards a caller holding only identity.users.update (not
      // identity.roles.*) must not be able to bypass:
      //  1. membershipId must actually belong to the user in the URL — this
      //     previously trusted the client-supplied id pair as-is, so any
      //     membershipId (e.g. the caller's own) could be reassigned here.
      //  2. the target role must not be a protected admin role — without
      //     this, identity.users.update alone was a full privilege-escalation
      //     path to Atlas Admin / System Admin, bypassing identity.roles.*
      //     entirely.
      if (body.membershipId && body.roleId) {
        const membership = await prisma.membership.findUnique({
          where: { id: body.membershipId },
          select: { userId: true },
        });
        if (!membership || membership.userId !== id) {
          return c.json(
            { error: "La membresia no corresponde a este usuario." },
            400,
          );
        }
        const targetRole = await prisma.role.findUnique({
          where: { id: body.roleId },
          select: { key: true },
        });
        const targetIsProtectedRole =
          targetRole &&
          PROTECTED_IDENTITY_ROLE_KEYS.has(String(targetRole.key ?? "").trim().toLowerCase());
        if (targetIsProtectedRole) {
          const context = c.get("userContext");
          const canManageRoles =
            context?.isAdmin || context?.permissionSet?.has("identity.roles.update");
          if (!canManageRoles) {
            return c.json(
              {
                error:
                  "Asignar el rol Runly Admin o System Admin requiere permisos de gestion de roles.",
              },
              403,
            );
          }
        }
        await prisma.membership.update({
          where: { id: body.membershipId },
          data: { roleId: body.roleId },
        });
      }

      // Bust user context cache so the next GET /user/me reflects changes
      cacheDel(`user_ctx:${user.authUserId}`);

      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.user.update",
        severity: "info",
        entityType: "UserProfile",
        entityId: id,
        summary: `${actorName} actualizó al usuario ${user.email ?? id}`,
      });

      return c.json({ data: user });
    } catch {
      return c.json({ error: "No se pudo actualizar el usuario." }, 500);
    }
  },
);

// ── Per-user permission grants (ALLOW-only, additive) ─────────────────────────
// Effective permissions = role permissions ∪ these grants. Never subtracts.
// Spec: docs/superpowers/specs/2026-09-08-per-user-permission-grants.md
function canManageUserGrants(context) {
  if (!context) return false;
  if (context.isAdmin) return true;
  return Boolean(
    context.permissionSet?.has("identity.permissions.update") &&
    context.permissionSet?.has("identity.users.update"),
  );
}

// Resolves the target user's membership in ONE specific company (the actor's
// server-resolved active company — never derived from the target's own "most
// admin-like" membership, which could be a DIFFERENT company than the one the
// actor is currently acting in) and the set of permission keys the target
// already inherits from their role in that company.
async function loadUserGrantContext(userId, companyId) {
  const target = await prisma.userProfile.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { enabled: true, companyId },
        include: {
          role: {
            include: {
              permissions: {
                where: { permission: { active: true } },
                include: { permission: { select: { key: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!target) return null;
  const activeMs = target.memberships.filter((m) => m.role?.enabled);
  const roleKeys = new Set();
  for (const m of activeMs) {
    for (const rp of m.role?.permissions ?? []) {
      if (rp.permission?.key) roleKeys.add(rp.permission.key);
    }
  }
  return { target, companyId, roleKeys };
}

app.get("/identity/users/:id/permission-grants", authMiddleware, async (c) => {
  try {
    const context = await getOrLoadUserContext(c);
    const resolved = await resolveTenantContext(c, context, { strict: true });
    if (!resolved.ok) return resolved.response;
    const { tenant } = resolved;
    if (!canManageUserGrants(tenant)) {
      return c.json({ error: "No autorizado." }, 403);
    }
    const id = c.req.param("id");
    if (!(await assertUserInCompany(id, tenant.companyId))) {
      return c.json({ error: "Usuario no encontrado." }, 404);
    }
    const grantCtx = await loadUserGrantContext(id, tenant.companyId);
    if (!grantCtx) return c.json({ error: "Usuario no encontrado." }, 404);

    const grants = await prisma.userPermissionGrant.findMany({
      where: { userId: id, companyId: tenant.companyId },
      include: { permission: { select: { key: true, active: true } } },
    });
    const grantedKeys = grants
      .map((g) => g.permission?.key)
      .filter(Boolean)
      .sort();

    return c.json({
      data: { grantedKeys, roleKeys: [...grantCtx.roleKeys].sort() },
    });
  } catch (err) {
    console.error("[identity] get permission-grants", err?.message ?? err);
    return c.json({ error: "No se pudieron cargar los permisos." }, 500);
  }
});

app.put("/identity/users/:id/permission-grants", authMiddleware, async (c) => {
  try {
    const context = await getOrLoadUserContext(c);
    const resolved = await resolveTenantContext(c, context, { strict: true });
    if (!resolved.ok) return resolved.response;
    const { tenant } = resolved;
    if (!canManageUserGrants(tenant)) {
      return c.json({ error: "No autorizado." }, 403);
    }
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const requested = Array.isArray(body?.permissionKeys)
      ? [...new Set(body.permissionKeys.filter((k) => typeof k === "string" && k))]
      : null;
    if (!requested) {
      return c.json({ error: "permissionKeys debe ser un arreglo." }, 422);
    }

    if (!(await assertUserInCompany(id, tenant.companyId))) {
      return c.json({ error: "Usuario no encontrado." }, 404);
    }
    const grantCtx = await loadUserGrantContext(id, tenant.companyId);
    if (!grantCtx) return c.json({ error: "Usuario no encontrado." }, 404);

    // Only active permissions can be granted.
    const activePerms = await prisma.permission.findMany({
      where: { key: { in: requested }, active: true },
      select: { id: true, key: true },
    });
    const targetKeys = filterGrantableKeys({
      requestedKeys: requested,
      activeKeys: activePerms.map((p) => p.key),
      roleKeys: grantCtx.roleKeys,
    });

    // Privilege-escalation guard: a non-admin manager can only hand out
    // permissions they themselves already hold IN THIS SAME ACTIVE COMPANY.
    // Admins are unrestricted.
    const escalating = findEscalatingKeys({
      targetKeys,
      actorHeldKeys: tenant.permissionSet ?? new Set(),
      actorIsAdmin: tenant.isAdmin,
    });
    if (escalating.length) {
      return c.json(
        {
          error:
            "Solo puedes conceder permisos que tu propia cuenta ya tiene: " +
            escalating.join(", "),
        },
        403,
      );
    }

    const permByKey = new Map(activePerms.map((p) => [p.key, p.id]));
    const existing = await prisma.userPermissionGrant.findMany({
      where: { userId: id, companyId: grantCtx.companyId },
      include: { permission: { select: { key: true } } },
    });
    const existingKeys = existing.map((g) => g.permission?.key).filter(Boolean);
    const nextKeys = new Set(targetKeys);
    const { added, removed } = diffGrantKeys({ existingKeys, nextKeys });

    if (added.length || removed.length) {
      await prisma.$transaction([
        prisma.userPermissionGrant.deleteMany({
          where: { userId: id, companyId: grantCtx.companyId },
        }),
        prisma.userPermissionGrant.createMany({
          data: targetKeys.map((k) => ({
            userId: id,
            companyId: grantCtx.companyId,
            permissionId: permByKey.get(k),
            grantedById: context.profile?.id ?? null,
          })),
          skipDuplicates: true,
        }),
      ]);

      // Take effect immediately rather than after the user-context TTL.
      cacheDel(`user_ctx:${grantCtx.target.authUserId}`);

      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "identity.user.permission_grants.update",
        severity: "warning",
        entityType: "UserProfile",
        entityId: id,
        summary:
          `${actorName} actualizó los permisos individuales de ${grantCtx.target.email ?? id}` +
          (added.length ? ` (+${added.join(", ")})` : "") +
          (removed.length ? ` (-${removed.join(", ")})` : ""),
      });
    }

    return c.json({ data: { grantedKeys: [...nextKeys].sort() } });
  } catch (err) {
    console.error("[identity] put permission-grants", err?.message ?? err);
    return c.json({ error: "No se pudieron guardar los permisos." }, 500);
  }
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
//    `meridian.use("/chat/meridian/*", ...)`, etc. Regression on 2026-09-08 (MeridIAn
//    guard mounted at root, commit 59a439a6); see meridian-mount-scope.test.js.
app.route("/", createChatRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission, notificationService, broadcaster, resolveUserContext: getUserContextByAuthId, officeService }));
const callsSmtpService = createSmtpService({ prisma });
app.route("/", createCallsRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission, notificationService, broadcaster, deliveryWorker: notificationDeliveryWorker, smtpService: callsSmtpService }));
app.route("/", createNotesRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission, broadcaster, notificationService }));

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
async function serveRunlySdk(c) {
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { dirname, join } = await import('node:path')
  const __dir   = dirname(fileURLToPath(import.meta.url))
  const sdkPath = join(__dir, 'public', 'runly-sdk.js')
  try {
    const code = await readFile(sdkPath, 'utf8')
    c.header('Content-Type', 'application/javascript; charset=utf-8')
    c.header('Cache-Control', 'public, max-age=3600')
    return c.text(code)
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

app.get(
  "/contacts",
  authMiddleware,
  requirePermission("contacts.contacts.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const search = c.req.query("search") ?? c.req.query("q") ?? "";
      const page = c.req.query("page") ?? "1";
      const pageSize = c.req.query("pageSize") ?? c.req.query("limit") ?? "20";
      const sortBy = c.req.query("sortBy") ?? "";
      const sortDir = c.req.query("sortDir") ?? "asc";
      const enabledRaw = c.req.query("enabled");
      const enabled = enabledRaw === "false" ? false : true;
      const result = await contactsService.list({
        authUserId,
        companyId: c.get("companyId"),
        search,
        page,
        pageSize,
        sortBy,
        sortDir,
        enabled,
      });
      return c.json({
        data: result.rows,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
        },
      });
    } catch (err) {
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudieron cargar los contactos." }, 500);
    }
  },
);

app.get(
  "/contacts/picker",
  authMiddleware,
  requirePermission("contacts.contacts.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const query = c.req.query("q") ?? "";
      const limit = c.req.query("limit");
      const options = await contactsService.picker({
        authUserId,
        companyId: c.get("companyId"),
        query,
        limit,
      });
      return c.json({ data: options });
    } catch (err) {
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json(
        { error: "No se pudieron cargar opciones de contacto." },
        500,
      );
    }
  },
);

app.post(
  "/contacts",
  authMiddleware,
  requirePermission("contacts.contacts.create"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const payload = await c.req.json();
      const contact = await contactsService.create({ authUserId, companyId: c.get("companyId"), payload });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "contacts.contact.create",
        severity: "success",
        entityType: "Contact",
        entityId: contact.id,
        summary: `${actorName} creó el contacto "${contact.name ?? ""}"`.trim(),
      });
      return c.json({ data: contact }, 201);
    } catch (err) {
      if (err?.name === "ZodError") {
        return c.json(
          { error: err.errors?.[0]?.message ?? "Datos de contacto invalidos." },
          400,
        );
      }
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo crear el contacto." }, 500);
    }
  },
);

app.patch(
  "/contacts/bulk/enabled",
  authMiddleware,
  requirePermission("contacts.contacts.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const { ids, enabled } = await c.req.json();
      await contactsService.bulkSetEnabled({ authUserId, companyId: c.get("companyId"), ids, enabled });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: enabled
          ? "contacts.contact.bulk_enable"
          : "contacts.contact.bulk_disable",
        severity: enabled ? "info" : "warning",
        entityType: "Contact",
        summary: `${actorName} ${enabled ? "habilitó" : "deshabilitó"} ${Array.isArray(ids) ? ids.length : 0} contacto(s)`,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json(
        { error: "No se pudo actualizar el estado de los contactos." },
        500,
      );
    }
  },
);

app.delete(
  "/contacts/bulk",
  authMiddleware,
  requirePermission("contacts.contacts.delete"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const { ids } = await c.req.json();
      await contactsService.bulkDelete({ authUserId, companyId: c.get("companyId"), ids });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "contacts.contact.bulk_delete",
        severity: "warning",
        entityType: "Contact",
        summary: `${actorName} eliminó ${Array.isArray(ids) ? ids.length : 0} contacto(s)`,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudieron eliminar los contactos." }, 500);
    }
  },
);

app.post(
  "/contacts/export/excel",
  authMiddleware,
  requirePermission("contacts.contacts.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const body = await c.req.json().catch(() => ({}));
      const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
      const contacts = await contactsService.getContactsForExport({
        authUserId,
        companyId: c.get("companyId"),
        ids,
      });

      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Contactos");
      sheet.columns = [
        { header: "ID", key: "id", width: 40 },
        { header: "Nombre", key: "name", width: 30 },
        { header: "Razon social", key: "legalName", width: 36 },
        { header: "Tipo", key: "type", width: 16 },
        { header: "Correo", key: "email", width: 32 },
        { header: "Telefono", key: "phone", width: 18 },
        { header: "RFC / ID fiscal", key: "taxId", width: 20 },
        { header: "Estado", key: "enabled", width: 12 },
        { header: "Creado", key: "createdAt", width: 22 },
      ];
      sheet.getRow(1).font = { bold: true };

      for (const contact of contacts) {
        sheet.addRow({
          id: contact.id,
          name: contact.name ?? "",
          legalName: contact.legalName ?? "",
          type: contact.type ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          taxId: contact.taxId ?? "",
          enabled: contact.enabled ? "Activo" : "Inactivo",
          createdAt: contact.createdAt
            ? formatLocalDateTime(contact.createdAt)
            : "",
        });
      }

      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `contactos-${toLocalIso()}.xlsx`;
      c.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      c.header("X-Atlas-Export-Count", String(contacts.length));
      return c.body(buffer);
    } catch {
      return c.json({ error: "No se pudo generar el archivo Excel." }, 500);
    }
  },
);

app.post(
  "/contacts/export/pdf",
  authMiddleware,
  requirePermission("contacts.contacts.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const body = await c.req.json().catch(() => ({}));
      const ids = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
      const contacts = await contactsService.getContactsForExport({ authUserId, companyId: c.get("companyId"), ids });
      const { resolveCompanyBranding, resolvePdfDocumentCtor, toSafeText, compact, normalizeHexColor, lightenHex, drawPdfHeader, drawPdfFooter } =
        await import("./services/pdf-branding-service.js");
      // requirePermission() already resolved and set companyId on the context —
      // querying Membership again with authUserId (the Supabase auth id, not a
      // Membership.userId, which is a userProfile.id) would always miss and
      // silently fall back to generic "Atlas ERP" branding instead of the
      // real company's logo/name (same bug class as the ledger export fix).
      const companyId = c.get("companyId");
      const branding = await resolveCompanyBranding({ prisma, companyId: companyId ?? "" });
      const PDFDocument = await resolvePdfDocumentCtor();
      if (typeof PDFDocument !== "function") {
        return c.json({ error: "PDF no disponible." }, 503);
      }

      const brandColor = normalizeHexColor(branding.primaryColor, "#0F766E");
      const brandColorLight = lightenHex(brandColor, 0.9);
      const C_DARK = "#0F172A";
      const C_MID = "#334155";
      const C_MUTED = "#64748B";
      const C_BORDER = "#E2E8F0";
      const MARGIN = 44;
      const TYPE_LABELS = { customer: "Cliente", supplier: "Proveedor", person: "Persona", company: "Empresa" };

      const doc = new PDFDocument({ margin: 0, size: "LETTER", layout: "portrait", bufferPages: true });
      const chunks = [];
      const done = new Promise((resolve, reject) => {
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
      });

      const pageWidth = doc.page.width;
      const right = pageWidth - MARGIN;
      const contentWidth = right - MARGIN;
      const date = new Date().toLocaleDateString("es-MX");

      let y = drawPdfHeader(doc, {
        branding,
        title: "Directorio de Contactos",
        subtitle: `${contacts.length} contacto${contacts.length !== 1 ? "s" : ""}`,
        folio: date,
      });

      const COL_WIDTHS = { name: 160, type: 70, email: 140, phone: 90, taxId: 90 };
      const headers = [
        { key: "name", label: "Nombre", w: COL_WIDTHS.name },
        { key: "type", label: "Tipo", w: COL_WIDTHS.type },
        { key: "email", label: "Correo", w: COL_WIDTHS.email },
        { key: "phone", label: "Telefono", w: COL_WIDTHS.phone },
        { key: "taxId", label: "RFC / ID fiscal", w: COL_WIDTHS.taxId },
      ];

      // Table header row
      const ROW_H = 18;
      const HEADER_ROW_H = 20;
      doc.rect(MARGIN, y, contentWidth, HEADER_ROW_H).fill(brandColor);
      let cx = MARGIN + 6;
      for (const h of headers) {
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF")
          .text(h.label, cx, y + 6, { width: h.w - 8, lineBreak: false });
        cx += h.w;
      }
      y += HEADER_ROW_H;

      // Table rows
      for (let i = 0; i < contacts.length; i++) {
        const ct = contacts[i];
        const rowBg = i % 2 === 0 ? "#FFFFFF" : brandColorLight;

        if (y + ROW_H > doc.page.height - 44) {
          drawPdfFooter(doc, { branding, pageNumber: doc.bufferedPageRange().count, totalPages: 0 });
          doc.addPage();
          y = drawPdfHeader(doc, { branding, title: "Directorio de Contactos", subtitle: `Continuacion`, folio: date });
          doc.rect(MARGIN, y, contentWidth, HEADER_ROW_H).fill(brandColor);
          let cx2 = MARGIN + 6;
          for (const h of headers) {
            doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF")
              .text(h.label, cx2, y + 6, { width: h.w - 8, lineBreak: false });
            cx2 += h.w;
          }
          y += HEADER_ROW_H;
        }

        doc.rect(MARGIN, y, contentWidth, ROW_H).fill(rowBg);
        doc.lineWidth(0.3).rect(MARGIN, y, contentWidth, ROW_H).stroke(C_BORDER);

        const values = [
          toSafeText(ct.name),
          TYPE_LABELS[ct.type] ?? toSafeText(ct.type),
          toSafeText(ct.email),
          toSafeText(ct.phone),
          toSafeText(ct.taxId),
        ];

        cx = MARGIN + 6;
        for (let j = 0; j < headers.length; j++) {
          const color = j === 0 ? C_DARK : C_MID;
          const weight = j === 0 ? "Helvetica-Bold" : "Helvetica";
          doc.font(weight).fontSize(7.5).fillColor(color)
            .text(values[j], cx, y + 5, { width: headers[j].w - 10, lineBreak: false, ellipsis: true });
          cx += headers[j].w;
        }
        y += ROW_H;
      }

      if (contacts.length === 0) {
        doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
          .text("No hay contactos para mostrar.", MARGIN, y + 12, { width: contentWidth, align: "center" });
      }

      const totalPages = doc.bufferedPageRange().count;
      const range = doc.bufferedPageRange();
      for (let p = range.start; p < range.start + range.count; p++) {
        doc.switchToPage(p);
        drawPdfFooter(doc, { branding, pageNumber: p - range.start + 1, totalPages });
      }

      doc.end();
      const buffer = await done;
      const filename = `contactos-${toLocalIso()}.pdf`;
      c.header("Content-Type", "application/pdf");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      c.header("X-Atlas-Export-Count", String(contacts.length));
      return c.body(buffer);
    } catch (err) {
      console.error("[contacts/export/pdf]", err);
      return c.json({ error: "No se pudo generar el PDF." }, 500);
    }
  },
);

app.get(
  "/contacts/:id",
  authMiddleware,
  requirePermission("contacts.contacts.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const contact = await contactsService.getById({ authUserId, companyId: c.get("companyId"), id });
      return c.json({ data: contact });
    } catch (err) {
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo cargar el contacto." }, 500);
    }
  },
);

app.put(
  "/contacts/:id",
  authMiddleware,
  requirePermission("contacts.contacts.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const payload = await c.req.json();
      const contact = await contactsService.update({ authUserId, companyId: c.get("companyId"), id, payload });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "contacts.contact.update",
        severity: "info",
        entityType: "Contact",
        entityId: id,
        summary:
          `${actorName} actualizó el contacto "${contact.name ?? ""}"`.trim(),
      });
      return c.json({ data: contact });
    } catch (err) {
      if (err?.name === "ZodError") {
        return c.json(
          { error: err.errors?.[0]?.message ?? "Datos de contacto invalidos." },
          400,
        );
      }
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo actualizar el contacto." }, 500);
    }
  },
);

app.patch(
  "/contacts/:id/enabled",
  authMiddleware,
  requirePermission("contacts.contacts.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const { enabled } = await c.req.json();
      const contact = await contactsService.setEnabled({
        authUserId,
        companyId: c.get("companyId"),
        id,
        enabled,
      });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: contact.enabled
          ? "contacts.contact.enable"
          : "contacts.contact.disable",
        severity: contact.enabled ? "info" : "warning",
        entityType: "Contact",
        entityId: id,
        summary:
          `${actorName} ${contact.enabled ? "habilitó" : "deshabilitó"} el contacto "${contact.name ?? ""}"`.trim(),
      });
      return c.json({ data: contact });
    } catch (err) {
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json(
        { error: "No se pudo actualizar el estado del contacto." },
        500,
      );
    }
  },
);

app.delete(
  "/contacts/:id",
  authMiddleware,
  requirePermission("contacts.contacts.delete"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      await contactsService.delete({ authUserId, companyId: c.get("companyId"), id });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "contacts.contact.delete",
        severity: "warning",
        entityType: "Contact",
        entityId: id,
        summary: `${actorName} eliminó un contacto`,
      });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof ContactsServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo eliminar el contacto." }, 500);
    }
  },
);

app.get(
  "/hr/employees/export",
  authMiddleware,
  requirePermission("hr.employee.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const idsParam = c.req.query("ids");
      const ids = idsParam
        ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
        : null;
      const rows = await hrService.listEmployeesForExport({
        authUserId,
        companyId: c.get("companyId"),
        ids,
      });
      const buffer = await buildEmployeesExcelBuffer({ rows });
      c.header(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      c.header(
        "Content-Disposition",
        `attachment; filename="colaboradores-${toLocalIso()}.xlsx"`,
      );
      return new Response(buffer, { status: 200, headers: c.res.headers });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo exportar los colaboradores." }, 500);
    }
  },
);

app.get(
  "/hr/employees/export/pdf",
  authMiddleware,
  requirePermission("hr.employee.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const idsParam = c.req.query("ids");
      const ids = idsParam
        ? idsParam.split(",").map((s) => s.trim()).filter(Boolean)
        : null;
      const rows = await hrService.listEmployeesForExport({
        authUserId,
        companyId: c.get("companyId"),
        ids,
      });
      const {
        resolveCompanyBranding, resolvePdfDocumentCtor,
        toSafeText, compact, normalizeHexColor, lightenHex,
        drawPdfHeader, drawPdfFooter,
      } = await import("./services/pdf-branding-service.js");
      // requirePermission() already resolved and set companyId on the context —
      // querying Membership again with authUserId (the Supabase auth id, not a
      // Membership.userId, which is a userProfile.id) would always miss and
      // silently fall back to generic "Atlas ERP" branding instead of the
      // real company's logo/name (same bug class as the ledger export fix).
      const companyId = c.get("companyId");
      const branding = await resolveCompanyBranding({ prisma, companyId: companyId ?? "" });
      const PDFDocument = await resolvePdfDocumentCtor();
      if (typeof PDFDocument !== "function") {
        return c.json({ error: "PDF no disponible." }, 503);
      }

      const brandColor = normalizeHexColor(branding.primaryColor, "#0F766E");
      const brandLight = lightenHex(brandColor, 0.9);
      const C_DARK = "#0F172A";
      const C_MID = "#334155";
      const C_MUTED = "#64748B";
      const C_BORDER = "#E2E8F0";
      const MARGIN = 44;

      const STATUS_LABELS = { active: "Activo", vacation: "Vacaciones", inactive: "Inactivo", terminated: "Baja" };
      const TYPE_LABELS = { full_time: "T. completo", part_time: "Medio tiempo", contractor: "Contratista", intern: "Practicante" };

      const doc = new PDFDocument({ margin: 0, size: "LETTER", layout: "portrait", bufferPages: true });
      const chunks = [];
      const done = new Promise((resolve, reject) => {
        doc.on("data", (chunk) => chunks.push(chunk));
        doc.on("end", () => resolve(Buffer.concat(chunks)));
        doc.on("error", reject);
      });

      const pageWidth = doc.page.width;
      const right = pageWidth - MARGIN;
      const contentWidth = right - MARGIN;
      const date = new Date().toLocaleDateString("es-MX");

      let y = drawPdfHeader(doc, {
        branding,
        title: "Directorio de Colaboradores",
        subtitle: `${rows.length} colaborador${rows.length !== 1 ? "es" : ""}`,
        folio: date,
      });

      const COL = { name: 150, code: 65, title: 110, dept: 100, status: 60, type: 75 };
      const headers = [
        { key: "full_name", label: "Nombre", w: COL.name },
        { key: "employee_code", label: "Codigo", w: COL.code },
        { key: "job_title", label: "Puesto", w: COL.title },
        { key: "department", label: "Depto.", w: COL.dept },
        { key: "status", label: "Estado", w: COL.status },
        { key: "employment_type", label: "Tipo", w: COL.type },
      ];

      const HEADER_ROW_H = 20;
      const ROW_H = 18;

      function drawTableHeader(doc, y) {
        doc.rect(MARGIN, y, contentWidth, HEADER_ROW_H).fill(brandColor);
        let cx = MARGIN + 6;
        for (const h of headers) {
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF")
            .text(h.label, cx, y + 6, { width: h.w - 8, lineBreak: false });
          cx += h.w;
        }
        return y + HEADER_ROW_H;
      }

      y = drawTableHeader(doc, y);

      for (let i = 0; i < rows.length; i++) {
        const emp = rows[i];
        if (y + ROW_H > doc.page.height - 44) {
          drawPdfFooter(doc, { branding, pageNumber: doc.bufferedPageRange().count, totalPages: 0 });
          doc.addPage();
          y = drawPdfHeader(doc, { branding, title: "Directorio de Colaboradores", subtitle: "Continuacion", folio: date });
          y = drawTableHeader(doc, y);
        }
        const rowBg = i % 2 === 0 ? "#FFFFFF" : brandLight;
        doc.rect(MARGIN, y, contentWidth, ROW_H).fill(rowBg);
        doc.lineWidth(0.3).rect(MARGIN, y, contentWidth, ROW_H).stroke(C_BORDER);

        const values = [
          toSafeText(emp.full_name ?? `${emp.first_name ?? ""} ${emp.last_name ?? ""}`.trim()),
          toSafeText(emp.employee_code),
          toSafeText(emp.job_title),
          toSafeText(emp.department),
          STATUS_LABELS[emp.status] ?? toSafeText(emp.status),
          TYPE_LABELS[emp.employment_type] ?? toSafeText(emp.employment_type),
        ];

        let cx = MARGIN + 6;
        for (let j = 0; j < headers.length; j++) {
          const color = j === 0 ? C_DARK : j === 4 ? brandColor : C_MID;
          const weight = j === 0 ? "Helvetica-Bold" : "Helvetica";
          doc.font(weight).fontSize(7.5).fillColor(color)
            .text(values[j], cx, y + 5, { width: headers[j].w - 10, lineBreak: false, ellipsis: true });
          cx += headers[j].w;
        }
        y += ROW_H;
      }

      if (rows.length === 0) {
        doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
          .text("No hay colaboradores para mostrar.", MARGIN, y + 12, { width: contentWidth, align: "center" });
      }

      const range = doc.bufferedPageRange();
      for (let p = range.start; p < range.start + range.count; p++) {
        doc.switchToPage(p);
        drawPdfFooter(doc, { branding, pageNumber: p - range.start + 1, totalPages: range.count });
      }

      doc.end();
      const buffer = await done;
      const filename = `colaboradores-${toLocalIso()}.pdf`;
      c.header("Content-Type", "application/pdf");
      c.header("Content-Disposition", `attachment; filename="${filename}"`);
      c.header("X-Atlas-Export-Count", String(rows.length));
      return new Response(buffer, { status: 200, headers: c.res.headers });
    } catch (err) {
      console.error("[hr/employees/export/pdf]", err);
      if (err instanceof HrServiceError) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo generar el PDF." }, 500);
    }
  },
);

app.get(
  "/hr/employees",
  authMiddleware,
  requirePermission("hr.employee.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const search = c.req.query("search") ?? c.req.query("q") ?? "";
      const status = c.req.query("status");
      const enabledRaw = c.req.query("enabled");
      const enabled =
        enabledRaw === undefined ? undefined : enabledRaw === "true";
      const limit = c.req.query("limit");
      const page = c.req.query("page");
      const pageSize = c.req.query("pageSize");
      const sortBy = c.req.query("sortBy");
      const sortDir = c.req.query("sortDir") === "desc" ? "desc" : "asc";

      const result = await hrService.listEmployees({
        authUserId,
        companyId: c.get("companyId"),
        search,
        status,
        enabled,
        limit,
        page,
        pageSize,
        sortBy,
        sortDir,
      });

      if (page !== undefined || pageSize !== undefined) {
        const take = Math.min(Math.max(1, Number(pageSize) || 20), 200);
        const currentPage = Math.max(1, Number(page) || 1);
        return c.json({
          data: result.rows,
          pagination: {
            page: currentPage,
            pageSize: take,
            total: result.total,
          },
        });
      }
      return c.json({ data: result });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      console.error("[GET /hr/employees]", err);
      return c.json({ error: "No se pudieron cargar colaboradores." }, 500);
    }
  },
);

app.get(
  "/hr/employees/:id",
  authMiddleware,
  requirePermission("hr.employee.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const row = await hrService.getEmployee({ authUserId, companyId: c.get("companyId"), id });
      return c.json({ data: row });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo cargar el colaborador." }, 500);
    }
  },
);

app.post(
  "/hr/employees",
  authMiddleware,
  requirePermission("hr.employee.create"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const parsed = hrEmployeeCreateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json(
          { error: parsed.error.errors?.[0]?.message ?? "Datos invalidos." },
          400,
        );
      }
      const row = await hrService.createEmployee({
        authUserId,
        companyId: c.get("companyId"),
        payload: parsed.data,
      });
      return c.json({ data: row }, 201);
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo crear el colaborador." }, 500);
    }
  },
);

app.put(
  "/hr/employees/:id",
  authMiddleware,
  requirePermission("hr.employee.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const parsed = hrEmployeeUpdateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json(
          { error: parsed.error.errors?.[0]?.message ?? "Datos invalidos." },
          400,
        );
      }
      const row = await hrService.updateEmployee({
        authUserId,
        companyId: c.get("companyId"),
        id,
        payload: parsed.data,
      });
      return c.json({ data: row });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo actualizar el colaborador." }, 500);
    }
  },
);

app.patch(
  "/hr/employees/:id/enabled",
  authMiddleware,
  requirePermission("hr.employee.delete"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const parsed = hrEmployeeEnabledSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "Estado invalido." }, 400);
      }
      const row = await hrService.setEmployeeEnabled({
        authUserId,
        companyId: c.get("companyId"),
        id,
        enabled: parsed.data.enabled,
      });
      return c.json({ data: row });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo actualizar el estado." }, 500);
    }
  },
);

app.get(
  "/hr/employees/:id/audit",
  authMiddleware,
  requirePermission("hr.employee.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const limit = c.req.query("limit");
      const rows = await hrService.getEmployeeAudit({
        authUserId,
        companyId: c.get("companyId"),
        id,
        limit,
      });
      return c.json({ data: rows });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo cargar el historial." }, 500);
    }
  },
);

app.get(
  "/hr/departments",
  authMiddleware,
  requirePermission("hr.department.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const q = c.req.query("q") ?? "";
      const enabledRaw = c.req.query("enabled");
      const enabled =
        enabledRaw === undefined ? undefined : enabledRaw === "true";
      const limit = c.req.query("limit");
      const rows = await hrService.listDepartments({
        authUserId,
        companyId: c.get("companyId"),
        search: q,
        enabled,
        limit,
      });
      return c.json({ data: rows });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudieron cargar los departamentos." }, 500);
    }
  },
);

app.post(
  "/hr/departments",
  authMiddleware,
  requirePermission("hr.department.create"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const parsed = hrCatalogCreateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json(
          { error: parsed.error.errors?.[0]?.message ?? "Datos inválidos." },
          400,
        );
      }
      const row = await hrService.createDepartment({
        authUserId,
        companyId: c.get("companyId"),
        payload: parsed.data,
      });
      return c.json({ data: row }, 201);
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo crear el departamento." }, 500);
    }
  },
);

app.put(
  "/hr/departments/:id",
  authMiddleware,
  requirePermission("hr.department.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const parsed = hrCatalogUpdateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json(
          { error: parsed.error.errors?.[0]?.message ?? "Datos inválidos." },
          400,
        );
      }
      const row = await hrService.updateDepartment({
        authUserId,
        companyId: c.get("companyId"),
        id,
        payload: parsed.data,
      });
      return c.json({ data: row });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo actualizar el departamento." }, 500);
    }
  },
);

app.patch(
  "/hr/departments/:id/enabled",
  authMiddleware,
  requirePermission("hr.department.delete"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const parsed = hrCatalogEnabledSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "Estado inválido." }, 400);
      }
      const row = await hrService.setDepartmentEnabled({
        authUserId,
        companyId: c.get("companyId"),
        id,
        enabled: parsed.data.enabled,
      });
      return c.json({ data: row });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json(
        { error: "No se pudo actualizar el estado del departamento." },
        500,
      );
    }
  },
);

app.get(
  "/hr/job-titles",
  authMiddleware,
  requirePermission("hr.job_title.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const q = c.req.query("q") ?? "";
      const enabledRaw = c.req.query("enabled");
      const enabled =
        enabledRaw === undefined ? undefined : enabledRaw === "true";
      const limit = c.req.query("limit");
      const rows = await hrService.listJobTitles({
        authUserId,
        companyId: c.get("companyId"),
        search: q,
        enabled,
        limit,
      });
      return c.json({ data: rows });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudieron cargar los puestos." }, 500);
    }
  },
);

app.post(
  "/hr/job-titles",
  authMiddleware,
  requirePermission("hr.job_title.create"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const parsed = hrCatalogCreateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json(
          { error: parsed.error.errors?.[0]?.message ?? "Datos inválidos." },
          400,
        );
      }
      const row = await hrService.createJobTitle({
        authUserId,
        companyId: c.get("companyId"),
        payload: parsed.data,
      });
      return c.json({ data: row }, 201);
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo crear el puesto." }, 500);
    }
  },
);

app.put(
  "/hr/job-titles/:id",
  authMiddleware,
  requirePermission("hr.job_title.update"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const parsed = hrCatalogUpdateSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json(
          { error: parsed.error.errors?.[0]?.message ?? "Datos inválidos." },
          400,
        );
      }
      const row = await hrService.updateJobTitle({
        authUserId,
        companyId: c.get("companyId"),
        id,
        payload: parsed.data,
      });
      return c.json({ data: row });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo actualizar el puesto." }, 500);
    }
  },
);

app.patch(
  "/hr/job-titles/:id/enabled",
  authMiddleware,
  requirePermission("hr.job_title.delete"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const id = c.req.param("id");
      const parsed = hrCatalogEnabledSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "Estado inválido." }, 400);
      }
      const row = await hrService.setJobTitleEnabled({
        authUserId,
        companyId: c.get("companyId"),
        id,
        enabled: parsed.data.enabled,
      });
      return c.json({ data: row });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json(
        { error: "No se pudo actualizar el estado del puesto." },
        500,
      );
    }
  },
);

app.get(
  "/hr/org-chart",
  authMiddleware,
  requirePermission("hr.org_chart.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const rootEmployeeId = c.req.query("rootEmployeeId") ?? null;
      const enabledRaw = c.req.query("enabled");
      const enabled = enabledRaw === undefined ? true : enabledRaw === "true";
      const chart = await hrService.getOrgChart({
        authUserId,
        companyId: c.get("companyId"),
        rootEmployeeId,
        enabled,
      });

      // Batch-collect all avatarFileIds from the tree, load in one query, then assign.
      function collectNodes(node, out = []) {
        out.push(node);
        if (Array.isArray(node.children))
          node.children.forEach((c) => collectNodes(c, out));
        return out;
      }
      const allNodes = (chart.roots ?? []).flatMap((r) => collectNodes(r));
      const orgAvatarFileIds = allNodes
        .map((n) => n.linkedUser?.avatarFileId)
        .filter(Boolean);
      const orgAvatarUrlMap = await buildAvatarUrlMapByFileIds(
        orgAvatarFileIds,
        "card",
      );
      for (const node of allNodes) {
        if (node.linkedUser?.avatarFileId) {
          node.linkedUser.avatarUrl =
            orgAvatarUrlMap.get(node.linkedUser.avatarFileId) ?? null;
        }
      }

      // Batch-load profileImageFileId signed URLs — avoids N per-node frontend requests.
      const orgProfileFileIds = allNodes
        .map((n) => n.profileImageFileId)
        .filter(Boolean);
      const orgProfileUrlMap = await buildAvatarUrlMapByFileIds(
        orgProfileFileIds,
        "card",
      );
      for (const node of allNodes) {
        if (node.profileImageFileId) {
          node.profileImageUrl =
            orgProfileUrlMap.get(node.profileImageFileId) ?? null;
        }
      }

      return c.json({ data: chart });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json({ error: "No se pudo cargar el organigrama." }, 500);
    }
  },
);

app.get(
  "/hr/user-options",
  authMiddleware,
  requirePermission("hr.employee.read"),
  async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const q = c.req.query("q") ?? "";
      const limit = c.req.query("limit");
      const rows = await hrService.listUserOptions({
        authUserId,
        companyId: c.get("companyId"),
        search: q,
        limit,
      });
      return c.json({ data: rows });
    } catch (err) {
      if (err instanceof HrServiceError) {
        return c.json({ error: err.message }, err.status);
      }
      return c.json(
        { error: "No se pudieron cargar las cuentas disponibles." },
        500,
      );
    }
  },
);

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

mountWithAuth(app, createSettingsRouter({ prisma, requirePermission }));
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
