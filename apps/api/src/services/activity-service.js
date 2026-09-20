import { activityPublishSchema, ACTIVITY_CONSTANTS } from "@runly/validators";

export class ActivityServiceError extends Error {
  constructor(message, status = 500, code = "activity_error") {
    super(message);
    this.name = "ActivityServiceError";
    this.status = status;
    this.code = code;
  }
}

const DEDUPE_WINDOW_MS = 2000;
const SUMMARY_MAX = 500;

function truncate(value, max) {
  if (typeof value !== "string") return value;
  return value.length > max ? value.slice(0, max) : value;
}

function buildWhere({ companyId, filters }) {
  const where = { companyId };
  if (filters?.entityType) where.entityType = filters.entityType;
  if (filters?.entityId) where.entityId = filters.entityId;
  if (filters?.type) where.type = filters.type;
  if (filters?.actorId) where.actorId = filters.actorId;
  if (filters?.severity) where.severity = filters.severity;
  if (Array.isArray(filters?.ids) && filters.ids.length > 0) {
    where.id = { in: filters.ids };
  }
  if (filters?.from || filters?.to) {
    where.createdAt = {};
    if (filters.from) where.createdAt.gte = filters.from;
    if (filters.to) where.createdAt.lte = filters.to;
  }
  const term = filters?.q ?? filters?.search;
  if (term) {
    const q = String(term).trim();
    if (q) {
      where.OR = [
        { summary: { contains: q, mode: "insensitive" } },
        { type: { contains: q, mode: "insensitive" } },
        { entityType: { contains: q, mode: "insensitive" } },
      ];
    }
  }
  return where;
}

export function createActivityService({ prisma }) {
  // activeCompanyId: the caller's validated active company, resolved by the
  // API's tenant middleware and threaded down from routes/activity.js. See
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
  async function resolveCompanyContext(authUserId, activeCompanyId) {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId },
      select: { id: true },
    });
    if (!profile) {
      throw new ActivityServiceError(
        "Perfil de usuario no encontrado.",
        404,
        "profile_not_found",
      );
    }
    if (!activeCompanyId) {
      // Never guess: an unresolved active company (e.g. a system-admin
      // request with no company header) must reject, not silently fall
      // back to whichever membership was created first/last.
      throw new ActivityServiceError(
        "No tienes una empresa activa.",
        403,
        "no_active_company",
      );
    }
    return { companyId: activeCompanyId, actorProfileId: profile.id };
  }

  async function isDuplicate({ companyId, type, entityId, actorId }) {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const existing = await prisma.activity.findFirst({
      where: {
        companyId,
        type,
        entityId: entityId ?? null,
        actorId: actorId ?? null,
        createdAt: { gte: since },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  async function publish(input) {
    const parsed = activityPublishSchema.parse(input);
    if (!parsed.companyId) {
      throw new ActivityServiceError(
        "companyId requerido para publicar actividad.",
        400,
        "company_required",
      );
    }
    const data = {
      companyId: parsed.companyId,
      actorId: parsed.actorId ?? null,
      type: parsed.type,
      entityType: parsed.entityType ?? null,
      entityId: parsed.entityId ?? null,
      summary: truncate(parsed.summary, SUMMARY_MAX),
      payload: parsed.payload ?? null,
      link: parsed.link ?? null,
      severity: parsed.severity ?? "info",
      source: input.source === "audit_bridge" ? "audit_bridge" : "explicit",
    };

    if (
      await isDuplicate({
        companyId: data.companyId,
        type: data.type,
        entityId: data.entityId,
        actorId: data.actorId,
      })
    ) {
      return null;
    }

    return prisma.activity.create({ data });
  }

  async function publishFromContext({ authUserId, companyId: activeCompanyId, input }) {
    const { companyId, actorProfileId } =
      await resolveCompanyContext(authUserId, activeCompanyId);
    if (input.companyId && input.companyId !== companyId) {
      throw new ActivityServiceError(
        "No puedes publicar actividad en otra empresa.",
        403,
        "company_mismatch",
      );
    }
    return publish({
      ...input,
      companyId,
      actorId: input.actorId ?? actorProfileId,
    });
  }

  async function list({ authUserId, companyId: activeCompanyId, query }) {
    const { companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const where = buildWhere({ companyId, filters: query });
    const sortField = query.sortBy ?? "createdAt";
    const sortDir = query.sortDir === "asc" ? "asc" : "desc";
    const orderBy = { [sortField]: sortDir };
    const [total, items] = await Promise.all([
      prisma.activity.count({ where }),
      prisma.activity.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              lastName: true,
              avatarFileId: true,
            },
          },
        },
      }),
    ]);
    return { data: items, pagination: { page, pageSize, total } };
  }

  async function recent({ authUserId, companyId: activeCompanyId, limit = 20 }) {
    const { companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const items = await prisma.activity.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      include: {
        actor: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            avatarFileId: true,
          },
        },
      },
    });
    return { data: items };
  }

  async function listForEntity({
    authUserId,
    companyId: activeCompanyId,
    entityType,
    entityId,
    limit = 50,
  }) {
    const { companyId } = await resolveCompanyContext(authUserId, activeCompanyId);
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const items = await prisma.activity.findMany({
      where: { companyId, entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      include: {
        actor: {
          select: {
            id: true,
            displayName: true,
            firstName: true,
            lastName: true,
            avatarFileId: true,
          },
        },
      },
    });
    return { data: items };
  }

  return {
    publish,
    publishFromContext,
    list,
    recent,
    listForEntity,
    resolveCompanyContext,
    constants: ACTIVITY_CONSTANTS,
  };
}
