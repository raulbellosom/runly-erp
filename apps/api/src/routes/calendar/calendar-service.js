import { createUserAccessService } from '../../services/user-access-service.js';
export class CalendarServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "CalendarServiceError";
    this.status = status;
  }
}

export function createCalendarService({ prisma }) {
  // Eligibility is scoped to the calendar company.
  const access = createUserAccessService({ prisma });
  async function assertShareableTarget(ownerId, targetUserId, companyId) {
    if (!targetUserId || targetUserId === ownerId) throw new CalendarServiceError("Usuario destino invalido.", 400);
    await access.assertCompanyMember(companyId, ownerId);
    await access.assertCandidates({ companyId, userIds: [targetUserId] });
  }

  // companyId: the requester's server-resolved active company (never
  // client-supplied). Every calendar is created with the active company
  // attached — including the auto-created default one — so a "which company
  // does this calendar belong to" answer exists for anyone created going
  // forward. Omitted (e.g. a company-less caller), the calendar stays
  // personal-only (company: null), matching the original behavior.
  async function ensureDefaultCalendar(userId, companyId = null) {
    const existing = await prisma.calendarCalendar.findFirst({
      where: { ownerId: userId, companyId, isDefault: true, enabled: true },
    });
    if (existing) return existing;
    return prisma.calendarCalendar.create({
      data: {
        ownerId: userId,
        companyId,
        name: "Mi calendario",
        color: "#6B46C1",
        isDefault: true,
      },
    });
  }

  const CALENDAR_COMPANY_SELECT = { select: { id: true, name: true } };

  async function listCalendars(userId, companyId) {
    const owned = await prisma.calendarCalendar.findMany({
      where: { ownerId: userId, enabled: true, OR: [{ companyId: null }, { companyId, company: { enabled: true, memberships: { some: { userId, enabled: true } } } }] },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: {
        company: CALENDAR_COMPANY_SELECT,
        shares: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });
    const shared = await prisma.calendarShare.findMany({
      where: { userId, calendar: { companyId, company: { enabled: true, memberships: { some: { userId, enabled: true } } } } },
      include: { calendar: { include: { company: CALENDAR_COMPANY_SELECT } } },
    });
    const sharedCalendars = shared
      .filter((s) => s.calendar?.enabled && s.calendar?.ownerId !== userId)
      .map((s) => ({ ...s.calendar, _sharedRole: s.role, _shareId: s.id }));
    return { owned, shared: sharedCalendars };
  }

  async function createCalendar(userId, { name, color, icon }, companyId = null) {
    if (!name?.trim())
      throw new CalendarServiceError("El nombre es requerido.", 400);
    return prisma.calendarCalendar.create({
      data: {
        ownerId: userId,
        companyId,
        name: name.trim(),
        color: color ?? "#6B46C1",
        icon: icon || null,
      },
      include: { company: CALENDAR_COMPANY_SELECT },
    });
  }

  async function updateCalendar(userId, calendarId, { name, color, icon }, activeCompanyId) {
    const calendar = await prisma.calendarCalendar.findFirst({
      where: { id: calendarId, ownerId: userId, enabled: true, ...(activeCompanyId !== undefined ? { OR: [{ companyId: null }, { companyId: activeCompanyId }] } : {}) },
    });
    if (!calendar)
      throw new CalendarServiceError("Calendario no encontrado.", 404);
    if (calendar.companyId) await access.assertCompanyMember(calendar.companyId, userId);
    return prisma.calendarCalendar.update({
      where: { id: calendarId },
      data: {
        ...(name?.trim() ? { name: name.trim() } : {}),
        ...(color ? { color } : {}),
        ...(icon !== undefined ? { icon: icon || null } : {}),
      },
    });
  }

  async function deleteCalendar(userId, calendarId, activeCompanyId) {
    const calendar = await prisma.calendarCalendar.findFirst({
      where: { id: calendarId, ownerId: userId, enabled: true, ...(activeCompanyId !== undefined ? { OR: [{ companyId: null }, { companyId: activeCompanyId }] } : {}) },
    });
    if (!calendar)
      throw new CalendarServiceError("Calendario no encontrado.", 404);
    if (calendar.companyId) await access.assertCompanyMember(calendar.companyId, userId);
    if (calendar.isDefault)
      throw new CalendarServiceError(
        "No se puede eliminar el calendario por defecto.",
        400,
      );
    await prisma.calendarCalendar.update({
      where: { id: calendarId },
      data: { enabled: false },
    });
    await prisma.calendarEvent.updateMany({
      where: { calendarId },
      data: { enabled: false },
    });
  }

  async function shareCalendar(ownerId, calendarId, { userId, role }, activeCompanyId) {
    const calendar = await prisma.calendarCalendar.findFirst({
      where: { id: calendarId, ownerId, enabled: true, ...(activeCompanyId !== undefined ? { OR: [{ companyId: null }, { companyId: activeCompanyId }] } : {}) },
    });
    if (!calendar)
      throw new CalendarServiceError("Calendario no encontrado.", 404);
    const validRoles = ["VIEWER", "EDITOR", "MANAGER"];
    if (!validRoles.includes(role))
      throw new CalendarServiceError("Rol invalido.", 400);
    await assertShareableTarget(ownerId, userId, calendar.companyId);
    try {
      return await prisma.calendarShare.create({
        data: { calendarId, userId, role },
      });
    } catch (err) {
      if (err?.code === "P2002")
        throw new CalendarServiceError(
          "El usuario ya tiene acceso a este calendario.",
          409,
        );
      throw err;
    }
  }

  async function updateShare(ownerId, calendarId, shareId, { role }, activeCompanyId) {
    const calendar = await prisma.calendarCalendar.findFirst({
      where: { id: calendarId, ownerId, enabled: true, ...(activeCompanyId !== undefined ? { OR: [{ companyId: null }, { companyId: activeCompanyId }] } : {}) },
    });
    if (!calendar)
      throw new CalendarServiceError("Calendario no encontrado.", 404);
    if (calendar.companyId) await access.assertCompanyMember(calendar.companyId, ownerId);
    const share = await prisma.calendarShare.findFirst({
      where: { id: shareId, calendarId },
    });
    if (!share)
      throw new CalendarServiceError("Acceso compartido no encontrado.", 404);
    const validRoles = ["VIEWER", "EDITOR", "MANAGER"];
    if (!validRoles.includes(role))
      throw new CalendarServiceError("Rol invalido.", 400);
    return prisma.calendarShare.update({
      where: { id: shareId },
      data: { role },
    });
  }

  async function deleteShare(ownerId, calendarId, shareId, activeCompanyId) {
    const calendar = await prisma.calendarCalendar.findFirst({
      where: { id: calendarId, ownerId, enabled: true, ...(activeCompanyId !== undefined ? { OR: [{ companyId: null }, { companyId: activeCompanyId }] } : {}) },
    });
    if (!calendar)
      throw new CalendarServiceError("Calendario no encontrado.", 404);
    if (calendar.companyId) await access.assertCompanyMember(calendar.companyId, ownerId);
    const share = await prisma.calendarShare.findFirst({
      where: { id: shareId, calendarId },
    });
    if (!share)
      throw new CalendarServiceError("Acceso compartido no encontrado.", 404);
    await prisma.calendarShare.delete({ where: { id: shareId } });
  }

  async function getCalendarRole(userId, calendarId, activeCompanyId) {
    const calendar = await prisma.calendarCalendar.findFirst({
      where: { id: calendarId, enabled: true, ...(activeCompanyId !== undefined ? { OR: [{ companyId: null }, { companyId: activeCompanyId }] } : {}) },
    });
    if (!calendar) return null;
    if (calendar.companyId) await access.assertCompanyMember(calendar.companyId, userId);
    if (calendar.ownerId === userId) return "OWNER";
    const share = await prisma.calendarShare.findFirst({
      where: { calendarId, userId },
    });
    return share?.role ?? null;
  }

  return {
    ensureDefaultCalendar,
    listCalendars,
    createCalendar,
    updateCalendar,
    deleteCalendar,
    shareCalendar,
    updateShare,
    deleteShare,
    getCalendarRole,
  };
}
