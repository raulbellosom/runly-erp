export function createProjectsCalendarBridge({ prisma }) {
  function isCalendarAvailable() {
    return typeof prisma.calendarCalendar?.create === "function";
  }

  async function syncProjectCalendar(project) {
    if (!isCalendarAvailable()) return null;
    try {
      if (project.calendarId) {
        const existing = await prisma.calendarCalendar.findFirst({
          where: { id: project.calendarId, enabled: true },
          select: { id: true },
        });
        if (existing) {
          await prisma.calendarCalendar.update({
            where: { id: project.calendarId },
            data: {
              name: project.name,
              color: project.color ?? "#6366f1",
              icon: project.icon ?? null,
              // Backfills calendars created before this field was wired up
              // (they were stuck with company_id: null, which threw off
              // attendee-company validation on event creation) — self-heals
              // on the next project touch.
              companyId: project.companyId ?? null,
            },
          });
          return project.calendarId;
        }
        // Calendar was soft-deleted — clear stale reference before recreating
        await prisma.project.update({
          where: { id: project.id },
          data: { calendarId: null },
        });
      }
      const calendar = await prisma.calendarCalendar.create({
        data: {
          ownerId: project.ownerId,
          companyId: project.companyId ?? null,
          name: project.name,
          color: project.color ?? "#6366f1",
          icon: project.icon ?? null,
          isDefault: false,
        },
      });
      await prisma.project.update({
        where: { id: project.id },
        data: { calendarId: calendar.id },
      });
      return calendar.id;
    } catch {
      return null;
    }
  }

  async function grantMemberCalendarAccess(calendarId, userId) {
    if (!isCalendarAvailable() || !calendarId) return;
    try {
      const calendar = await prisma.calendarCalendar.findFirst({
        where: { id: calendarId },
        select: { ownerId: true },
      });
      // Owner already has full access — never create a redundant share
      if (!calendar || calendar.ownerId === userId) return;
      const existing = await prisma.calendarShare.findFirst({
        where: { calendarId, userId },
      });
      if (existing) return;
      await prisma.calendarShare.create({
        data: { calendarId, userId, role: "VIEWER" },
      });
    } catch {
      // Calendar access is best-effort — never block project operations
    }
  }

  async function revokeMemberCalendarAccess(calendarId, userId) {
    if (!isCalendarAvailable() || !calendarId) return;
    try {
      await prisma.calendarShare.deleteMany({ where: { calendarId, userId } });
    } catch {
      // Silently ignore
    }
  }

  async function syncTaskEvent(task, calendarId) {
    if (!isCalendarAvailable() || !calendarId || !task.dueDate) {
      if (task.calendarEventId) {
        await deleteTaskEvent(task.calendarEventId);
        await prisma.task.update({
          where: { id: task.id },
          data: { calendarEventId: null },
        });
      }
      return null;
    }
    try {
      // Use date-only (midnight UTC) to avoid timezone shift in all-day event display
      const toDateUTC = (d) => {
        // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: all-day events are stored as UTC-midnight instants
        const s = new Date(d).toISOString().split("T")[0];
        return new Date(s + "T00:00:00.000Z");
      };
      const startAt = toDateUTC(task.startDate ?? task.dueDate);
      const endAt = toDateUTC(task.dueDate);
      const eventData = {
        calendarId,
        title: task.title,
        startAt,
        endAt,
        allDay: true,
        sourceModule: "runly.projects",
        sourceEntityId: task.id,
      };
      if (task.calendarEventId) {
        await prisma.calendarEvent.update({
          where: { id: task.calendarEventId },
          data: {
            title: eventData.title,
            startAt: eventData.startAt,
            endAt: eventData.endAt,
            allDay: true,
          },
        });
        return task.calendarEventId;
      }
      const event = await prisma.calendarEvent.create({ data: eventData });
      await prisma.task.update({
        where: { id: task.id },
        data: { calendarEventId: event.id },
      });
      return event.id;
    } catch {
      return null;
    }
  }

  async function deleteTaskEvent(eventId) {
    if (!isCalendarAvailable() || !eventId) return;
    try {
      await prisma.calendarEvent.delete({ where: { id: eventId } });
    } catch {
      // Event may already be deleted
    }
  }

  return {
    syncProjectCalendar,
    grantMemberCalendarAccess,
    revokeMemberCalendarAccess,
    syncTaskEvent,
    deleteTaskEvent,
  };
}
