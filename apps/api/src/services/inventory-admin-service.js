// inventory-admin-service.js — administrative status of inventory items
// (alta / baja) as a state machine with a formal event ledger. The
// operational `status` (available/assigned/maintenance) is untouched except
// that approving a baja closes the active assignment.
// Spec: docs/superpowers/specs/2026-09-28-inventory-admin-status-design.md
import { z } from 'zod';
import { createActivityService } from './activity-service.js';
import { createActivityBridge } from './activity-bridge.js';
import { InventoryServiceError, assertCompany } from './inventory-guards.js';

export const ADMIN_STATUSES = ['registration_pending', 'registered', 'deregistration_proposed', 'deregistered'];
export const ADMIN_STATUS_LABELS = {
  registration_pending: 'Pendiente de alta',
  registered: 'Alta',
  deregistration_proposed: 'Propuesta de baja',
  deregistered: 'Baja',
};
// Items listed when no adminStatus filter is given.
export const DEFAULT_LISTED_ADMIN_STATUSES = ['registered', 'deregistration_proposed'];
export const DEREGISTRATION_REASONS = ['obsolescence', 'damage', 'loss', 'theft', 'sale', 'donation', 'destruction', 'other'];

export const ADMIN_TRANSITIONS = {
  confirm_registration: { from: 'registration_pending', to: 'registered', permission: 'inventory.item.register', requires: ['effectiveDate'] },
  propose_deregistration: { from: 'registered', to: 'deregistration_proposed', permission: 'inventory.item.update', requires: ['reason'] },
  approve_deregistration: { from: 'deregistration_proposed', to: 'deregistered', permission: 'inventory.item.deregister', requires: ['effectiveDate'] },
  reject_deregistration: { from: 'deregistration_proposed', to: 'registered', permission: 'inventory.item.deregister', requires: ['comment'] },
  revert_deregistration: { from: 'deregistered', to: 'registered', permission: 'inventory.item.deregister', requires: ['comment'] },
};

const REQUIRED_MESSAGES = {
  effectiveDate: 'Indica la fecha efectiva.',
  reason: 'Indica el motivo de la baja.',
  comment: 'Escribe un comentario.',
};

export const adminTransitionSchema = z.object({
  action: z.enum(Object.keys(ADMIN_TRANSITIONS)),
  reason: z.enum(DEREGISTRATION_REASONS).nullish(),
  comment: z.string().trim().max(2000).nullish(),
  effectiveDate: z.iso.date().nullish(),
  fileId: z.uuid().nullish(),
});

// Legacy operational statuses folded into a baja by the 20260929 migration.
export function legacyStatusReason(status) {
  return { retired: 'obsolescence', lost: 'loss', stolen: 'theft', disposed: 'destruction' }[status] ?? null;
}

