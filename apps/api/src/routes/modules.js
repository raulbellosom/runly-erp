import { Hono } from "hono";
import { resolvePersistedModuleKey } from '../services/module-key-alias.js';
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  moduleInstallSchema,
  moduleDryRunSchema,
  moduleClearErrorSchema,
  moduleCleanupDryRunSchema,
  moduleCleanupSchema,
  moduleUninstallSchema,
  moduleResetSchema,
} from "@runly/validators";
import {
  getPermissionPresentation,
  groupPermissionsForUi,
} from "../permission-catalog.js";
import {
  createModuleLifecycleService,
  ModuleLifecycleError,
} from "../services/module-lifecycle-service.js";
import {
  publishActivityFromContext,
  getActivityContext,
} from "../services/activity-publisher.js";
import { createModuleMetadataService } from "../services/module-metadata-service.js";
import { createModuleMigrationService } from "../services/module-migration-service.js";
import {
  discoverModules,
  getDiscoveryRootInfo,
  loadModuleManifest,
  loadModuleModels,
  loadModuleViews,
} from "../services/module-discovery-service.js";
import { listOfficialFallbackManifests, isOfficialCoreModuleKey } from "../services/module-manifests-service.js";
import {
  detectRequiredDependencyCycle,
  formatDependencyCycle,
  loadManifestDependencies,
} from "../services/module-dependency-utils.js";
import { validateDashboardSchema, validateKanbanSchema, validateManifest } from "@runly/module-engine";
import { del as cacheDel } from "../lib/cache.js";
import {
  resolveModulesDir,
} from "../services/module-upload-service.js";
import { createModulePackagePurgeService } from "../services/module-package-purge-service.js";
import { createModulePackageStagingService } from "../services/module-package-staging-service.js";
import { createModulePackageService, PREVIEW_TTL_MS, previewBundlePath } from "../services/module-package-service.js";
import { createModuleSchemaMigrationService } from "../services/module-schema-migration-service.js";
import { createModuleDashboardQueryService } from "../services/module-dashboard-query-service.js";
import { createModuleKanbanQueryService } from "../services/module-kanban-query-service.js";
import { registerRecordsViewRoutes } from "./module-records-view-routes.js";
import { createBuilderPackageSync } from "../services/module-builder-package-sync.js";
import { computeSourceHash } from "../services/module-bundler-service.js";
import { createModuleCssCache } from "../services/module-css-service.js";
import { createConnectionLifecycle } from "../services/connections/connection-lifecycle.js";

const __routesDir = path.dirname(fileURLToPath(import.meta.url));
const BUNDLES_DIR_SERVE = path.resolve(__routesDir, "..", "..", "bundles");
const SEMVER_PATCH_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

