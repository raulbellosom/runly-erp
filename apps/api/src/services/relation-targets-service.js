// System entities a Builder module can relate to (Flotilla, Inventario,
// Contactos, RR.HH., Proyectos, Calendario, Cuentas, Archivos): the catalog,
// a search per type for relation pickers, and batch resolution (label, detail
// and link) for validation and display. Resolution reuses the chat
// entity-reference resolvers, so permissions, company scope and per-user
// visibility (project/task members, calendar shares, ledger members, file
// access) are the owning module's own.
// See docs/superpowers/specs/2026-09-28-rme3-builder-external-relations-design.md.
import { EXTERNAL_RELATION_TARGETS, externalTarget } from "@runly/module-compiler";
import { createUserAccessService } from "./user-access-service.js";
import { createContactsService } from "./contacts-service.js";
import { createFilesService } from "./files-service.js";
import { createHrService } from "./hr-service.js";
import { createInventoryService } from "./inventory-service.js";
import { createLedgerService } from "../routes/ledger/ledger-service.js";
import { createProjectsService } from "../routes/projects/projects-service.js";
import { createTasksService } from "../routes/projects/tasks-service.js";
import { createCalendarEventService } from "../routes/calendar/calendar-event-service.js";
import { createFleetService } from "../routes/fleet/fleet-service.js";
import { createChatEntityReferencesService } from "../routes/chat/chat-entity-references-service.js";

const SEARCH_LIMIT = 20;
const contains = (value) => ({ contains: value, mode: "insensitive" });
const matches = (text, q) => !q || String(text ?? "").toLowerCase().includes(q.toLowerCase());

export class RelationTargetError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function createRelationTargetsService({ prisma, supabaseAdmin = null, services = {} }) {
  const access = services.access ?? createUserAccessService({ prisma });
  const svc = {
    contactsService: services.contactsService ?? createContactsService({ prisma }),
    filesService: services.filesService ?? createFilesService({ prisma, supabaseAdmin }),
    hrService: services.hrService ?? createHrService({ prisma }),
    ledgerService: services.ledgerService ?? createLedgerService({ prisma }),
    projectsService: services.projectsService ?? createProjectsService({ prisma }),
    tasksService: services.tasksService ?? createTasksService({ prisma }),
    calendarEventService: services.calendarEventService ?? createCalendarEventService({ prisma }),
    fleetService: services.fleetService ?? createFleetService({ prisma }),
    inventoryService: services.inventoryService ?? createInventoryService({ prisma }),
  };
  const references = services.references ?? createChatEntityReferencesService({ prisma, ...svc });

  async function profileIdOf(authUserId) {
    const profile = await prisma.userProfile.findUnique({ where: { authUserId }, select: { id: true } });
    if (!profile) throw new RelationTargetError("No autorizado.", 401);
    return profile.id;
  }

  function targetOf(type) {
    const target = externalTarget(type);
    if (!target) throw new RelationTargetError("Tipo de relación desconocido.", 404);
    return target;
  }

  async function assertAllowed(companyId, profileId, target) {
    try {
      await access.assertCompanyMember(companyId, profileId, target.permission);
    } catch {
      throw new RelationTargetError(`No tienes permiso para ver ${target.pluralLabel.toLowerCase()}.`, 403);
    }
  }

  // For the Builder: every type, whether its module is installed.
  async function catalog() {
    const installed = new Set((await prisma.runlyModule.findMany({
      where: { status: "INSTALLED", enabled: true },
      select: { key: true },
    })).map((row) => row.key));
    return Object.entries(EXTERNAL_RELATION_TARGETS).map(([type, target]) => ({
      type,
      label: target.label,
      pluralLabel: target.pluralLabel,
      module: target.module,
      moduleName: target.moduleName,
      permission: target.permission,
      installed: installed.has(target.module),
    }));
  }

