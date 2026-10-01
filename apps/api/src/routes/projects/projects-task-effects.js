// apps/api/src/routes/projects/projects-task-effects.js
//
// Side effects after a task write (assignee/status notifications, due-date
// calendar sync, status-change activity, realtime broadcast), extracted from
// the inline logic in projects-routes.js (POST/PATCH/DELETE /tasks) so both
// the HTTP routes and the MirAI actions (routes/projects/mirai-actions.js)
// go through the exact same side effects. `c` is a Hono context or
// actorContext() from routes/calendar/calendar-event-effects.js.
//
// Behavior is byte-for-byte what the routes did before extraction, including
// which calls are awaited vs fire-and-forget (broadcasts and the status-change
// activity publish were never awaited in the original route code).
import { publishActivityFromContext, getActivityContext } from "../../services/activity-publisher.js";

function contextIds(c) {
  const userId = c.get("userContext")?.profile?.id ?? c.get("userId") ?? null;
  const companyId = c.get("companyId") ?? null;
  return { userId, companyId };
}

export function createProjectsTaskEffects({ prisma, notifSvc, bridge, broadcaster = null }) {
  async function broadcastTaskEvent(projectId, taskId, action) {
    if (!broadcaster || !projectId) return;
    try {
      const members = await prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } });
      await broadcaster.broadcastToUsers(members.map((m) => m.userId), "projects.task.updated", {
        projectId,
        taskId: taskId ?? null,
        action,
      });
    } catch {
      // best-effort, same as the route's original broadcastProjectEvent
    }
  }

  function broadcastCalendarSync(c) {
    if (!broadcaster) return;
    const { companyId } = contextIds(c);
    if (!companyId) return;
    broadcaster.broadcastToCompany(companyId, "calendar.event.updated", { action: "projects_sync" }).catch(() => {});
  }

  async function syncDueDateCalendar(c, task) {
    const project = await prisma.project.findFirst({ where: { id: task.projectId } });
    await bridge.syncTaskEvent(task, project?.calendarId);
    broadcastCalendarSync(c);
  }

  async function afterCreate(c, task) {
    const { userId, companyId } = contextIds(c);
    await notifSvc.notifyTaskAssigned({ companyId, actorId: userId, taskId: task.id, assignedUserId: task.assigneeId });
    if (task.dueDate) await syncDueDateCalendar(c, task);
    broadcastTaskEvent(task.projectId, task.id, "created");
  }

  // `previous` is { id, statusId, assigneeId, projectId } (read before the
  // update); `patch` is the raw body the route/action sent to updateTask.
  async function afterUpdate(c, previous, task, patch) {
    const { userId, companyId } = contextIds(c);
    if (patch.assigneeId !== undefined && previous && patch.assigneeId !== previous.assigneeId) {
      await notifSvc.notifyTaskAssigned({ companyId, actorId: userId, taskId: previous.id, assignedUserId: patch.assigneeId });
    }
    if (patch.dueDate !== undefined) await syncDueDateCalendar(c, task);
    const oldStatusId = previous?.statusId ?? null;
    if (patch.statusId && oldStatusId && oldStatusId !== patch.statusId) {
      await notifSvc.notifyTaskStatusChanged({ companyId, actorId: userId, taskId: task.id, oldStatusId, newStatusId: patch.statusId });
      prisma.taskStatus.findMany({
        where: { id: { in: [oldStatusId, patch.statusId] } },
        select: { id: true, name: true },
      }).then((statuses) => {
        const oldS = statuses.find((s) => s.id === oldStatusId);
        const newS = statuses.find((s) => s.id === patch.statusId);
        const { actorName } = getActivityContext(c);
        publishActivityFromContext(prisma, c, {
          type: "projects.task.status_changed",
          summary: `${actorName} cambió estado de ${oldS?.name ?? "—"} → ${newS?.name ?? "—"}`,
          entityType: "Task",
          entityId: task.id,
        });
      }).catch(() => {});
    }
    broadcastTaskEvent(task.projectId ?? previous?.projectId, task.id, "updated");
  }

  // `before` is the full task row returned by tasksSvc.deleteTask (fetched
  // before the delete), which carries calendarEventId/projectId.
  async function afterDelete(c, before) {
    if (before?.calendarEventId) {
      await bridge.deleteTaskEvent(before.calendarEventId);
      broadcastCalendarSync(c);
    }
    broadcastTaskEvent(before?.projectId, before?.id, "deleted");
  }

  return { afterCreate, afterUpdate, afterDelete };
}
