// apps/api/src/routes/projects/projects-mirai-queries.js
//
// Exact runly.projects read tools for MirAI (spec
// 2026-09-30-mirai-remaining-modules §3): list/search tasks across the
// caller's projects, exact task summary, and project list with progress.
// Scoped to projects the caller owns or is a member of (projectsSvc.listProjects),
// same as the project list screen. Totals are computed in Prisma, never left
// for the model to add up from a partial list.
import { zonedLocalToDate, toLocalIso } from "@runly/core";

const LIST_MAX = 30;
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW", "NONE"];

function todayStart() {
  return zonedLocalToDate(toLocalIso());
}

async function accessibleProjectIds(projectsSvc, companyId, userId) {
  const projects = await projectsSvc.listProjects(companyId, userId);
  return { projects, ids: projects.map((p) => p.id) };
}

async function matchProjectId(projects, name) {
  if (!name) return { ids: projects.map((p) => p.id) };
  const q = String(name).trim().toLowerCase();
  const exact = projects.filter((p) => p.name.toLowerCase() === q);
  const matches = exact.length ? exact : projects.filter((p) => p.name.toLowerCase().includes(q));
  if (matches.length === 1) return { ids: [matches[0].id], project: matches[0] };
  if (!matches.length) return { error: `No encontre el proyecto "${name}". Tus proyectos: ${projects.map((p) => p.name).join(", ") || "(ninguno)"}.` };
  return { error: `Hay varios proyectos que coinciden: ${matches.map((p) => p.name).join(", ")}.` };
}

