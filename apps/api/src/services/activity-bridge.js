// Activity Bridge: translates AuditLog entries to user-facing Activity records.
// Registers translators by `action` prefix. `logAndPublish` writes an AuditLog
// and best-effort publishes a matching Activity (failures NEVER break business mutations).

function safeStr(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function actorName(actor) {
  if (!actor) return "Sistema";
  return (
    actor.displayName ||
    [actor.firstName, actor.lastName].filter(Boolean).join(" ").trim() ||
    "Sistema"
  );
}

// Each translator returns either null (skip) or an object
// { type, summary, severity?, link?, payload? } merged into the activity.
const TRANSLATORS = {
  "hr.employee.create": ({ actor, entityId, after }) => ({
    type: "hr.employee.create",
    summary:
      `${actorName(actor)} creó al colaborador ${safeStr(after?.firstName)} ${safeStr(after?.lastName)}`.trim(),
    severity: "success",
    link: entityId ? `/hr/employees/${entityId}` : undefined,
  }),
  "hr.employee.update": ({ actor, entityId, after }) => ({
    type: "hr.employee.update",
    summary:
      `${actorName(actor)} actualizó al colaborador ${safeStr(after?.firstName)} ${safeStr(after?.lastName)}`.trim(),
    severity: "info",
    link: entityId ? `/hr/employees/${entityId}` : undefined,
  }),
  "hr.employee.setEnabled": ({ actor, entityId, after }) => ({
    type: "hr.employee.setEnabled",
    summary: `${actorName(actor)} ${after?.enabled ? "habilitó" : "deshabilitó"} al colaborador`,
    severity: after?.enabled ? "success" : "warning",
    link: entityId ? `/hr/employees/${entityId}` : undefined,
  }),
  "contacts.contact.create": ({ actor, entityId, after }) => ({
    type: "contacts.contact.create",
    summary: `${actorName(actor)} creó el contacto ${safeStr(after?.name)}`,
    severity: "success",
    link: entityId ? `/contacts/${entityId}` : undefined,
  }),
  "contacts.contact.update": ({ actor, entityId, after }) => ({
    type: "contacts.contact.update",
    summary: `${actorName(actor)} actualizó el contacto ${safeStr(after?.name)}`,
    severity: "info",
    link: entityId ? `/contacts/${entityId}` : undefined,
  }),
  "files.assets.upload": ({ actor, after }) => ({
    type: "files.assets.upload",
    summary: `${actorName(actor)} subió el archivo ${safeStr(after?.fileName)}`,
    severity: "info",
  }),
  "company.profile.update": ({ actor }) => ({
    type: "company.profile.update",
    summary: `${actorName(actor)} actualizó el perfil de la empresa`,
    severity: "info",
  }),
  "core.module.install": ({ actor, after }) => ({
    type: "core.module.install",
    summary: `${actorName(actor)} instaló el módulo ${safeStr(after?.key)}`,
    severity: "success",
  }),
  "core.module.uninstall": ({ actor, after }) => ({
    type: "core.module.uninstall",
    summary: `${actorName(actor)} desinstaló el módulo ${safeStr(after?.key)}`,
    severity: "warning",
  }),
  "catalog.product.create": ({ actor, entityId, after }) => ({
    type: "catalog.product.create",
    summary: `${actorName(actor)} creó el producto ${safeStr(after?.name)}`,
    severity: "success",
    link: entityId ? `/m/runly.catalog/${entityId}` : undefined,
  }),
  "catalog.product.update": ({ actor, entityId, after }) => ({
    type: "catalog.product.update",
    summary: `${actorName(actor)} actualizó el producto ${safeStr(after?.name)}`,
    severity: "info",
    link: entityId ? `/m/runly.catalog/${entityId}` : undefined,
  }),
  "catalog.product.publish": ({ actor, entityId, after }) => ({
    type: "catalog.product.publish",
    summary: `${actorName(actor)} publicó el producto ${safeStr(after?.name)}`,
    severity: "success",
    link: entityId ? `/m/runly.catalog/${entityId}` : undefined,
  }),
  "catalog.product.unpublish": ({ actor, entityId, after }) => ({
    type: "catalog.product.unpublish",
    summary: `${actorName(actor)} despublicó el producto ${safeStr(after?.name)}`,
    severity: "warning",
    link: entityId ? `/m/runly.catalog/${entityId}` : undefined,
  }),
  "catalog.product.delete": ({ actor }) => ({
    type: "catalog.product.delete",
    summary: `${actorName(actor)} eliminó un producto`,
    severity: "warning",
  }),
  "catalog.category.create": ({ actor, after }) => ({
    type: "catalog.category.create",
    summary: `${actorName(actor)} creó la categoría ${safeStr(after?.name)}`,
    severity: "success",
    link: "/m/runly.catalog/categories",
  }),
  "catalog.category.update": ({ actor, after }) => ({
    type: "catalog.category.update",
    summary: `${actorName(actor)} actualizó la categoría ${safeStr(after?.name)}`,
    severity: "info",
    link: "/m/runly.catalog/categories",
  }),
  "catalog.category.delete": ({ actor }) => ({
    type: "catalog.category.delete",
    summary: `${actorName(actor)} eliminó una categoría`,
    severity: "warning",
  }),
  "catalog.stock.adjust": ({ actor, entityId }) => ({
    type: "catalog.stock.adjust",
    summary: `${actorName(actor)} registró un ajuste de stock`,
    severity: "info",
    link: entityId ? `/m/runly.catalog/${entityId}` : undefined,
  }),
  "inventory.item.created": ({ actor, entityId, after }) => ({
    type: "inventory.item.created",
    summary: `${actorName(actor)} dio de alta el activo ${safeStr(after?.name)}`.trim(),
    severity: "success",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
  "inventory.item.updated": ({ actor, entityId, after }) => ({
    type: "inventory.item.updated",
    summary: `${actorName(actor)} actualizó el activo ${safeStr(after?.name)}`.trim(),
    severity: "info",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
  "inventory.item.assigned": ({ actor, entityId, after }) => ({
    type: "inventory.item.assigned",
    summary: `${actorName(actor)} asignó el activo ${safeStr(after?.name)}`.trim(),
    severity: "success",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
  "inventory.item.returned": ({ actor, entityId, after }) => ({
    type: "inventory.item.returned",
    summary: `${actorName(actor)} registró la devolución del activo ${safeStr(after?.name)}`.trim(),
    severity: "info",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
  "inventory.item.deleted": ({ actor, entityId, after }) => ({
    type: "inventory.item.deleted",
    summary: `${actorName(actor)} dio de baja el activo ${safeStr(after?.name)}`.trim(),
    severity: "warning",
    link: entityId ? `/app/m/runly.inventory/inventory/${entityId}` : undefined,
  }),
};

export function registerTranslator(action, translator) {
  TRANSLATORS[action] = translator;
}

export function getTranslator(action) {
  return TRANSLATORS[action] ?? null;
}

const NEVER_DIFF_FIELDS = new Set(["id", "companyId", "createdAt", "updatedAt", "enabled"]);

// Compares two flat, JSON-serializable snapshots and returns only the fields
// whose value actually changed (string-compared, so type/format differences
// like a Date object vs. its own ISO string never register as a false
// change). Pure and side-effect-free so any service can call it directly, and
// publishFromAudit below uses it to auto-attach payload.changes whenever a
// caller passes full snapshots instead of today's partial hints — see
// docs/superpowers/specs/2026-09-15-inventory-modification-history-design.md.
export function computeFieldChanges(before, after) {
  if (!before || typeof before !== "object" || !after || typeof after !== "object") {
    return [];
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const key of keys) {
    if (NEVER_DIFF_FIELDS.has(key)) continue;
    const oldValue = before[key] ?? null;
    const newValue = after[key] ?? null;
    const oldStr = oldValue === null ? "" : String(oldValue);
    const newStr = newValue === null ? "" : String(newValue);
    if (oldStr === newStr) continue;
    changes.push({ field: key, oldValue, newValue });
  }
  return changes;
}

export function createActivityBridge({ activityService, prisma }) {
  async function resolveActor(actorId) {
    if (!actorId) return null;
    try {
      return await prisma.userProfile.findUnique({
        where: { id: actorId },
        select: {
          id: true,
          displayName: true,
          firstName: true,
          lastName: true,
        },
      });
    } catch {
      return null;
    }
  }

  async function publishFromAudit({ auditEntry, hint, companyId }) {
    if (!companyId) return null;
    const actor = await resolveActor(auditEntry.actorId);
    const translator = getTranslator(auditEntry.action);
    let base = null;
    if (translator) {
      try {
        base = translator({
          actor,
          entityId: auditEntry.entityId,
          entityType: auditEntry.entityType,
          before: auditEntry.before,
          after: auditEntry.after,
          metadata: auditEntry.metadata,
        });
      } catch {
        base = null;
      }
    }
    if (!base && !hint) {
      // Ningún translator registrado y sin hint: no publicamos para evitar spam.
      return null;
    }
    const changes = computeFieldChanges(auditEntry.before, auditEntry.after);
    const payload = {
      ...(hint?.payload ?? base?.payload ?? null),
      ...(changes.length > 0 ? { changes } : {}),
    };
    const merged = {
      ...base,
      ...hint,
      type: hint?.type ?? base?.type ?? auditEntry.action ?? "system.event",
      summary:
        hint?.summary ??
        base?.summary ??
        `${actorName(actor)} realizó ${auditEntry.action}`,
      severity: hint?.severity ?? base?.severity ?? "info",
      link: hint?.link ?? base?.link,
      payload: Object.keys(payload).length > 0 ? payload : undefined,
      entityType: hint?.entityType ?? auditEntry.entityType ?? base?.entityType,
      entityId: hint?.entityId ?? auditEntry.entityId ?? base?.entityId,
      companyId,
      actorId: auditEntry.actorId ?? null,
    };
    return activityService.publish({ ...merged, source: "audit_bridge" });
  }

  // logAndPublish: writes AuditLog row + best-effort publishes Activity.
  // `auditEntry` shape matches Prisma AuditLog.create({ data }).
  // `companyId` is required for the activity (audit_log does not store it).
  async function logAndPublish({ auditEntry, hint, companyId }) {
    const audit = await prisma.auditLog.create({ data: auditEntry });
    try {
      await publishFromAudit({ auditEntry: audit, hint, companyId });
    } catch (err) {
      // Best-effort: log a console warning but never throw.
      if (typeof console !== "undefined" && console.warn) {
        console.warn("[activity-bridge] publish failed:", err?.message ?? err);
      }
    }
    return audit;
  }

  return {
    publishFromAudit,
    logAndPublish,
    registerTranslator,
    getTranslator,
  };
}