  const searchers = {
    async contact({ companyId, q, limit }) {
      const rows = await prisma.contact.findMany({
        where: { companyId, enabled: true, ...(q ? { OR: [{ name: contains(q) }, { email: contains(q) }, { phone: contains(q) }] } : {}) },
        select: { id: true, name: true, email: true, phone: true },
        orderBy: { name: "asc" },
        take: limit,
      });
      return rows.map((row) => ({ id: row.id, title: row.name, subtitle: row.phone ?? row.email ?? null }));
    },
    async hr_employee({ companyId, q, limit }) {
      const rows = await prisma.hrEmployee.findMany({
        where: { companyId, enabled: true, ...(q ? { OR: [{ firstName: contains(q) }, { lastName: contains(q) }] } : {}) },
        select: { id: true, firstName: true, lastName: true, jobTitle: true },
        orderBy: { firstName: "asc" },
        take: limit,
      });
      return rows.map((row) => ({ id: row.id, title: `${row.firstName} ${row.lastName}`.trim(), subtitle: row.jobTitle ?? null }));
    },
    async vehicle({ companyId, q, limit }) {
      const result = await svc.fleetService.listVehicles({ companyId, page: 1, pageSize: limit, search: q || undefined });
      return (result.data ?? []).map((row) => {
        const model = [row.vehicle_brand_name ?? row.brand, row.vehicle_model_name ?? row.model_name, row.vehicle_model_year ?? row.year].filter(Boolean).join(" ");
        return { id: row.id, title: row.plate || model || "Vehículo", subtitle: model || null };
      });
    },
    async inventory_item({ companyId, q, limit }) {
      const result = await svc.inventoryService.listItems({ companyId, search: q || undefined, limit });
      return (result.data ?? []).map((row) => ({ id: row.id, title: row.name, subtitle: [row.assetTag, row.categoryName].filter(Boolean).join(" · ") || null }));
    },
    async project({ companyId, profileId, q, limit }) {
      const rows = await svc.projectsService.listProjects(companyId, profileId);
      return rows.filter((row) => matches(row.name, q)).slice(0, limit).map((row) => ({ id: row.id, title: row.name, subtitle: null }));
    },
    async task({ companyId, profileId, q, limit }) {
      const rows = await prisma.task.findMany({
        where: {
          ...(q ? { title: contains(q) } : {}),
          project: { companyId, OR: [{ ownerId: profileId }, { members: { some: { userId: profileId } } }] },
        },
        select: { id: true, title: true, project: { select: { name: true } } },
        orderBy: { updatedAt: "desc" },
        take: limit,
      });
      return rows.map((row) => ({ id: row.id, title: row.title, subtitle: row.project?.name ?? null }));
    },
    async calendar_event({ companyId, profileId, q, limit }) {
      const calendarIds = await svc.calendarEventService.getAccessibleCalendarIds(profileId, companyId);
      if (!calendarIds.length) return [];
      const rows = await prisma.calendarEvent.findMany({
        where: { calendarId: { in: calendarIds }, enabled: true, ...(q ? { title: contains(q) } : {}) },
        select: { id: true, title: true, startAt: true },
        orderBy: { startAt: "desc" },
        take: limit,
      });
      return rows.map((row) => ({ id: row.id, title: row.title, subtitle: row.startAt ? new Date(row.startAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" }) : null }));
    },
    async ledger_account({ companyId, profileId, q, limit }) {
      const rows = await svc.ledgerService.listAccounts({ companyId, actorId: profileId });
      return rows
        .filter((row) => matches(`${row.name} ${row.bank ?? ""}`, q))
        .slice(0, limit)
        .map((row) => ({ id: row.id, title: row.bank ? `${row.name} · ${row.bank}` : row.name, subtitle: row.account_number ? `····${String(row.account_number).slice(-4)}` : null }));
    },
    async file({ authUserId, companyId, profileId, q, limit, target }) {
      const result = await svc.filesService.list({
        authUserId,
        activeContext: { profileId, companyId, isAdmin: false, permissionSet: new Set([target.permission]) },
        query: { q: q || undefined, pageSize: limit, page: 1 },
      });
      return (result.data ?? []).map((row) => ({ id: row.id, title: row.originalName, subtitle: row.mimeType ?? null }));
    },
  };

  async function search({ authUserId, companyId, type, q = "", limit = SEARCH_LIMIT }) {
    const target = targetOf(type);
    if (!companyId) throw new RelationTargetError("Selecciona una empresa activa.", 400);
    const profileId = await profileIdOf(authUserId);
    await assertAllowed(companyId, profileId, target);
    const query = String(q ?? "").trim().slice(0, 100);
    const safeLimit = Math.min(Math.max(Number(limit) || SEARCH_LIMIT, 1), 50);
    return searchers[type]({ authUserId, companyId, profileId, q: query, limit: safeLimit, target });
  }

  // Map id -> { title, subtitle, url } for the records the user can see.
  async function resolve({ authUserId, companyId, type, ids }) {
    targetOf(type);
    const unique = [...new Set((ids ?? []).filter(Boolean).map(String))];
    if (!companyId || !unique.length) return new Map();
    const resolved = await references.resolveReferences({
      authUserId,
      companyId,
      refs: unique.map((recordId) => ({ entityType: type, recordId })),
    });
    return new Map(resolved.map((ref) => [String(ref.recordId), { title: ref.title, subtitle: ref.subtitle ?? null, url: ref.url ?? null }]));
  }

  // moduleContext.relations for RME3 modules (bound to the Hono context).
  function capability() {
    return {
      resolve: (c, type, ids) => resolve({ authUserId: c.get("authUserId"), companyId: c.get("companyId"), type, ids }),
    };
  }

  return { catalog, search, resolve, capability };
}