// `version: '1.2.3'` from a module.manifest.js without importing it (Node's
// import cache would keep serving the version first loaded).
export async function readManifestVersion(manifestPath) {
  try {
    const source = await fs.readFile(manifestPath, "utf8");
    return /\bversion\s*:\s*["'`]([^"'`\s]+)["'`]/.exec(source)?.[1] ?? null;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isCustomModuleRecord(record) {
  const source = typeof record?.source === "string" ? record.source.trim() : "";
  const key = typeof record?.key === "string" ? record.key.trim() : "";
  return source === "custom" || key.startsWith("custom.");
}

function defaultUninstallModeForKey(key) {
  return typeof key === "string" && key.trim().startsWith("custom.")
    ? "purge-owned-tables"
    : "preserve-data";
}

function computeMigrationSignature(manifest) {
  const migrations = Array.isArray(manifest?.migrations)
    ? manifest.migrations
    : [];
  const normalized = migrations.map((entry) => ({
    path: typeof entry?.path === "string" ? entry.path.trim() : "",
    checksum:
      typeof entry?.checksum === "string"
        ? entry.checksum.trim().toLowerCase()
        : "",
    unsafe: entry?.unsafe === true,
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function bumpPatchVersion(version) {
  const normalized = typeof version === "string" ? version.trim() : "";
  const match = normalized.match(SEMVER_PATCH_RE);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function toManifestMigrationFilename(declaredPath) {
  const safePath = typeof declaredPath === "string" ? declaredPath.trim() : "";
  return `manifest__${safePath.replaceAll("\\", "/").replaceAll("/", "__")}`;
}

async function applyManifestChecksumUpdates({ manifestPath, updates }) {
  if (!updates.length) return { applied: false, updatedPaths: [] };

  let source = await fs.readFile(manifestPath, "utf8");
  const updatedPaths = [];
  for (const update of updates) {
    const rx = new RegExp(
      `(path:\\s*["']${escapeRegExp(update.path)}["'][\\s\\S]{0,2000}?checksum:\\s*["'])([a-fA-F0-9]{64})(["'])`,
      "m",
    );
    if (!rx.test(source)) {
      throw new Error(
        `No se pudo ubicar checksum en manifest para ${update.path}`,
      );
    }
    source = source.replace(rx, `$1${update.checksum}$3`);
    updatedPaths.push(update.path);
  }

  await fs.writeFile(manifestPath, source, "utf8");
  return { applied: true, updatedPaths };
}

async function bumpManifestVersion({ manifestPath, fromVersion, toVersion }) {
  let source = await fs.readFile(manifestPath, "utf8");
  const rx = /(\bversion\s*:\s*["'])([^"']+)(["'])/;
  if (!rx.test(source)) {
    throw new Error(`No se pudo ubicar "version" en ${manifestPath}`);
  }
  source = source.replace(rx, `$1${toVersion}$3`);
  await fs.writeFile(manifestPath, source, "utf8");
  return { fromVersion, toVersion };
}

function validateManifestAcl(manifest = {}) {
  const declaredKeys = new Set((manifest.permissions ?? []).map((p) => p.key));
  const acl = manifest.acl ?? {};

  if (manifest.navigation?.length) {
    for (const nav of manifest.navigation) {
      if (!nav?.permissionKey || !declaredKeys.has(nav.permissionKey)) {
        throw Object.assign(new Error("INVALID_MANIFEST_ACL"), {
          code: "INVALID_MANIFEST_ACL",
          detail: `El item de navegacion "${nav?.path ?? "/"}" debe declarar permissionKey valido.`,
        });
      }
    }
  }
  if (typeof acl.module === "string" && acl.module.trim()) {
    if (!declaredKeys.has(acl.module.trim())) {
      throw Object.assign(new Error("INVALID_MANIFEST_ACL"), {
        code: "INVALID_MANIFEST_ACL",
        detail: `acl.module "${acl.module}" no esta declarado en permissions.`,
      });
    }
  }
}

function serializeModule(moduleRow) {
  return {
    id: moduleRow.id,
    key: moduleRow.key,
    name: moduleRow.name,
    description: moduleRow.description,
    version: moduleRow.version,
    kind: moduleRow.kind,
    status: moduleRow.status,
    core: moduleRow.core,
    uninstallable: moduleRow.uninstallable,
    enabled: moduleRow.enabled,
    installedAt: moduleRow.installedAt,
    lifecycleConfig: moduleRow.lifecycleConfig ?? null,
    dependencies: (moduleRow.dependencies ?? []).map((dep) => ({
      key: dep.dependency?.key,
      name: dep.dependency?.name,
      status: dep.dependency?.status,
      enabled: dep.dependency?.enabled,
      optional: dep.optional,
    })),
    manifest: moduleRow.manifest,
  };
}

function generateRequestId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function classifyInstallStage(err) {
  if (err?.stage) return err.stage;
  if (err?.code === "MANIFEST_MIGRATION_CHECKSUM_MISMATCH")
    return "manifest_migration";
  if (err?.code === "AME_METADATA_SYNC_FAILED") return "metadata_sync";
  if (
    err?.name === "ModuleOrmMigrationError" ||
    err?.code === "AME_ORM_MIGRATION_FAILED" ||
    err?.code === "AME_SQL_MIGRATION_EXECUTION_FAILED"
  )
    return "orm_migration";
  if (err?.name === "ZodError") return "validation";
  if (err?.code === "INVALID_MANIFEST_ACL") return "validation";
  if (err?.code === "DEPENDENCY_NOT_FOUND") return "dependency_sync";
  if (err instanceof ModuleLifecycleError) return "install";
  return "unknown";
}

function handleLifecycleError(c, err, fallback) {
  if (err instanceof ModuleLifecycleError || err?.code === "DEPENDENCY_ALIAS_VERSION_CONFLICT") {
    return c.json({ error: err.message }, err.status);
  }
  if (err?.code === "DEPENDENCY_NOT_FOUND") {
    return c.json(
      { error: `Dependencias no encontradas: ${err.keys.join(", ")}.` },
      409,
    );
  }
  if (err?.code === "INVALID_MANIFEST_ACL") {
    return c.json(
      { error: err.detail ?? "El manifiesto ACL es invalido." },
      400,
    );
  }
  if (err?.name === "ZodError") {
    return c.json(
      { error: err.errors?.[0]?.message ?? "Datos invalidos." },
      400,
    );
  }
  console.error("[modules]", err);
  return c.json({ error: fallback }, 500);
}

function toErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error.message === "string") return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

async function resolveSyncActorId(prisma, userContext) {
  const rawId = userContext?.profile?.id;
  if (typeof rawId !== "string" || !rawId.trim()) {
    return null;
  }

  const actorId = rawId.trim();
  const profile = await prisma.userProfile.findUnique({
    where: { id: actorId },
    select: { id: true },
  });
  return profile?.id ?? null;
}

function serializeDiscoveredModule(record) {
  return {
    key: record?.key ?? null,
    source: record?.source ?? null,
    localPath: record?.localPath ?? null,
    moduleDir: record?.moduleDir ?? null,
    status: record?.status ?? "ERROR",
    error: record?.error ?? null,
    modelsCount: Array.isArray(record?.models) ? record.models.length : 0,
    viewsCount: Array.isArray(record?.views) ? record.views.length : 0,
    migrationsCount: Array.isArray(record?.migrations)
      ? record.migrations.length
      : 0,
  };
}

function mergeDiscoveryIntoManifest(record, options = {}) {
  const manifest =
    record?.manifest && typeof record.manifest === "object"
      ? record.manifest
      : null;
  if (!manifest) return null;
  const extraLifecycle = isPlainObject(options?.extraLifecycle)
    ? options.extraLifecycle
    : {};
  const existingLifecycle =
    manifest.lifecycle &&
    typeof manifest.lifecycle === "object" &&
    !Array.isArray(manifest.lifecycle)
      ? manifest.lifecycle
      : {};
  const existingDiscovery = isPlainObject(existingLifecycle.discovery)
    ? existingLifecycle.discovery
    : {};
  const existingDev = isPlainObject(existingLifecycle.dev)
    ? existingLifecycle.dev
    : {};
  const extraDev = isPlainObject(extraLifecycle.dev) ? extraLifecycle.dev : {};
  const mergedDev =
    Object.keys(existingDev).length > 0 || Object.keys(extraDev).length > 0
      ? { ...existingDev, ...extraDev }
      : undefined;
  const discovery = {
    ...existingDiscovery,
    source: record?.source ?? null,
    localPath: record?.localPath ?? null,
  };

  return {
    ...manifest,
    lifecycle: {
      ...existingLifecycle,
      ...extraLifecycle,
      ...(mergedDev ? { dev: mergedDev } : {}),
      discovery,
    },
  };
}

function buildOfficialFallbackManifests({ discoveredKeys }) {
  const fallback = [];
  const officialManifests = listOfficialFallbackManifests(discoveredKeys);

  for (const manifest of officialManifests) {
    const key = typeof manifest?.key === "string" ? manifest.key.trim() : "";
    if (!key || discoveredKeys.has(key)) continue;
    fallback.push({
      ...manifest,
      lifecycle: {
        ...(manifest?.lifecycle && typeof manifest.lifecycle === "object"
          ? manifest.lifecycle
          : {}),
        discovery: {
          source: "official_manifest_fallback",
          localPath: "apps/api/src/manifests/official",
        },
      },
    });
  }

  return fallback;
}

async function upsertDiscoveredModuleError({ prisma, record }) {
  const key =
    typeof record?.key === "string" && record.key.trim()
      ? record.key.trim()
      : null;
  if (!key) return null;

  const manifest =
    record?.manifest && typeof record.manifest === "object"
      ? record.manifest
      : {};
  const isCore = isOfficialCoreModuleKey(key);
  const name =
    typeof manifest.name === "string" && manifest.name.trim()
      ? manifest.name.trim()
      : key;
  const version =
    typeof manifest.version === "string" && manifest.version.trim()
      ? manifest.version.trim()
      : "0.0.0";

  const discoveryError = {
    discovery: {
      status: "ERROR",
      source: record.source ?? null,
      localPath: record.localPath ?? null,
      message: toErrorMessage(record.error),
      updatedAt: new Date().toISOString(),
    },
  };

  return prisma.runlyModule.upsert({
    where: { key },
    update: {
      name,
      description:
        typeof manifest.description === "string" ? manifest.description : null,
      version,
      kind: manifest.kind ?? (isCore ? "CORE" : "FEATURE"),
      core: isCore,
      uninstallable: isCore ? false : (manifest.uninstallable ?? true),
      manifest: Object.keys(manifest).length
        ? manifest
        : { key, name, version },
      lifecycleConfig: discoveryError,
    },
    create: {
      key,
      name,
      description:
        typeof manifest.description === "string" ? manifest.description : null,
      version,
      kind: manifest.kind ?? (isCore ? "CORE" : "FEATURE"),
      core: isCore,
      uninstallable: isCore ? false : (manifest.uninstallable ?? true),
      status: isCore ? "INSTALLED" : "UNINSTALLED",
      enabled: isCore,
      manifest: Object.keys(manifest).length
        ? manifest
        : { key, name, version },
      lifecycleConfig: discoveryError,
    },
  });
}

export async function syncDiscoveredModuleDependencies({
  prisma,
  moduleKey,
  dependencies = [],
}) {
  const moduleRow = await prisma.runlyModule.findUnique({
    where: { key: moduleKey },
    select: { id: true, key: true },
  });

  if (!moduleRow) {
    return {
      key: moduleKey,
      declared: 0,
      synced: 0,
      removed: 0,
      missingRequired: [],
      missingOptional: [],
      error: {
        code: "MODULE_NOT_FOUND_AFTER_SYNC",
        message: `No se encontro el modulo ${moduleKey} despues del sync lifecycle.`,
      },
    };
  }

  const { declared, resolved: resolvable, missingRequired, missingOptional } =
    await loadManifestDependencies(prisma, dependencies);
  const dependencyByKey = new Map(resolvable.map(dep => [dep.key, dep.dependencyId]));
  const requiredDependencyIds = resolvable
    .filter((dep) => !dep.optional)
    .map((dep) => dependencyByKey.get(dep.key))
    .filter(Boolean);

  if (requiredDependencyIds.length > 0) {
    const existingRequiredEdges = await prisma.moduleDependency.findMany({
      where: { optional: false },
      select: { moduleId: true, dependencyId: true },
    });
    const cycleIds = detectRequiredDependencyCycle({
      moduleId: moduleRow.id,
      requiredDependencyIds,
      existingRequiredEdges,
    });
    if (cycleIds) {
      const involvedIds = [...new Set(cycleIds)];
      const moduleRows = await prisma.runlyModule.findMany({
        where: { id: { in: involvedIds } },
        select: { id: true, key: true },
      });
      const idToKey = new Map(moduleRows.map((row) => [row.id, row.key]));
      const cyclePath = formatDependencyCycle({ cycle: cycleIds, idToKey });
      return {
        key: moduleRow.key,
        declared,
        synced: 0,
        removed: 0,
        missingRequired,
        missingOptional,
        error: {
          code: "DEPENDENCY_CYCLE_DETECTED",
          message: `Dependencia circular detectada: ${cyclePath}.`,
          cyclePath,
        },
      };
    }
  }

  const desiredDependencyIds = new Set(
    resolvable.map((dep) => dependencyByKey.get(dep.key)),
  );

  const txResult = await prisma.$transaction(async (tx) => {
    for (const dep of resolvable) {
      await tx.moduleDependency.upsert({
        where: {
          moduleId_dependencyId: {
            moduleId: moduleRow.id,
            dependencyId: dependencyByKey.get(dep.key),
          },
        },
        create: {
          moduleId: moduleRow.id,
          dependencyId: dependencyByKey.get(dep.key),
          optional: dep.optional,
          versionRange: dep.versionRange,
        },
        update: {
          optional: dep.optional,
          versionRange: dep.versionRange,
        },
      });
    }

    const currentRows = await tx.moduleDependency.findMany({
      where: { moduleId: moduleRow.id },
      select: { id: true, dependencyId: true },
    });
    const staleRowIds = currentRows
      .filter((row) => !desiredDependencyIds.has(row.dependencyId))
      .map((row) => row.id);

    if (staleRowIds.length > 0) {
      await tx.moduleDependency.deleteMany({
        where: {
          moduleId: moduleRow.id,
          id: { in: staleRowIds },
        },
      });
    }

    return {
      removed: staleRowIds.length,
      synced: resolvable.length,
    };
  });

  return {
    key: moduleRow.key,
    declared,
    synced: txResult.synced,
    removed: txResult.removed,
    missingRequired,
    missingOptional,
    error: null,
  };
}

export function createModulesRouter({
  prisma,
  authMiddleware,
  requirePermission,
  routeLoader = null,
  bundlerSvc = null,
}) {
  const app = new Hono();
  const svc = createModuleLifecycleService({ prisma });
  const moduleCss = createModuleCssCache({ computeSourceHash });
  const connectionLifecycle = createConnectionLifecycle({ prisma });

  async function safeRouteReload(moduleKey) {
    if (!routeLoader) return null;
    try {
      return await routeLoader.reloadModule(moduleKey);
    } catch (err) {
      console.error(
        `[modules] routeLoader.reloadModule(${moduleKey}) failed:`,
        err.message,
      );
      return { loaded: false, reason: "error", error: err.message };
    }
  }

  function safeRouteUnload(moduleKey) {
    if (!routeLoader) return null;
    return routeLoader.unloadModule(moduleKey);
  }

  async function safeBuildBundle(key, opts = {}) {
    if (!bundlerSvc) return null;
    try {
      return await bundlerSvc.buildModuleBundle(key, opts);
    } catch (err) {
      console.warn(`[modules] bundle build failed for ${key}:`, err.message);
      return null;
    }
  }

  async function safeDeleteBundle(key) {
    if (!bundlerSvc) return null;
    try {
      return await bundlerSvc.deleteModuleBundle(key);
    } catch (err) {
      console.warn(`[modules] bundle delete failed for ${key}:`, err.message);
      return null;
    }
  }

  const metadataSvc = createModuleMetadataService({ prisma });
  const migrationSvc = createModuleMigrationService({ prisma });
  const schemaMigrationSvc = createModuleSchemaMigrationService({ prisma });
  const dashboardQuerySvc = createModuleDashboardQueryService({ prisma });
  const kanbanQuerySvc = createModuleKanbanQueryService({ prisma });

  app.post('/:key/dashboard/query', authMiddleware, async (c) => {
    try {
      const moduleKey = c.req.param('key')
      const body = await c.req.json()
      const view = await prisma.runlyView.findFirst({
        where: { moduleKey, key: body?.viewKey, type: 'DASHBOARD', enabled: true },
        select: { key: true, schema: true },
      })
      if (!view) return c.json({ error: 'Dashboard no encontrado.' }, 404)
      const validation = validateDashboardSchema(view.schema)
      if (!validation.valid) return c.json({ error: 'Dashboard inválido.', details: validation.errors }, 422)
      const requested = Array.isArray(body?.widgets) ? new Set(body.widgets) : null
      const widgets = requested ? view.schema.widgets.filter((widget) => requested.has(widget.key)) : view.schema.widgets
      if (requested && widgets.length !== requested.size) return c.json({ error: 'Widget desconocido.' }, 422)
      const slug = moduleKey.split('.').at(-1)
      const permissions = new Set([
        ...(view.schema.permissionKey ? [view.schema.permissionKey] : []),
        ...widgets.map((widget) => widget.permissionKey ?? `${slug}.${widget.source.entity}.read`),
      ])
      for (const permission of permissions) {
        let allowed = false
        const denial = await requirePermission(permission)(c, async () => { allowed = true })
        if (!allowed) return denial
      }
      const data = await dashboardQuerySvc.executeDashboard({ moduleKey, widgets, companyId: c.get('companyId') })
      return c.json({ data })
    } catch (error) {
      if (error instanceof SyntaxError) return c.json({ error: 'JSON inválido.' }, 400)
      console.error('[modules.dashboard.query]', error?.message)
      return c.json({ error: 'No se pudo consultar el dashboard.' }, 500)
    }
  })

  registerRecordsViewRoutes(app, { prisma, authMiddleware, requirePermission })

  app.post('/:key/kanban/query', authMiddleware, async (c) => {
    try {
      const moduleKey = c.req.param('key')
      const body = await c.req.json()
      const view = await prisma.runlyView.findFirst({
        where: { moduleKey, key: body?.viewKey, type: 'KANBAN', enabled: true },
        select: { key: true, schema: true },
      })
      if (!view) return c.json({ error: 'Kanban no encontrado.' }, 404)
      const validation = validateKanbanSchema(view.schema)
      if (!validation.valid) return c.json({ error: 'Kanban inválido.', details: validation.errors }, 422)
      const slug = moduleKey.split('.').at(-1)
      const readPermissionKey = view.schema.permissionKey ?? `${slug}.${view.schema.entity}.read`
      const updatePermissionKey = `${slug}.${view.schema.entity}.update`
      let allowed = false
      const denial = await requirePermission(readPermissionKey)(c, async () => { allowed = true })
      if (!allowed) return denial
      const tenant = c.get('tenantContext')
      const board = await kanbanQuerySvc.queryBoard({ moduleKey, schema: view.schema, companyId: c.get('companyId') })
      return c.json({ data: {
        ...board,
        canUpdate: Boolean(tenant?.isAdmin || tenant?.permissionSet?.has(updatePermissionKey)),
        readPermissionKey,
        updatePermissionKey,
      } })
    } catch (error) {
      if (error instanceof SyntaxError) return c.json({ error: 'JSON inválido.' }, 400)
      console.error('[modules.kanban.query]', error?.message)
      return c.json({ error: 'No se pudo consultar el Kanban.' }, 500)
    }
  })
  const purgeSvc = bundlerSvc
    ? createModulePackagePurgeService({ prisma, bundlerSvc, routeLoader, cacheDel })
    : null;
  const stagingSvc = createModulePackageStagingService();
  const packageSvc = bundlerSvc
    ? createModulePackageService({
        prisma,
        stagingService: stagingSvc,
        bundlerSvc,
        routeLoader,
        preflightPackage: async ({ staged, moduleRow }) => {
          const dependencyResult = await loadManifestDependencies(
            prisma,
            staged.manifest.dependencies ?? [],
          );
          if (moduleRow?.id) {
            const requiredDependencyIds = dependencyResult.resolved
              .filter((dependency) => !dependency.optional)
              .map((dependency) => dependency.dependencyId);
            const existingEdges = await prisma.moduleDependency.findMany({
              where: { optional: false },
              select: { moduleId: true, dependencyId: true },
            });
            const cycle = detectRequiredDependencyCycle({
              moduleId: moduleRow.id,
              requiredDependencyIds,
              existingRequiredEdges: existingEdges,
            });
            if (cycle) {
              throw Object.assign(new Error("DEPENDENCY_CYCLE_DETECTED"), {
                code: "DEPENDENCY_CYCLE_DETECTED",
              });
            }
          }
          const schemaMigration = moduleRow?.status === "INSTALLED"
            ? await schemaMigrationSvc.planModuleSchemaMigration({
                moduleKey: staged.manifest.key,
                desiredModels: staged.models,
                moduleRow,
              })
            : {
                required: false,
                canAutoApply: true,
                safety: "SAFE",
                operations: [],
                drift: [],
                warnings: [],
              };
          return {
            declared: dependencyResult.declared,
            missingRequired: dependencyResult.missingRequired,
            missingOptional: dependencyResult.missingOptional,
            installationDependenciesSatisfied: dependencyResult.missingRequired.length === 0,
            schemaMigration,
          };
        },
        applySchemaMigration: async ({ plan, actorId }) =>
          schemaMigrationSvc.applyModuleSchemaMigration({ plan, actorId }),
        reconcilePublishedPackage: async ({ key, staged, moduleRow, publicationPlan, actorId }) => {
          await svc.syncModules({ manifests: [staged.manifest], actorId });
          // syncModuleMetadata only upserts RunlyModel/RunlyField/RunlyView/
          // Blueprint rows — never physical DB schema — so gating it on
          // `!publicationPlan.schemaChangesDetected` had no ordering reason
          // (APPLY_SCHEMA_MIGRATION already ran by this point) and silently
          // dropped metadata for any upload that changed both schema and
          // metadata at once (e.g. a new field's RunlyField row). Found via
          // Module Builder golden-path QA; fixed here too since this same
          // wiring backs the plain ZIP-upload path.
          if (moduleRow?.status === "INSTALLED") {
            await metadataSvc.syncModuleMetadata({
              manifest: staged.manifest,
              models: staged.models,
              views: staged.views,
            });
            // Connections read the manifest/models just synced above.
            await connectionLifecycle.syncModuleConnections({ moduleKey: key });
          }
          const syncResult = await syncDiscoveredModuleDependencies({
            prisma,
            moduleKey: key,
            dependencies: staged.manifest.dependencies ?? [],
          });
          if (syncResult.error?.code === "DEPENDENCY_CYCLE_DETECTED") {
            throw Object.assign(new Error(syncResult.error.message), {
              code: syncResult.error.code,
            });
          }
          return { syncResult };
        },
        reconcileRestoredPackage: async ({ key, packageDir, actorId }) => {
          const loaded = await loadModuleManifest({
            manifestPath: path.join(packageDir, "module.manifest.js"),
            source: "custom",
          });
          if (loaded.status !== "VALID" || loaded.manifest?.key !== key) {
            throw new Error("RESTORED_MANIFEST_INVALID");
          }
          const models = await loadModuleModels({ moduleDir: packageDir, manifest: loaded.manifest });
          const views = await loadModuleViews({ moduleDir: packageDir, manifest: loaded.manifest });
          await svc.syncModules({ manifests: [loaded.manifest], actorId });
          await metadataSvc.syncModuleMetadata({ manifest: loaded.manifest, models, views });
          await syncDiscoveredModuleDependencies({
            prisma,
            moduleKey: key,
            dependencies: loaded.manifest.dependencies ?? [],
          });
        },
      })
    : null;

  async function applyManifestMigrationsForRecord({ record }) {
    const moduleKey = record?.manifest?.key ?? null;
    if (!moduleKey) {
      return {
        moduleKey: null,
        status: "skipped",
        reason: "missing_module_key",
        entries: [],
      };
    }

    const moduleRow = await prisma.runlyModule.findUnique({
      where: { key: moduleKey },
      select: { key: true, status: true, enabled: true },
    });
    if (!moduleRow || moduleRow.status !== "INSTALLED" || !moduleRow.enabled) {
      return {
        moduleKey,
        status: "skipped",
        reason: "module_not_active",
        entries: [],
      };
    }

    const migrations = Array.isArray(record?.migrations)
      ? record.migrations
      : [];
    if (!migrations.length) {
      return {
        moduleKey,
        status: "skipped",
        reason: "no_manifest_migrations",
        entries: [],
      };
    }

    const entries = [];
    for (const migration of migrations) {
      const sql = typeof migration?.sql === "string" ? migration.sql : "";
      const checksum =
        typeof migration?.checksum === "string"
          ? migration.checksum.trim().toLowerCase()
          : "";
      const allowUnsafeSql = migration?.unsafe === true;
      const computed = createHash("sha256").update(sql).digest("hex");
      const localPath =
        typeof migration?.path === "string"
          ? migration.path
          : (migration?.filename ?? "unknown.sql");
      const filename = `manifest__${localPath.replaceAll("\\", "/").replaceAll("/", "__")}`;
      if (checksum && checksum !== computed) {
        entries.push({
          filename,
          path: localPath,
          status: "error",
          code: "CHECKSUM_MISMATCH",
          expected: checksum,
          computed,
        });
        continue;
      }

      try {
        const result = await migrationSvc.applySqlMigration({
          moduleKey,
          filename,
          sql,
          allowUnsafeSql,
        });
        entries.push({
          filename,
          path: localPath,
          status: result.applied ? "applied" : "already_applied",
        });
      } catch (error) {
        entries.push({
          filename,
          path: localPath,
          status: "error",
          code: error?.code ?? "MIGRATION_EXECUTION_FAILED",
          message: toErrorMessage(error),
        });
      }
    }

    const hasErrors = entries.some((entry) => entry.status === "error");
    return {
      moduleKey,
      status: hasErrors ? "partial_error" : "ok",
      entries,
    };
  }

  // ── GET /modules ──────────────────────────────────────────────────────────

  app.get(
    "/",
    authMiddleware,
    requirePermission("core.modules.read"),
    async (c) => {
      try {
        const modules = await prisma.runlyModule.findMany({
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
        // The version of each custom package on disk right now: the desktop's
        // bundled copy of modules/custom is frozen at build/dev-server start,
        // so it cannot tell whether an uploaded package still needs syncing.
        const modulesDir = await resolveModulesDir();
        const data = await Promise.all(modules.map(async (row) => {
          const serialized = serializeModule(row);
          if (!modulesDir || !row.key.startsWith("custom.")) return serialized;
          const diskVersion = await readManifestVersion(path.join(modulesDir, row.key, "module.manifest.js"));
          return diskVersion ? { ...serialized, diskVersion } : serialized;
        }));
        return c.json({ data });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudieron cargar los modulos.",
        );
      }
    },
  );

  // ── GET /modules/available ────────────────────────────────────────────────

  app.get(
    "/available",
    authMiddleware,
    requirePermission("core.modules.read"),
    async (c) => {
      try {
        const modules = await prisma.runlyModule.findMany({
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
        return c.json({ data: modules.map(serializeModule) });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudieron cargar los modulos disponibles.",
        );
      }
    },
  );

  // ── POST /modules/install ─────────────────────────────────────────────────

  app.post(
    "/install",
    authMiddleware,
    requirePermission("core.modules.create"),
    async (c) => {
      const requestId = generateRequestId();
      const isDev = process.env.NODE_ENV !== "production";
      let moduleKey = null;

      try {
        const body = await c.req.json();
        const parsed = moduleInstallSchema.parse(body);
        moduleKey = parsed.manifest?.key ?? null;
        const manifestValidation = validateManifest(parsed.manifest);
        if (!manifestValidation.valid || parsed.manifest?.pwa?.legacyDerived === true) {
          throw Object.assign(new Error("INVALID_MODULE_PWA_IDENTITY"), {
            code: "INVALID_MODULE_PWA_IDENTITY",
            status: 400,
            detail: manifestValidation.errors.join("; "),
          });
        }
        validateManifestAcl(parsed.manifest);
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const result = await svc.installModule({
          manifest: parsed.manifest,
          actorId,
          requestId,
        });
        const rlStatus = await safeRouteReload(moduleKey);
        await safeBuildBundle(moduleKey);
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "core.module.install",
          severity: "success",
          entityType: "RunlyModule",
          payload: { moduleKey },
          summary: `${actorName} instaló el módulo ${moduleKey}`,
        });
        return c.json({ data: result, routeLoader: rlStatus }, 201);
      } catch (err) {
        const stage = classifyInstallStage(err);
        const code =
          err?.code ??
          (err instanceof ModuleLifecycleError
            ? "LIFECYCLE_ERROR"
            : "INTERNAL_ERROR");

        console.error("[modules] POST /install failed", {
          requestId,
          moduleKey,
          stage,
          errorName: err?.name ?? null,
          errorMessage: err?.message ?? null,
          errorCode: err?.code ?? null,
          causeMessage: err?.cause?.message ?? null,
          causeCode: err?.cause?.code ?? null,
          filename: err?.filename ?? null,
          tableName: err?.tableName ?? null,
          sqlPreview: err?.sqlPreview ?? err?.cause?.sqlPreview ?? null,
          statementPreview:
            err?.statementPreview ?? err?.cause?.statementPreview ?? null,
          stack: err?.stack ?? null,
        });

        if (err instanceof ModuleLifecycleError || err?.code === "DEPENDENCY_ALIAS_VERSION_CONFLICT") {
          return c.json(
            { error: err.message, code, moduleKey, stage, requestId },
            err.status,
          );
        }
        if (err?.name === "ZodError") {
          return c.json(
            {
              error: err.errors?.[0]?.message ?? "El manifiesto es invalido.",
              code: "VALIDATION_ERROR",
              moduleKey,
              stage: "validation",
              requestId,
            },
            400,
          );
        }
        if (err?.code === "INVALID_MODULE_PWA_IDENTITY") {
          return c.json(
            {
              error: err.detail || "El modulo requiere icono, color y configuracion PWA propia.",
              code: err.code,
              moduleKey,
              stage: "validation",
              requestId,
            },
            400,
          );
        }
        if (err?.code === "INVALID_MANIFEST_ACL") {
          return c.json(
            {
              error: err.detail ?? "El manifiesto ACL es invalido.",
              code,
              moduleKey,
              stage: "validation",
              requestId,
            },
            400,
          );
        }
        if (err?.code === "DEPENDENCY_NOT_FOUND") {
          return c.json(
            {
              error: `Dependencias no encontradas: ${err.keys?.join(", ")}.`,
              code,
              moduleKey,
              stage: "dependency_sync",
              requestId,
            },
            409,
          );
        }

        return c.json(
          {
            error: "No se pudo instalar el modulo.",
            code,
            moduleKey,
            stage,
            requestId,
            ...(isDev
              ? {
                  details: err?.message ?? null,
                  cause: err?.cause?.message ?? null,
                }
              : {}),
          },
          500,
        );
      }
    },
  );

  // ── POST /modules/sync ────────────────────────────────────────────────────

  app.post(
    "/sync",
    authMiddleware,
    requirePermission("core.modules.create"),
    async (c) => {
      try {
        const isDev = process.env.NODE_ENV !== "production";
        const requestBody = await c.req.json().catch(() => ({}));
        const requestedAutoRepair =
          typeof requestBody?.autoRepair === "boolean"
            ? requestBody.autoRepair
            : null;
        const requestedModuleKey =
          typeof requestBody?.moduleKey === "string" &&
          requestBody.moduleKey.trim()
            ? requestBody.moduleKey.trim()
            : null;
        const autoRepairEnabled = isDev && (requestedAutoRepair ?? true);

        const actorId = await resolveSyncActorId(prisma, c.get("userContext"));
        const discoveryRootInfo = await getDiscoveryRootInfo();
        const discoveredAll = await discoverModules({
          rootDir: discoveryRootInfo.projectRoot,
        });
        const discovered = requestedModuleKey
          ? discoveredAll.filter((record) => record?.key === requestedModuleKey)
          : discoveredAll;

        const automation = {
          autoRepairEnabled,
          modulesScanned: discovered.filter((record) =>
            isCustomModuleRecord(record),
          ).length,
          checksumsFixed: 0,
          versionsBumped: 0,
          reinstalled: 0,
          failed: 0,
          checksumFixes: [],
          versionBumps: [],
          reinstalledModules: [],
          failedModules: [],
        };

        if (autoRepairEnabled) {
          const checksumMismatchRecords = discovered.filter((record) => {
            return (
              isCustomModuleRecord(record) &&
              record?.status !== "VALID" &&
              record?.error?.code === "MANIFEST_MIGRATION_CHECKSUM_MISMATCH" &&
              typeof record?.moduleDir === "string" &&
              isPlainObject(record?.manifest)
            );
          });

          for (const record of checksumMismatchRecords) {
            const moduleKey =
              typeof record?.key === "string" ? record.key.trim() : "";
            const migrations = Array.isArray(record?.manifest?.migrations)
              ? record.manifest.migrations
              : [];
            const manifestPath = path.join(
              record.moduleDir,
              "module.manifest.js",
            );

            try {
              const updates = [];
              for (const migration of migrations) {
                const declaredPath =
                  typeof migration?.path === "string"
                    ? migration.path.trim()
                    : "";
                if (!declaredPath) continue;

                const sqlPath = path.resolve(record.moduleDir, declaredPath);
                const sql = await fs.readFile(sqlPath, "utf8");
                const computedChecksum = createHash("sha256")
                  .update(sql)
                  .digest("hex");
                const declaredChecksum =
                  typeof migration?.checksum === "string"
                    ? migration.checksum.trim().toLowerCase()
                    : "";
                if (computedChecksum !== declaredChecksum) {
                  updates.push({
                    path: declaredPath,
                    checksum: computedChecksum,
                  });
                }
              }

              if (updates.length > 0) {
                const result = await applyManifestChecksumUpdates({
                  manifestPath,
                  updates,
                });
                automation.checksumsFixed += result.updatedPaths.length;
                automation.checksumFixes.push({
                  key: moduleKey || null,
                  manifestPath,
                  updatedPaths: result.updatedPaths,
                });
              }
            } catch (error) {
              automation.failed += 1;
              automation.failedModules.push({
                key: moduleKey || null,
                stage: "checksum_autofix",
                message: toErrorMessage(error),
              });
            }
          }

          if (automation.checksumFixes.length > 0) {
            const rediscoveredAll = await discoverModules({
              rootDir: discoveryRootInfo.projectRoot,
            });
            discovered.length = 0;
            discovered.push(
              ...(requestedModuleKey
                ? rediscoveredAll.filter(
                    (record) => record?.key === requestedModuleKey,
                  )
                : rediscoveredAll),
            );
          }

          const customValidRecordsForBump = discovered.filter(
            (record) =>
              isCustomModuleRecord(record) &&
              record?.status === "VALID" &&
              isPlainObject(record?.manifest) &&
              typeof record?.moduleDir === "string",
          );

          const customKeysForBump = customValidRecordsForBump
            .map((record) => record?.manifest?.key)
            .filter((value) => typeof value === "string" && value.trim())
            .map((value) => value.trim());

          const existingRowsForBump =
            customKeysForBump.length > 0
              ? await prisma.runlyModule.findMany({
                  where: { key: { in: customKeysForBump } },
                  select: { key: true, version: true, lifecycleConfig: true },
                })
              : [];
          const existingRowsByKey = new Map(
            existingRowsForBump.map((row) => [row.key, row]),
          );

          for (const record of customValidRecordsForBump) {
            const key = record?.manifest?.key;
            const manifestVersion =
              typeof record?.manifest?.version === "string"
                ? record.manifest.version.trim()
                : "";
            const existing = existingRowsByKey.get(key);
            if (!existing || !manifestVersion) continue;

            const prevSignature =
              existing?.lifecycleConfig?.dev &&
              typeof existing.lifecycleConfig.dev === "object" &&
              !Array.isArray(existing.lifecycleConfig.dev)
                ? (existing.lifecycleConfig.dev.migrationSignature ?? null)
                : null;
            const nextSignature = computeMigrationSignature(record.manifest);
            const signatureChanged = prevSignature !== nextSignature;
            const versionUnchangedVsDb = existing.version === manifestVersion;

            if (!signatureChanged || !versionUnchangedVsDb) continue;

            const nextVersion = bumpPatchVersion(manifestVersion);
            if (!nextVersion || nextVersion === manifestVersion) continue;

            try {
              const manifestPath = path.join(
                record.moduleDir,
                "module.manifest.js",
              );
              const bumpResult = await bumpManifestVersion({
                manifestPath,
                fromVersion: manifestVersion,
                toVersion: nextVersion,
              });
              automation.versionsBumped += 1;
              automation.versionBumps.push({
                key,
                manifestPath,
                fromVersion: bumpResult.fromVersion,
                toVersion: bumpResult.toVersion,
              });
            } catch (error) {
              automation.failed += 1;
              automation.failedModules.push({
                key,
                stage: "version_autobump",
                message: toErrorMessage(error),
              });
            }
          }

          if (automation.versionBumps.length > 0) {
            const rediscoveredAll = await discoverModules({
              rootDir: discoveryRootInfo.projectRoot,
            });
            discovered.length = 0;
            discovered.push(
              ...(requestedModuleKey
                ? rediscoveredAll.filter(
                    (record) => record?.key === requestedModuleKey,
                  )
                : rediscoveredAll),
            );
          }
        }

        const validModules = discovered.filter(
          (record) => record.status === "VALID" && record.manifest,
        );
        const invalidModules = discovered.filter(
          (record) => record.status !== "VALID",
        );
        automation.modulesScanned = discovered.filter((record) =>
          isCustomModuleRecord(record),
        ).length;
        const customValidModules = validModules.filter((record) =>
          isCustomModuleRecord(record),
        );

        const customModuleKeys = customValidModules
          .map((record) => record?.manifest?.key)
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => value.trim());

        const customModuleRows =
          customModuleKeys.length > 0
            ? await prisma.runlyModule.findMany({
                where: { key: { in: customModuleKeys } },
                select: {
                  key: true,
                  version: true,
                  status: true,
                  enabled: true,
                  lifecycleConfig: true,
                },
              })
            : [];
        const customModuleRowsByKey = new Map(
          customModuleRows.map((row) => [row.key, row]),
        );

        const signatureByModuleKey = new Map(
          customValidModules.map((record) => [
            record.manifest.key,
            computeMigrationSignature(record.manifest),
          ]),
        );
        const customMigrationRows =
          customModuleKeys.length > 0
            ? await prisma.moduleMigration.findMany({
                where: { moduleKey: { in: customModuleKeys } },
                select: { moduleKey: true, filename: true },
              })
            : [];
        const appliedManifestFilenamesByModule = new Map();
        for (const row of customMigrationRows) {
          const moduleKey =
            typeof row?.moduleKey === "string" ? row.moduleKey.trim() : "";
          const filename =
            typeof row?.filename === "string" ? row.filename.trim() : "";
          if (!moduleKey || !filename) continue;
          if (!appliedManifestFilenamesByModule.has(moduleKey)) {
            appliedManifestFilenamesByModule.set(moduleKey, new Set());
          }
          appliedManifestFilenamesByModule.get(moduleKey).add(filename);
        }

        // Modules the stale cleanup below disabled because their files were
        // gone (MISSING_FILES) are re-enabled once the files are back on disk.
        // Must run before syncModules, which rewrites lifecycleConfig and
        // would drop the marker, leaving the module INSTALLED but disabled
        // (routes never mount) with no trace of why.
        const restoredModules = [];
        for (const row of customModuleRows) {
          if (
            row.status !== "INSTALLED" ||
            row.enabled ||
            row.lifecycleConfig?.discovery?.status !== "MISSING_FILES"
          ) continue;
          await prisma.runlyModule.update({
            where: { key: row.key },
            data: { enabled: true },
          });
          restoredModules.push(row.key);
        }

        let lifecycleSync = { synced: 0, added: 0, updated: 0 };
        const discoveredKeys = new Set(
          validModules.map((record) => record.manifest.key),
        );
        const officialFallbackManifests = buildOfficialFallbackManifests({
          discoveredKeys,
        });
        const dependencySourceRecords = [...validModules];
        if (validModules.length > 0) {
          const syncManifests = validModules
            .map((record) => {
              if (autoRepairEnabled && isCustomModuleRecord(record)) {
                const migrationSignature = signatureByModuleKey.get(
                  record.manifest.key,
                );
                return mergeDiscoveryIntoManifest(record, {
                  extraLifecycle: {
                    dev: {
                      migrationSignature: migrationSignature ?? null,
                      migrationSignatureUpdatedAt: new Date().toISOString(),
                    },
                  },
                });
              }
              return mergeDiscoveryIntoManifest(record);
            })
            .filter(Boolean);
          syncManifests.push(...officialFallbackManifests);
          dependencySourceRecords.push(
            ...officialFallbackManifests.map((manifest) => ({ manifest })),
          );
          lifecycleSync = await svc.syncModules({
            manifests: syncManifests,
            actorId,
          });
        } else if (officialFallbackManifests.length > 0) {
          dependencySourceRecords.push(
            ...officialFallbackManifests.map((manifest) => ({ manifest })),
          );
          lifecycleSync = await svc.syncModules({
            manifests: officialFallbackManifests,
            actorId,
          });
        }

        const dependencySync = {
          synced: 0,
          removed: 0,
          errors: [],
          warnings: [],
          modules: [],
        };
        for (const record of dependencySourceRecords) {
          try {
            const moduleResult = await syncDiscoveredModuleDependencies({
              prisma,
              moduleKey: record.manifest.key,
              dependencies: record.manifest.dependencies ?? [],
            });
            dependencySync.synced += moduleResult.synced;
            dependencySync.removed += moduleResult.removed;
            dependencySync.modules.push(moduleResult);

            if (moduleResult.error) {
              dependencySync.errors.push({
                key: moduleResult.key,
                code: moduleResult.error.code,
                message: moduleResult.error.message,
              });
            }

            if (moduleResult.missingRequired.length > 0) {
              dependencySync.errors.push({
                key: moduleResult.key,
                code: "MISSING_REQUIRED_DEPENDENCY",
                message: `Dependencias requeridas faltantes: ${moduleResult.missingRequired.join(", ")}`,
                missing: moduleResult.missingRequired,
              });
            }

            if (moduleResult.missingOptional.length > 0) {
              dependencySync.warnings.push({
                key: moduleResult.key,
                code: "MISSING_OPTIONAL_DEPENDENCY",
                message: `Dependencias opcionales no encontradas: ${moduleResult.missingOptional.join(", ")}`,
                missing: moduleResult.missingOptional,
              });
            }
          } catch (error) {
            dependencySync.errors.push({
              key: record.key ?? record.manifest?.key ?? null,
              code: "DEPENDENCY_SYNC_FAILED",
              message: toErrorMessage(error),
            });
          }
        }

        const metadataSync = {
          synced: 0,
          errors: [],
        };

        for (const record of validModules) {
          try {
            await metadataSvc.syncModuleMetadata({
              manifest: record.manifest,
              models: record.models ?? [],
              views: record.views ?? [],
            });
            metadataSync.synced += 1;
          } catch (error) {
            metadataSync.errors.push({
              key: record.key ?? null,
              source: record.source ?? null,
              localPath: record.localPath ?? null,
              code: "METADATA_SYNC_FAILED",
              message: toErrorMessage(error),
            });
          }
        }

        const autoReconcileCandidates = [];
        if (autoRepairEnabled) {
          for (const record of customValidModules) {
            const key = record.manifest.key;
            const moduleRow = customModuleRowsByKey.get(key);
            if (
              !moduleRow ||
              moduleRow.status !== "INSTALLED" ||
              !moduleRow.enabled
            ) {
              continue;
            }

            const prevSignature =
              moduleRow?.lifecycleConfig?.dev &&
              typeof moduleRow.lifecycleConfig.dev === "object" &&
              !Array.isArray(moduleRow.lifecycleConfig.dev)
                ? (moduleRow.lifecycleConfig.dev.migrationSignature ?? null)
                : null;
            const nextSignature = signatureByModuleKey.get(key) ?? null;
            const signatureChanged = prevSignature !== nextSignature;
            const versionChanged =
              moduleRow.version !== record.manifest.version;
            const expectedManifestFilenames = (
              Array.isArray(record?.migrations) ? record.migrations : []
            )
              .map((migration) => toManifestMigrationFilename(migration?.path))
              .filter((value) => typeof value === "string" && value.trim());
            const appliedFilenames =
              appliedManifestFilenamesByModule.get(key) ?? new Set();
            const hasPendingManifestMigrations = expectedManifestFilenames.some(
              (filename) => !appliedFilenames.has(filename),
            );

            if (
              !signatureChanged &&
              !versionChanged &&
              !hasPendingManifestMigrations
            )
              continue;

            autoReconcileCandidates.push({
              key,
              previousVersion: moduleRow.version,
              nextVersion: record.manifest.version,
              signatureChanged,
              versionChanged,
              pendingManifestMigrations: hasPendingManifestMigrations,
            });
          }
        }

        const autoReconciledModuleKeys = new Set();
        for (const candidate of autoReconcileCandidates) {
          autoReconciledModuleKeys.add(candidate.key);
          try {
            const result = await svc.retryInstallModule({
              key: candidate.key,
              actorId,
              requestId: generateRequestId(),
            });
            const routeLoaderStatus = await safeRouteReload(candidate.key);
            automation.reinstalled += 1;
            automation.reinstalledModules.push({
              key: candidate.key,
              status: result?.status ?? "INSTALLED",
              previousVersion: candidate.previousVersion,
              nextVersion: candidate.nextVersion,
              signatureChanged: candidate.signatureChanged,
              versionChanged: candidate.versionChanged,
              pendingManifestMigrations: candidate.pendingManifestMigrations,
              routeLoader: routeLoaderStatus,
            });
          } catch (error) {
            automation.failed += 1;
            automation.failedModules.push({
              key: candidate.key,
              stage: classifyInstallStage(error),
              message: toErrorMessage(error),
              previousVersion: candidate.previousVersion,
              nextVersion: candidate.nextVersion,
              pendingManifestMigrations: candidate.pendingManifestMigrations,
            });
          }
        }

        const manifestMigrationsSync = {
          modules: [],
          applied: 0,
          alreadyApplied: 0,
          errors: [],
          skipped: [],
        };
        for (const record of validModules) {
          const moduleKey = record?.manifest?.key ?? null;
          if (autoReconciledModuleKeys.has(moduleKey)) {
            const skipped = {
              moduleKey,
              status: "skipped",
              reason: "handled_by_auto_reconcile",
              entries: [],
            };
            manifestMigrationsSync.modules.push(skipped);
            manifestMigrationsSync.skipped.push({
              moduleKey,
              reason: skipped.reason,
            });
            continue;
          }

          const result = await applyManifestMigrationsForRecord({ record });
          manifestMigrationsSync.modules.push(result);
          if (result.status === "skipped") {
            manifestMigrationsSync.skipped.push({
              moduleKey: result.moduleKey,
              reason: result.reason,
            });
            continue;
          }
          for (const entry of result.entries) {
            if (entry.status === "applied") manifestMigrationsSync.applied += 1;
            if (entry.status === "already_applied")
              manifestMigrationsSync.alreadyApplied += 1;
            if (entry.status === "error") {
              manifestMigrationsSync.errors.push({
                moduleKey: result.moduleKey,
                filename: entry.filename,
                path: entry.path,
                code: entry.code,
                message: entry.message ?? "Migration failed",
              });
            }
          }
        }

        const invalidUpserts = [];
        for (const record of invalidModules) {
          if (!record.key) continue;
          const upserted = await upsertDiscoveredModuleError({
            prisma,
            record,
          });
          if (!upserted) continue;
          invalidUpserts.push({
            key: upserted.key,
            status: upserted.status,
            enabled: upserted.enabled,
          });
        }

        // ── Stale custom module cleanup ────────────────────────────────────
        // Custom module rows that exist in DB but have no files on disk anymore.
        // We include both valid and invalid (broken manifest) discovered keys as
        // "present on disk" so only truly gone modules are treated as stale.
        const allDiskCustomKeys = new Set([
          ...validModules
            .filter((r) => isCustomModuleRecord(r))
            .map((r) => r.manifest.key),
          ...invalidModules
            .filter((r) => isCustomModuleRecord(r) && r.key)
            .map((r) => r.key),
        ]);

        const dbCustomRows = await prisma.runlyModule.findMany({
          where: requestedModuleKey
            ? { key: requestedModuleKey }
            : { key: { startsWith: "custom." } },
          select: { key: true, status: true, lifecycleConfig: true },
        });

        const staleRows = dbCustomRows.filter(
          (row) => !allDiskCustomKeys.has(row.key),
        );
        const staleSync = { removed: 0, disabled: 0, keys: [] };

        for (const row of staleRows) {
          const hasData =
            row.status === "INSTALLED" || row.status === "DISABLED";
          if (hasData) {
            const existingLifecycle = isPlainObject(row.lifecycleConfig)
              ? row.lifecycleConfig
              : {};
            await prisma.runlyModule.update({
              where: { key: row.key },
              data: {
                enabled: false,
                lifecycleConfig: {
                  ...existingLifecycle,
                  discovery: {
                    status: "MISSING_FILES",
                    detectedAt: new Date().toISOString(),
                  },
                },
              },
            });
            safeRouteUnload(row.key);
            staleSync.disabled++;
            staleSync.keys.push({ key: row.key, action: "disabled_missing_files" });
          } else {
            await prisma.runlyModule.delete({ where: { key: row.key } });
            staleSync.removed++;
            staleSync.keys.push({ key: row.key, action: "removed" });
          }
        }

        const payload = {
          status:
            dependencySync.errors.length > 0 ||
            metadataSync.errors.length > 0 ||
            manifestMigrationsSync.errors.length > 0 ||
            automation.failed > 0 ||
            invalidModules.length > 0
              ? "partial"
              : "ok",
          scope: {
            moduleKey: requestedModuleKey,
            scoped: Boolean(requestedModuleKey),
            discoveredAll: discoveredAll.length,
            discoveredScoped: discovered.length,
          },
          discovered: discovered.length,
          valid: validModules.length,
          invalid: invalidModules.length,
          lifecycleSync,
          officialFallbackSync: {
            used: officialFallbackManifests.length > 0,
            modulesCount: officialFallbackManifests.length,
            moduleKeys: officialFallbackManifests.map(
              (manifest) => manifest.key,
            ),
          },
          dependencySync,
          metadataSync,
          manifestMigrationsSync,
          invalidUpserts,
          staleSync,
          restoredModules,
          automation,
          modules: discovered.map(serializeDiscoveredModule),
        };

        if (routeLoader) {
          const touchedModuleKeys = validModules
            .map((record) => record?.manifest?.key)
            .filter((value) => typeof value === "string" && value.trim())
            .map((value) => value.trim());
          payload.routeLoaderSync = await routeLoader.syncInstalledModules({
            limitToModuleKeys: touchedModuleKeys,
          });
        }

        if (bundlerSvc) {
          const keysToBundle = validModules
            .map((record) => record?.manifest?.key)
            .filter((value) => typeof value === "string" && value.trim());
          for (const key of keysToBundle) {
            await safeBuildBundle(key);
          }
        }

        if (process.env.NODE_ENV !== "production") {
          payload.debug = {
            cwd: discoveryRootInfo.cwd,
            projectRoot: discoveryRootInfo.projectRoot,
            modulesDirExists: discoveryRootInfo.modulesDirExists,
            customModulesDirExists: discoveryRootInfo.customModulesDirExists,
            officialModulesDirExists:
              discoveryRootInfo.officialModulesDirExists,
          };
        }

        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        return c.json({ data: payload });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo sincronizar los modulos.",
        );
      }
    },
  );

  // ── GET /modules/:key/lifecycle ───────────────────────────────────────────

  app.get(
    "/:key/lifecycle",
    authMiddleware,
    requirePermission("core.modules.read"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const mod = await prisma.runlyModule.findUnique({
          where: { key },
          include: {
            dependencies: {
              include: {
                dependency: {
                  select: {
                    key: true,
                    name: true,
                    status: true,
                    enabled: true,
                  },
                },
              },
            },
          },
        });
        if (!mod) return c.json({ error: "Modulo no encontrado." }, 404);

        const lc = mod.lifecycleConfig ?? {};
        const permissionsTotal = await prisma.permission.count({
          where: { moduleId: mod.id },
        });
        const permissionsActive = await prisma.permission.count({
          where: { moduleId: mod.id, active: true },
        });
        const dependents = await prisma.moduleDependency.findMany({
          where: {
            dependencyId: mod.id,
            module: { status: "INSTALLED", enabled: true },
          },
          include: { module: { select: { key: true, name: true } } },
        });

        return c.json({
          data: {
            key: mod.key,
            status: mod.status,
            enabled: mod.enabled,
            core: mod.core,
            installable: lc.installable ?? true,
            uninstallable: mod.uninstallable,
            resettable: lc.resettable ?? false,
            supportsDataPurge: lc.supportsDataPurge ?? false,
            ownedEntities: lc.ownedEntities ?? [],
            permissionsTotal,
            permissionsActive,
            dependents: dependents.map((d) => ({
              key: d.module.key,
              name: d.module.name,
            })),
            dependencies: mod.dependencies.map((d) => ({
              key: d.dependency.key,
              name: d.dependency.name,
              status: d.dependency.status,
              enabled: d.dependency.enabled,
              optional: d.optional,
            })),
          },
        });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo cargar el ciclo de vida del modulo.",
        );
      }
    },
  );

  // ── GET /modules/:key/migrations ─────────────────────────────────────────

  app.get(
    "/:key/migrations",
    authMiddleware,
    requirePermission("core.modules.read"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const mod = await prisma.runlyModule.findUnique({
          where: { key },
          select: { key: true },
        });
        if (!mod) return c.json({ error: "Modulo no encontrado." }, 404);

        const migrations = await migrationSvc.listAppliedMigrations(key);
        return c.json({ data: migrations });
      } catch (err) {
        console.error("[modules] GET /:key/migrations error:", err);
        return c.json(
          { error: "No se pudieron cargar las migraciones del modulo." },
          500,
        );
      }
    },
  );

  // ── GET /modules/:key/routes ─────────────────────────────────────────────
  // Diagnostics for "module installed but its endpoints 404": DB state, the
  // route loader's last result for this key (incl. load errors) and the
  // routes actually mounted in this API process.

  app.get(
    "/:key/routes",
    authMiddleware,
    requirePermission("core.modules.read"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const mod = await prisma.runlyModule.findUnique({
          where: { key },
          select: { key: true, status: true, enabled: true, version: true, lifecycleConfig: true },
        });
        if (!mod) return c.json({ error: "Modulo no encontrado." }, 404);
        const modulesDir = await resolveModulesDir();
        const apiPath = modulesDir ? path.join(modulesDir, key, "api", "index.js") : null;
        const loaded = routeLoader?.getLoadedModules?.().find((entry) => entry.moduleKey === key) ?? null;
        return c.json({
          data: {
            module: {
              key: mod.key,
              status: mod.status,
              enabled: mod.enabled,
              version: mod.version,
              discovery: mod.lifecycleConfig?.discovery ?? null,
              persistedRouteLoader: mod.lifecycleConfig?.routeLoader ?? null,
            },
            apiFile: { path: apiPath, exists: Boolean(apiPath && existsSync(apiPath)) },
            routeLoader: routeLoader?.getModuleRouteStatus?.(key) ?? null,
            mounted: Boolean(loaded),
            loadedAt: loaded?.loadedAt ?? null,
            routes: loaded?.routes ?? [],
          },
        });
      } catch (err) {
        console.error("[modules] GET /:key/routes error:", err);
        return c.json({ error: "No se pudo leer el estado de rutas del modulo." }, 500);
      }
    },
  );

  // ── POST /modules/:key/disable ────────────────────────────────────────────

  app.get(
    "/:key/error",
    authMiddleware,
    requirePermission("core.modules.read"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const data = await svc.getModuleInstallError({ key });
        return c.json({ data });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo obtener el error del modulo.",
        );
      }
    },
  );

  app.post(
    "/:key/retry-install",
    authMiddleware,
    requirePermission("core.modules.create"),
    async (c) => {
      const requestId = generateRequestId();
      const isDev = process.env.NODE_ENV !== "production";
      const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
      try {
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const result = await svc.retryInstallModule({
          key,
          actorId,
          requestId,
        });
        const rlStatus = await safeRouteReload(key);
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        return c.json({ data: result, routeLoader: rlStatus });
      } catch (err) {
        const stage = classifyInstallStage(err);
        const code =
          err?.code ??
          (err instanceof ModuleLifecycleError
            ? "LIFECYCLE_ERROR"
            : "INTERNAL_ERROR");

        console.error("[modules] POST /:key/retry-install failed", {
          requestId,
          moduleKey: key,
          stage,
          errorName: err?.name ?? null,
          errorMessage: err?.message ?? null,
          errorCode: err?.code ?? null,
          causeMessage: err?.cause?.message ?? null,
          causeCode: err?.cause?.code ?? null,
          filename: err?.filename ?? null,
          tableName: err?.tableName ?? null,
          sqlPreview: err?.sqlPreview ?? err?.cause?.sqlPreview ?? null,
          statementPreview:
            err?.statementPreview ?? err?.cause?.statementPreview ?? null,
          stack: err?.stack ?? null,
        });

        if (err instanceof ModuleLifecycleError || err?.code === "DEPENDENCY_ALIAS_VERSION_CONFLICT") {
          return c.json(
            { error: err.message, code, moduleKey: key, stage, requestId },
            err.status,
          );
        }
        return c.json(
          {
            error: "No se pudo reintentar la instalacion del modulo.",
            code,
            moduleKey: key,
            stage,
            requestId,
            ...(isDev
              ? {
                  details: err?.message ?? null,
                  cause: err?.cause?.message ?? null,
                }
              : {}),
          },
          500,
        );
      }
    },
  );

  app.post(
    "/:key/clear-error",
    authMiddleware,
    requirePermission("core.modules.update"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const body = await c.req.json().catch(() => ({}));
        const parsed = moduleClearErrorSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const result = await svc.clearFailedInstall({
          key,
          actorId,
          mode: parsed.data.mode,
        });
        safeRouteUnload(key);
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        return c.json({ data: result });
      } catch (err) {
        return handleLifecycleError(c, err, "No se pudo restaurar el modulo.");
      }
    },
  );

  app.post(
    "/:key/cleanup-dry-run",
    authMiddleware,
    requirePermission("core.modules.delete"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const body = await c.req.json().catch(() => ({}));
        const parsed = moduleCleanupDryRunSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const result = await svc.dryRunFailedInstallCleanup({
          key,
          mode: parsed.data.mode,
        });
        return c.json({ data: result });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo ejecutar la simulacion de limpieza.",
        );
      }
    },
  );

  app.post(
    "/:key/cleanup",
    authMiddleware,
    requirePermission("core.modules.delete"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const body = await c.req.json().catch(() => ({}));
        const parsed = moduleCleanupSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const result = await svc.clearFailedInstall({
          key,
          actorId,
          mode: parsed.data.mode,
          confirmation: parsed.data.confirmation,
        });
        safeRouteUnload(key);
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        return c.json({ data: result });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo limpiar el intento fallido del modulo.",
        );
      }
    },
  );

  app.post(
    "/:key/disable",
    authMiddleware,
    requirePermission("core.modules.update"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const result = await svc.disableModule({ key, actorId });
        const rlUnloaded = safeRouteUnload(key);
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "core.module.disable",
          severity: "warning",
          entityType: "RunlyModule",
          payload: { moduleKey: key },
          summary: `${actorName} deshabilitó el módulo ${key}`,
        });
        return c.json({
          data: result,
          routeLoader: { unloaded: rlUnloaded ?? false },
        });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo deshabilitar el modulo.",
        );
      }
    },
  );

  // ── POST /modules/:key/enable ─────────────────────────────────────────────

  app.post(
    "/:key/enable",
    authMiddleware,
    requirePermission("core.modules.update"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const result = await svc.enableModule({ key, actorId });
        const rlStatus = await safeRouteReload(key);
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "core.module.enable",
          severity: "info",
          entityType: "RunlyModule",
          payload: { moduleKey: key },
          summary: `${actorName} habilitó el módulo ${key}`,
        });
        return c.json({ data: result, routeLoader: rlStatus });
      } catch (err) {
        return handleLifecycleError(c, err, "No se pudo habilitar el modulo.");
      }
    },
  );

  // ── DELETE /modules/:key (preserve-data uninstall shorthand) ─────────────

  app.delete(
    "/:key",
    authMiddleware,
    requirePermission("core.modules.delete"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const actorId = c.get("userContext")?.profile?.id ?? null;
        // Tenant middleware's already-validated active company, not
        // re-derived from memberships[0]. See
        // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
        const companyId = c.get("companyId") ?? null;
        const result = await svc.uninstallModule({
          key,
          mode: "preserve-data",
          companyId,
          actorId,
        });
        const rlUnloaded = safeRouteUnload(key);
        await safeDeleteBundle(key);
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "core.module.uninstall",
          severity: "critical",
          entityType: "RunlyModule",
          payload: { moduleKey: key },
          summary: `${actorName} desinstaló el módulo ${key} (preservando datos)`,
        });
        return c.json({
          data: result,
          routeLoader: { unloaded: rlUnloaded ?? false },
        });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo desinstalar el modulo.",
        );
      }
    },
  );

  // ── POST /modules/:key/uninstall/dry-run ──────────────────────────────────

  app.post(
    "/:key/uninstall/dry-run",
    authMiddleware,
    requirePermission("core.modules.delete"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const body = await c.req.json().catch(() => ({}));
        const parsed = moduleDryRunSchema.safeParse(body);
        const mode = parsed.success
          ? (parsed.data.mode ?? defaultUninstallModeForKey(key))
          : defaultUninstallModeForKey(key);
        // Tenant middleware's already-validated active company, not
        // re-derived from memberships[0]. See
        // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
        const companyId = c.get("companyId") ?? null;
        const result = await svc.dryRunUninstall({ key, mode, companyId });
        return c.json({ data: result });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo ejecutar la simulacion de desinstalacion.",
        );
      }
    },
  );

  // ── POST /modules/:key/uninstall ──────────────────────────────────────────

  app.post(
    "/:key/uninstall",
    authMiddleware,
    requirePermission("core.modules.delete"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const body = await c.req.json();
        const parsed = moduleUninstallSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const actorId = c.get("userContext")?.profile?.id ?? null;
        // Tenant middleware's already-validated active company, not
        // re-derived from memberships[0]. See
        // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
        const companyId = c.get("companyId") ?? null;
        const mode = parsed.data.mode ?? defaultUninstallModeForKey(key);
        const result = await svc.uninstallModule({
          key,
          mode,
          companyId,
          actorId,
          confirmation: parsed.data.confirmation ?? null,
        });
        const rlUnloaded = safeRouteUnload(key);
        await safeDeleteBundle(key);
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "core.module.uninstall",
          severity: "critical",
          entityType: "RunlyModule",
          payload: { moduleKey: key },
          summary: `${actorName} desinstaló el módulo ${key} (${mode})`,
        });
        return c.json({
          data: result,
          routeLoader: { unloaded: rlUnloaded ?? false },
        });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo desinstalar el modulo.",
        );
      }
    },
  );

  // ── POST /modules/:key/reset/dry-run ─────────────────────────────────────

  app.post(
    "/:key/reset/dry-run",
    authMiddleware,
    requirePermission("core.modules.delete"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        // Tenant middleware's already-validated active company, not
        // re-derived from memberships[0]. See
        // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
        const companyId = c.get("companyId") ?? null;
        const result = await svc.dryRunReset({ key, companyId });
        return c.json({ data: result });
      } catch (err) {
        return handleLifecycleError(
          c,
          err,
          "No se pudo ejecutar la simulacion de reinicio.",
        );
      }
    },
  );

  // ── POST /modules/:key/reset ──────────────────────────────────────────────

  app.post(
    "/:key/reset",
    authMiddleware,
    requirePermission("core.modules.delete"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const body = await c.req.json();
        const parsed = moduleResetSchema.safeParse(body);
        if (!parsed.success) {
          return c.json(
            { error: parsed.error.errors[0]?.message ?? "Datos invalidos." },
            400,
          );
        }
        const actorId = c.get("userContext")?.profile?.id ?? null;
        // Tenant middleware's already-validated active company, not
        // re-derived from memberships[0]. See
        // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
        const companyId = c.get("companyId") ?? null;
        const result = await svc.resetModule({ key, companyId, actorId });
        await safeBuildBundle(key, { force: true });
        cacheDel("blueprints:raw");
        cacheDel("runtime:modules:raw");
        cacheDel("public:modules:raw");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "core.module.reset",
          severity: "warning",
          entityType: "RunlyModule",
          payload: { moduleKey: key },
          summary: `${actorName} reinició el módulo ${key}`,
        });
        return c.json({ data: result });
      } catch (err) {
        return handleLifecycleError(c, err, "No se pudo reiniciar el modulo.");
      }
    },
  );

  // ── POST /modules/:key/seed ──────────────────────────────────────────────
  app.post(
    "/:key/seed",
    authMiddleware,
    requirePermission("core.modules.install"),
    async (c) => {
      try {
        const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
        const mod = await prisma.runlyModule.findUnique({ where: { key } });
        if (!mod) return c.json({ error: "Modulo no encontrado." }, 404);
        if (mod.status !== "INSTALLED" || !mod.enabled) {
          return c.json(
            { error: "El modulo debe estar instalado y activo para ejecutar el seed." },
            409,
          );
        }
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const result = await svc.runModuleSeed({ moduleKey: key, actorId });
        return c.json({ data: result });
      } catch (err) {
        return handleLifecycleError(c, err, "No se pudo ejecutar el seed del modulo.");
      }
    },
  );

  // ── GET /modules/:key/bundle.js ───────────────────────────────────────────
  // The bundle is served with its original bare-specifier imports intact.
  // The frontend HTML injects an importmap (via Vite plugin) that resolves
  // those specifiers both in dev (/@id/ virtual modules) and in production
  // (/app/shims/ext-*.js shim chunks).  No server-side rewriting is needed.
  app.get("/:key/bundle.js", async (c) => {
    const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));

    if (!/^[\w.-]+$/.test(key)) {
      return c.json({ error: "Clave de modulo invalida." }, 400);
    }

    const moduleRow = await prisma.runlyModule.findUnique({
      where: { key },
      select: {
        status: true,
        enabled: true,
        hasBundle: true,
        bundleHash: true,
      },
    });

    if (
      !moduleRow ||
      moduleRow.status !== "INSTALLED" ||
      !moduleRow.enabled ||
      !moduleRow.hasBundle
    ) {
      return c.json({ error: "Bundle no disponible." }, 404);
    }

    const bundlePath = path.join(BUNDLES_DIR_SERVE, `${key}.js`);

    let content;
    try {
      content = await fs.readFile(bundlePath, "utf8");
    } catch {
      return c.json(
        { error: "Bundle no encontrado. Ejecuta sync para reconstruirlo." },
        404,
      );
    }

    c.header("Content-Type", "application/javascript");
    c.header("ETag", `"${moduleRow.bundleHash ?? key}"`);
    c.header(
      "Cache-Control",
      process.env.NODE_ENV === "production"
        ? "public, max-age=3600"
        : "no-store",
    );
    return c.body(content);
  });

  // GET /modules/:key/bundle.css — utilities used by the module's components
  // (spec 2026-10-03-rme3-module-platform-v2 §12.1). Like bundle.js it is
  // fetched without auth headers (a <link>); it only exposes CSS derived from
  // the same sources bundle.js already serves. Empty 200 when there is
  // nothing to style, so the loader never logs a failed stylesheet.
  app.get("/:key/bundle.css", async (c) => {
    const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
    c.header("Content-Type", "text/css; charset=utf-8");
    c.header("Cache-Control", "no-cache");
    if (!/^[\w.-]+$/.test(key)) return c.body("");
    const moduleRow = await prisma.runlyModule.findUnique({
      where: { key },
      select: { status: true, enabled: true, hasBundle: true },
    });
    if (!moduleRow || moduleRow.status !== "INSTALLED" || !moduleRow.enabled || !moduleRow.hasBundle) return c.body("");
    const modulesDir = await resolveModulesDir();
    if (!modulesDir) return c.body("");
    try {
      return c.body(await moduleCss(path.join(modulesDir, key, "components"), key));
    } catch (err) {
      console.error(`[modules] bundle.css for ${key} failed:`, err?.message ?? err);
      return c.body("");
    }
  });

  // POST /modules/:key/upload/check — review a ZIP without applying it:
  // validation, structure plan vs the installed module and a preview bundle
  // of its React components (module-package-service.js#checkZip).
  app.post(
    "/:key/upload/check",
    authMiddleware,
    requirePermission("core.modules.upload"),
    async (c) => {
      const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
      if (!packageSvc?.checkZip) return c.json({ error: "MODULE_PACKAGE_PUBLISH_UNAVAILABLE" }, 503);
      const modulesDir = await resolveModulesDir();
      if (!modulesDir || !existsSync(modulesDir)) return c.json({ error: "MODULES_DIR_NOT_CONFIGURED" }, 503);
      const body = await c.req.parseBody();
      const file = body.file;
      if (!file || typeof file.arrayBuffer !== "function") return c.json({ error: 'Campo "file" requerido' }, 422);
      if (!file.name?.toLowerCase().endsWith(".zip")) return c.json({ error: "El archivo debe ser un ZIP" }, 422);
      try {
        const builderSync = createBuilderPackageSync({ prisma });
        const report = await packageSvc.checkZip({
          key,
          fileBuffer: Buffer.from(await file.arrayBuffer()),
          modulesDir,
          inspect: (staged) => builderSync.evaluateUpload({ moduleKey: key, dir: staged.packageDir, manifest: staged.manifest }),
        });
        return c.json({ data: { moduleKey: key, ...report } });
      } catch (err) {
        return c.json({ error: err.code ?? err.message ?? "No se pudo revisar el paquete." }, err.statusCode ?? 500);
      }
    },
  );

  // GET /modules/:key/preview/:previewId/bundle.js — preview bundle built by
  // /upload/check. No auth header is possible with import(); the previewId
  // is a random UUID and previews expire after PREVIEW_TTL_MS.
  app.get("/:key/preview/:previewId/bundle.js", async (c) => {
    const key = c.req.param("key");
    const previewId = c.req.param("previewId");
    if (!/^[\w.-]+$/.test(key) || !/^[0-9a-f-]{36}$/i.test(previewId)) return c.json({ error: "Vista previa no encontrada." }, 404);
    const modulesDir = await resolveModulesDir();
    if (!modulesDir) return c.json({ error: "Vista previa no encontrada." }, 404);
    const bundlePath = previewBundlePath(modulesDir, key, previewId);
    try {
      const stat = await fs.stat(bundlePath);
      if (Date.now() - stat.mtimeMs > PREVIEW_TTL_MS) return c.json({ error: "La vista previa expiró; vuelve a revisar el ZIP." }, 410);
      const content = await fs.readFile(bundlePath, "utf8");
      c.header("Content-Type", "application/javascript");
      c.header("Cache-Control", "no-store");
      return c.body(content);
    } catch {
      return c.json({ error: "Vista previa no encontrada." }, 404);
    }
  });

  // GET /modules/:key/preview/:previewId/bundle.css — utilities for the
  // preview bundle, written next to it by /upload/check. Empty 200 if absent.
  app.get("/:key/preview/:previewId/bundle.css", async (c) => {
    const key = c.req.param("key");
    const previewId = c.req.param("previewId");
    c.header("Content-Type", "text/css; charset=utf-8");
    c.header("Cache-Control", "no-store");
    if (!/^[\w.-]+$/.test(key) || !/^[0-9a-f-]{36}$/i.test(previewId)) return c.body("");
    const modulesDir = await resolveModulesDir();
    if (!modulesDir) return c.body("");
    const cssPath = path.join(path.dirname(previewBundlePath(modulesDir, key, previewId)), "bundle.css");
    return c.body(await fs.readFile(cssPath, "utf8").catch(() => ""));
  });

  // POST /modules/:key/upload — extract a custom module ZIP to ATLAS_MODULES_DIR
  app.post(
    "/:key/upload",
    authMiddleware,
    requirePermission("core.modules.upload"),
    async (c) => {
      const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
      if (!packageSvc) {
        return c.json({ error: "MODULE_PACKAGE_PUBLISH_UNAVAILABLE" }, 503);
      }

      const modulesDir = await resolveModulesDir();
      if (!modulesDir || !existsSync(modulesDir)) {
        return c.json({ error: "MODULES_DIR_NOT_CONFIGURED" }, 503);
      }

      const body = await c.req.parseBody();
      const file = body.file;
      if (!file || typeof file.arrayBuffer !== "function") {
        return c.json({ error: 'Campo "file" requerido' }, 422);
      }
      if (!file.name?.toLowerCase().endsWith(".zip")) {
        return c.json({ error: "El archivo debe ser un ZIP" }, 422);
      }

      const buffer = Buffer.from(await file.arrayBuffer());

      try {
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const result = await packageSvc.publishZip({
          key,
          fileBuffer: buffer,
          modulesDir,
          actorId,
        });
        // Builder projects keep React-screen-only changes and switch to
        // developer mode for anything else, so a Builder publish never
        // overwrites hand-written code (module-builder-package-sync.js).
        const builder = await createBuilderPackageSync({ prisma })
          .afterUpload({ moduleKey: key, dir: path.join(modulesDir, key), outcome: result.outcome, actorId })
          .catch(() => ({}));
        return c.json({ data: {
          moduleKey: key,
          fileCount: result.inspection.files,
          ...result,
          ...builder,
        } });
      } catch (err) {
        return c.json(
          {
            error: err.code ?? err.message,
            stage: err.stage ?? err.details?.stage ?? null,
            details: err.details ?? null,
          },
          err.statusCode ?? 500,
        );
      }
    },
  );

  // DELETE /modules/:key/purge — verified hard purge of every owned module resource
  app.post(
    "/:key/purge/dry-run",
    authMiddleware,
    requirePermission("core.modules.purge"),
    async (c) => {
      if (!purgeSvc) return c.json({ error: "MODULE_PURGE_UNAVAILABLE" }, 503);
      const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
      try {
        return c.json({ data: await purgeSvc.dryRunHardPurge({ key }) });
      } catch (err) {
        return c.json(
          { error: err.message, details: err.details ?? null },
          err.statusCode ?? err.status ?? 500,
        );
      }
    },
  );

  app.delete(
    "/:key/purge",
    authMiddleware,
    requirePermission("core.modules.purge"),
    async (c) => {
      if (!purgeSvc) return c.json({ error: "MODULE_PURGE_UNAVAILABLE" }, 503);
      const key = await resolvePersistedModuleKey(prisma, c.req.param("key"));
      try {
        const body = await c.req.json().catch(() => ({}));
        const actorId = c.get("userContext")?.profile?.id ?? null;
        const data = await purgeSvc.hardPurgeModule({
          key,
          actorId,
          confirmation: body?.confirmation ?? null,
        });
        return c.json({ data });
      } catch (err) {
        return c.json(
          { error: err.message, details: err.details ?? null },
          err.statusCode ?? err.status ?? 500,
        );
      }
    },
  );

  return app;
}
