// apps/api/src/routes/projects/mirai-capabilities.js
//
// runly.projects (tasks) capability for MirAI (spec
// 2026-09-30-mirai-remaining-modules §3). publicLookup: not applicable —
// tasks/projects have no public-internet counterpart worth looking up.
import { createProjectsService } from "./projects-service.js";
import { createTasksService } from "./tasks-service.js";
import { createProjectsMiraiQueries } from "./projects-mirai-queries.js";
import { createProjectsMiraiActions } from "./mirai-actions.js";

export function createProjectsMiraiCapabilities({ prisma, effects }) {
  const projectsSvc = createProjectsService({ prisma });
  const tasksSvc = createTasksService({ prisma });

  return {
    moduleKey: "runly.projects",
    label: "Proyectos",
    summary: "Tareas y proyectos del usuario: busqueda, totales exactos; crear, editar y eliminar tareas.",
    tools: createProjectsMiraiQueries({ prisma, projectsSvc }),
    actions: createProjectsMiraiActions({ prisma, projectsSvc, tasksSvc, effects }),
    publicLookup: [],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType === "task" && pageContext.recordId) {
        const task = await prisma.task.findFirst({
          where: { id: String(pageContext.recordId) },
          include: { project: { select: { id: true, name: true, companyId: true } }, status: { select: { name: true } } },
        }).catch(() => null);
        if (!task || task.project?.companyId !== actx.companyId) return null;
        return `El usuario esta viendo la tarea "${task.title}" (taskId ${task.id}) del proyecto "${task.project.name}", estado ${task.status?.name ?? "sin estado"}.`;
      }
      if (pageContext?.recordType === "project" && pageContext.recordId) {
        const project = await projectsSvc.getProject(String(pageContext.recordId), actx.actorProfileId).catch(() => null);
        if (!project || project.companyId !== actx.companyId) return null;
        return `El usuario esta viendo el proyecto "${project.name}" (projectId ${project.id}).`;
      }
      return null;
    },
  };
}
