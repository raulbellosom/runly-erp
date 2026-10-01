// apps/api/src/routes/chat/mirai-action-registry.js
//
// Confirmable write actions modules expose to MirAI (spec
// docs/superpowers/specs/2026-09-30-mirai-actions-design.md §6). An action is
// available only when its module is INSTALLED + enabled on this instance and
// the caller holds its permission in the ACTIVE company.
import { hasScopedPermission } from "./mirai-scoped-context.js";

const MODULE_CACHE_MS = 30_000;

export function createMiraiActionRegistry({ prisma, resolveScopedErpContext, actions }) {
  const byKey = new Map(actions.map((a) => [a.key, a]));
  const moduleKeys = [...new Set(actions.map((a) => a.moduleKey))];
  let moduleCache = { at: 0, keys: new Set() };

  async function enabledModuleKeys() {
    if (Date.now() - moduleCache.at < MODULE_CACHE_MS) return moduleCache.keys;
    const rows = await prisma.runlyModule.findMany({
      where: { key: { in: moduleKeys }, status: "INSTALLED", enabled: true },
      select: { key: true },
    });
    moduleCache = { at: Date.now(), keys: new Set(rows.map((r) => r.key)) };
    return moduleCache.keys;
  }

  // -> { scope, actions } | { error }. `scope` is the company-scoped context.
  async function listAvailable(ctx) {
    const scope = await resolveScopedErpContext(ctx);
    if (scope.error) return scope;
    const modules = await enabledModuleKeys();
    return {
      scope,
      actions: actions.filter((a) => modules.has(a.moduleKey) && hasScopedPermission(scope, a.permission)),
    };
  }

  // -> { scope, action } | { error }
  async function resolve(ctx, key) {
    const out = await listAvailable(ctx);
    if (out.error) return out;
    const action = out.actions.find((a) => a.key === key);
    if (!action) {
      return { error: byKey.has(key) ? "No tienes permiso para esa accion o el modulo no esta activo." : "Accion desconocida." };
    }
    return { scope: out.scope, action };
  }

  return { listAvailable, resolve };
}