export function createProjectsMiraiQueries({ prisma, projectsSvc }) {
  async function resolveAssignee(companyId, name) {
    if (!name || name.toLowerCase() === "yo" || name.toLowerCase() === "me") return { ids: null, userId: null };
    const users = await prisma.userProfile.findMany({
      where: {
        enabled: true,
        isBot: false,
        memberships: { some: { companyId, enabled: true } },
        OR: [
          { email: { equals: name, mode: "insensitive" } },
          { displayName: { contains: name, mode: "insensitive" } },
        ],
      },
      select: { id: true, displayName: true },
      take: 5,
    });
    if (users.length === 1) return { userId: users[0].id };
    if (!users.length) return { error: `No encontre a "${name}" en la empresa.` };
    return { error: `Hay varias personas que coinciden con "${name}": ${users.map((u) => u.displayName).join(", ")}.` };
  }

  const projects_list_tasks = {
    name: "projects_list_tasks",
    permission: "projects.task.read",
    definition: {
      description: "Lista o busca tareas en los proyectos del usuario (donde es owner o miembro). Filtra por proyecto, asignado, estado, prioridad, rango de vencimiento, texto libre o vencidas. Devuelve el total exacto y hasta 30 tareas con su taskId.",
      parameters: {
        type: "object",
        properties: {
          project: { type: "string", description: "Nombre del proyecto (opcional; si no se indica busca en todos)." },
          assignee: { type: "string", description: "Nombre, correo o 'yo' para el propio usuario." },
          status: { type: "string", description: "Nombre del estado (columna) a filtrar." },
          priority: { type: "string", enum: PRIORITIES },
          dueFrom: { type: "string", description: "YYYY-MM-DD" },
          dueTo: { type: "string", description: "YYYY-MM-DD" },
          overdue: { type: "boolean", description: "Solo tareas vencidas (fecha de vencimiento pasada y no completadas)." },
          query: { type: "string", description: "Texto libre en titulo o descripcion." },
        },
      },
    },
    async run(args, actx) {
      const { projects, ids } = await accessibleProjectIds(projectsSvc, actx.companyId, actx.actorProfileId);
      if (!ids.length) return { total: 0, tareas: [] };
      const scoped = await matchProjectId(projects, args?.project);
      if (scoped.error) return { error: scoped.error };
      const assignee = await resolveAssignee(actx.companyId, args?.assignee);
      if (assignee.error) return { error: assignee.error };

      const where = { projectId: { in: scoped.ids } };
      if (args?.status) where.status = { name: { contains: String(args.status), mode: "insensitive" } };
      if (args?.priority && PRIORITIES.includes(args.priority)) where.priority = args.priority;
      if (args?.query) {
        const q = String(args.query);
        where.OR = [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
        ];
      }
      const dueDate = {};
      if (args?.dueFrom) dueDate.gte = new Date(args.dueFrom);
      if (args?.dueTo) dueDate.lte = new Date(args.dueTo);
      if (args?.overdue) dueDate.lt = todayStart();
      if (Object.keys(dueDate).length) where.dueDate = dueDate;
      const assigneeId = assignee.userId ?? (args?.assignee?.toLowerCase() === "yo" || args?.assignee?.toLowerCase() === "me" ? actx.actorProfileId : null);
      if (assigneeId) where.assigneeId = assigneeId;
      if (args?.overdue) where.status = { ...(where.status ?? {}), isDone: false };

      const [total, tasks] = await Promise.all([
        prisma.task.count({ where }),
        prisma.task.findMany({
          where,
          take: LIST_MAX,
          orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
          include: {
            project: { select: { name: true } },
            status: { select: { name: true } },
            assignee: { select: { displayName: true } },
          },
        }),
      ]);
      return {
        total,
        tareas: tasks.map((t) => ({
          taskId: t.id,
          titulo: t.title,
          proyecto: t.project?.name ?? null,
          estado: t.status?.name ?? null,
          prioridad: t.priority,
          asignado: t.assignee?.displayName ?? null,
          // eslint-disable-next-line no-restricted-syntax -- dueDate is a @db.Date (date-only); format as UTC calendar date
          vence: t.dueDate ? new Date(t.dueDate).toISOString().slice(0, 10) : null,
        })),
      };
    },
  };

  const projects_task_summary = {
    name: "projects_task_summary",
    permission: "projects.task.read",
    definition: {
      description: "Totales exactos de tareas del usuario en sus proyectos: por estado, por asignado y por proyecto, mas vencidas y que vencen esta semana. Filtra opcionalmente por proyecto.",
      parameters: {
        type: "object",
        properties: { project: { type: "string", description: "Nombre del proyecto (opcional)." } },
      },
    },
    async run(args, actx) {
      const { projects, ids } = await accessibleProjectIds(projectsSvc, actx.companyId, actx.actorProfileId);
      if (!ids.length) return { total: 0, porEstado: [], porAsignado: [], porProyecto: [], vencidas: 0, vencenEstaSemana: 0 };
      const scoped = await matchProjectId(projects, args?.project);
      if (scoped.error) return { error: scoped.error };
      const where = { projectId: { in: scoped.ids }, parentTaskId: null };
      const today = todayStart();
      const weekEnd = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

      const [total, byStatus, byAssignee, byProject, overdue, dueThisWeek] = await Promise.all([
        prisma.task.count({ where }),
        prisma.task.groupBy({ by: ["statusId"], where, _count: { id: true } }),
        prisma.task.groupBy({ by: ["assigneeId"], where, _count: { id: true } }),
        prisma.task.groupBy({ by: ["projectId"], where, _count: { id: true } }),
        prisma.task.count({ where: { ...where, dueDate: { lt: today }, status: { isDone: false } } }),
        prisma.task.count({ where: { ...where, dueDate: { gte: today, lt: weekEnd }, status: { isDone: false } } }),
      ]);
      const [statuses, assignees] = await Promise.all([
        prisma.taskStatus.findMany({ where: { id: { in: byStatus.map((g) => g.statusId).filter(Boolean) } }, select: { id: true, name: true } }),
        prisma.userProfile.findMany({ where: { id: { in: byAssignee.map((g) => g.assigneeId).filter(Boolean) } }, select: { id: true, displayName: true } }),
      ]);
      const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
      return {
        total,
        porEstado: byStatus.map((g) => ({ estado: statuses.find((s) => s.id === g.statusId)?.name ?? "(sin estado)", tareas: g._count.id })),
        porAsignado: byAssignee.map((g) => ({ asignado: assignees.find((u) => u.id === g.assigneeId)?.displayName ?? "(sin asignar)", tareas: g._count.id })),
        porProyecto: byProject.map((g) => ({ proyecto: projectNameById.get(g.projectId) ?? "(desconocido)", tareas: g._count.id })),
        vencidas: overdue,
        vencenEstaSemana: dueThisWeek,
      };
    },
  };

  const projects_list_projects = {
    name: "projects_list_projects",
    permission: "projects.project.read",
    definition: {
      description: "Lista los proyectos del usuario (owner o miembro) con su progreso exacto (tareas completadas / total). Devuelve el total de proyectos y hasta 30.",
      parameters: { type: "object", properties: {} },
    },
    async run(_args, actx) {
      const { projects } = await accessibleProjectIds(projectsSvc, actx.companyId, actx.actorProfileId);
      const total = projects.length;
      const page = projects.slice(0, LIST_MAX);
      const ids = page.map((p) => p.id);
      const [totals, done] = ids.length
        ? await Promise.all([
            prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, parentTaskId: null }, _count: { id: true } }),
            prisma.task.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, parentTaskId: null, status: { isDone: true } }, _count: { id: true } }),
          ])
        : [[], []];
      const totalById = new Map(totals.map((g) => [g.projectId, g._count.id]));
      const doneById = new Map(done.map((g) => [g.projectId, g._count.id]));
      return {
        total,
        proyectos: page.map((p) => {
          const taskTotal = totalById.get(p.id) ?? 0;
          const taskDone = doneById.get(p.id) ?? 0;
          return {
            projectId: p.id,
            nombre: p.name,
            miembros: (p.members ?? []).length,
            tareasTotal: taskTotal,
            tareasCompletadas: taskDone,
            progreso: taskTotal ? Math.round((taskDone / taskTotal) * 100) : 0,
          };
        }),
      };
    },
  };

  return [projects_list_tasks, projects_task_summary, projects_list_projects];
}