export function createInventoryAdminService({ prisma, activityBridge, notifier = null }) {
  const bridge = activityBridge ?? createActivityBridge({ prisma, activityService: createActivityService({ prisma }) });

  function validate(action, payload) {
    const parsed = adminTransitionSchema.safeParse({ ...payload, action });
    if (!parsed.success) throw new InventoryServiceError(parsed.error.issues[0]?.message ?? 'Datos no válidos.', 400);
    const rule = ADMIN_TRANSITIONS[action];
    for (const field of rule.requires) {
      if (!parsed.data[field]) throw new InventoryServiceError(REQUIRED_MESSAGES[field], 400);
    }
    return { rule, data: parsed.data };
  }

  // `can(permissionKey)` answers for the acting user (admins: always true).
  async function transition({ itemId, action, payload = {}, companyId, actorId, can }) {
    assertCompany(companyId);
    if (!ADMIN_TRANSITIONS[action]) throw new InventoryServiceError('Acción no válida.', 400);
    const { rule, data } = validate(action, payload);
    if (!can(rule.permission)) throw new InventoryServiceError('No tienes permiso para esta acción.', 403);
    if (data.fileId) {
      const file = await prisma.fileAsset.findFirst({ where: { id: data.fileId, entityId: companyId }, select: { id: true } });
      if (!file) throw new InventoryServiceError('La evidencia no pertenece a la empresa actual.', 400);
    }

    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.invItem.findFirst({ where: { id: itemId, companyId, enabled: true } });
      if (!item) throw new InventoryServiceError('Activo no encontrado.', 404);
      if (item.adminStatus !== rule.from) {
        throw new InventoryServiceError(`El activo está en «${ADMIN_STATUS_LABELS[item.adminStatus] ?? item.adminStatus}»; esta acción no aplica.`, 409);
      }
      const effectiveDate = data.effectiveDate ? new Date(`${data.effectiveDate}T00:00:00Z`) : null;
      const update = { adminStatus: rule.to };
      if (action === 'confirm_registration') update.registeredAt = effectiveDate;
      if (action === 'propose_deregistration') update.deregistrationReason = data.reason;
      if (action === 'reject_deregistration') update.deregistrationReason = null;
      if (action === 'revert_deregistration') Object.assign(update, { deregisteredAt: null, deregistrationReason: null });
      if (action === 'approve_deregistration') {
        await tx.invAssignment.updateMany({ where: { itemId, returnedAt: null }, data: { returnedAt: new Date() } });
        Object.assign(update, {
          deregisteredAt: effectiveDate,
          deregistrationReason: data.reason ?? item.deregistrationReason ?? 'other',
          status: 'available',
          assignedToId: null,
          assignedAt: null,
        });
      }
      const updated = await tx.invItem.update({ where: { id: itemId }, data: update });
      const event = await tx.invItemAdminEvent.create({
        data: {
          companyId, itemId, action, fromStatus: rule.from, toStatus: rule.to,
          reason: action === 'approve_deregistration' ? update.deregistrationReason : (data.reason ?? null),
          comment: data.comment || null, effectiveDate, fileId: data.fileId ?? null, actorId: actorId ?? null,
        },
      });
      return { item: updated, event };
    });

    await bridge.logAndPublish({
      auditEntry: {
        actorId: actorId ?? 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: itemId,
        action: `inventory.item.${action}`,
        before: { adminStatus: ADMIN_STATUS_LABELS[rule.from] },
        after: { adminStatus: ADMIN_STATUS_LABELS[rule.to], name: result.item.name },
      },
      hint: { verb: 'updated', label: result.item.name ?? itemId },
      companyId,
    }).catch(() => {});
    if (action === 'propose_deregistration') {
      try { await notifier?.notifyDeregistrationProposed({ companyId, actorId, item: result.item, reason: data.reason }); } catch { /* best effort */ }
    }
    return result;
  }

  async function bulkTransition({ ids, action, payload, companyId, actorId, can }) {
    if (!Array.isArray(ids) || ids.length === 0) throw new InventoryServiceError('Selecciona al menos un activo.', 400);
    if (ids.length > 200) throw new InventoryServiceError('Máximo 200 activos por operación.', 400);
    // Validate once up front so a bad payload fails the whole request.
    const { rule } = validate(action, payload);
    if (!can(rule.permission)) throw new InventoryServiceError('No tienes permiso para esta acción.', 403);
    const results = [];
    for (const id of [...new Set(ids)]) {
      try {
        await transition({ itemId: id, action, payload, companyId, actorId, can });
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err?.message ?? 'No se pudo aplicar.' });
      }
    }
    return { results, applied: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  async function listEvents(itemId, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId }, select: { id: true } });
    if (!item) throw new InventoryServiceError('Activo no encontrado.', 404);
    const rows = await prisma.invItemAdminEvent.findMany({
      where: { itemId, companyId },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { id: true, displayName: true, firstName: true, lastName: true } } },
    });
    return rows.map(({ actor, ...row }) => ({
      ...row,
      actorName: actor ? (actor.displayName || [actor.firstName, actor.lastName].filter(Boolean).join(' ')) : null,
    }));
  }

  async function summary(companyId) {
    assertCompany(companyId);
    const where = { companyId, enabled: true };
    const [byAdmin, byCondition, byStatus, conditions, proposals] = await Promise.all([
      prisma.invItem.groupBy({ by: ['adminStatus'], where, _count: { _all: true } }),
      prisma.invItem.groupBy({ by: ['conditionId'], where: { ...where, adminStatus: { not: 'deregistered' } }, _count: { _all: true } }),
      prisma.invItem.groupBy({ by: ['status'], where: { ...where, adminStatus: { not: 'deregistered' } }, _count: { _all: true } }),
      prisma.invCondition.findMany({ where: { companyId }, select: { id: true, name: true, color: true, sortOrder: true } }),
      prisma.invItem.findMany({
        where: { ...where, adminStatus: 'deregistration_proposed' },
        select: { id: true, name: true, assetTag: true, deregistrationReason: true, updatedAt: true },
        orderBy: { updatedAt: 'asc' },
        take: 10,
      }),
    ]);
    const adminCounts = Object.fromEntries(ADMIN_STATUSES.map((s) => [s, 0]));
    for (const row of byAdmin) adminCounts[row.adminStatus] = row._count._all;
    const conditionById = new Map(conditions.map((c) => [c.id, c]));
    return {
      total: Object.values(adminCounts).reduce((a, b) => a + b, 0),
      byAdminStatus: adminCounts,
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      byCondition: byCondition
        .map((row) => {
          const c = row.conditionId ? conditionById.get(row.conditionId) : null;
          return { id: row.conditionId, name: c?.name ?? 'Sin condición', color: c?.color ?? null, sortOrder: c?.sortOrder ?? 9999, count: row._count._all };
        })
        .sort((a, b) => a.sortOrder - b.sortOrder),
      pendingProposals: proposals,
    };
  }

  return { transition, bulkTransition, listEvents, summary };
}
