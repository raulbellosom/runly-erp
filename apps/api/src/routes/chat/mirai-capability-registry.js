// apps/api/src/routes/chat/mirai-capability-registry.js
//
// Module capabilities MirAI can use (spec 2026-09-30-mirai-global-capabilities
// §5): read tools, confirmable actions and page-context descriptions. A module
// is available when it is INSTALLED + enabled and the caller holds at least one
// of its tool/action permissions in the ACTIVE company.
import { hasScopedPermission } from "./mirai-scoped-context.js";
import { buildActionContext } from "./mirai-proposal-service.js";

const MODULE_CACHE_MS = 30_000;

export function createMiraiCapabilityRegistry({ prisma, resolveScopedErpContext, capabilities }) {
  const byModule = new Map(capabilities.map((c) => [c.moduleKey, c]));
  const actionModule = new Map(capabilities.flatMap((c) => (c.actions ?? []).map((a) => [a.key, c.moduleKey])));
  let moduleCache = { at: 0, keys: new Set() };

  async function enabledModuleKeys() {
    if (Date.now() - moduleCache.at < MODULE_CACHE_MS) return moduleCache.keys;
    const rows = await prisma.runlyModule.findMany({
      where: { key: { in: [...byModule.keys()] }, status: "INSTALLED", enabled: true },
      select: { key: true },
    });
    moduleCache = { at: Date.now(), keys: new Set(rows.map((r) => r.key)) };
    return moduleCache.keys;
  }

  function allowedPart(cap, scope) {
    return {
      moduleKey: cap.moduleKey,
      label: cap.label,
      summary: cap.summary,
      tools: (cap.tools ?? []).filter((t) => hasScopedPermission(scope, t.permission)),
      actions: (cap.actions ?? []).filter((a) => hasScopedPermission(scope, a.permission)),
      describeContext: cap.describeContext ?? null,
    };
  }

  // -> { scope, modules } | { error }
  async function listModules(ctx) {
    const scope = await resolveScopedErpContext(ctx);
    if (scope.error) return scope;
    const enabled = await enabledModuleKeys();
    const modules = capabilities
      .filter((c) => enabled.has(c.moduleKey))
      .map((c) => allowedPart(c, scope))
      .filter((m) => m.tools.length || m.actions.length);
    return { scope, modules };
  }

  // -> { scope, module } | { error }
  async function getModule(ctx, moduleKey) {
    const out = await listModules(ctx);
    if (out.error) return out;
    const module = out.modules.find((m) => m.moduleKey === moduleKey);
    if (!module) {
      return { error: `Modulo no disponible. Disponibles: ${out.modules.map((m) => m.moduleKey).join(", ") || "ninguno"}.` };
    }
    return { scope: out.scope, module };
  }

  // Action lookup used by the proposal service (same contract as before).
  async function resolve(ctx, key) {
    const moduleKey = actionModule.get(key);
    if (!moduleKey) return { error: "Accion desconocida." };
    const out = await getModule(ctx, moduleKey);
    if (out.error) return { error: "No tienes permiso para esa accion o el modulo no esta activo." };
    const action = out.module.actions.find((a) => a.key === key);
    if (!action) return { error: "No tienes permiso para esa accion o el modulo no esta activo." };
    return { scope: out.scope, action };
  }

  // -> one Spanish line or null. Never throws.
  async function describeContext(ctx, pageContext) {
    if (!pageContext?.moduleKey) return null;
    try {
      const out = await getModule(ctx, pageContext.moduleKey);
      if (out.error) return null;
      if ((!pageContext.recordId && !pageContext.selection) || !out.module.describeContext) return `El usuario esta en el modulo ${out.module.label}.`;
      const line = await out.module.describeContext(pageContext, buildActionContext(prisma, out.scope, ctx));
      return line ?? `El usuario esta en el modulo ${out.module.label}.`;
    } catch {
      return null;
    }
  }

  return { listModules, getModule, resolve, describeContext };
}
