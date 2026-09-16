import {
  hrCatalogCreateSchema,
  hrCatalogEnabledSchema,
  hrCatalogUpdateSchema,
  hrEmployeeCreateSchema,
  hrEmployeeUpdateSchema,
} from "@runly/validators";
import { createActivityService } from "./activity-service.js";
import { createActivityBridge } from "./activity-bridge.js";

class HrServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "HrServiceError";
    this.status = status;
  }
}

function normalizeLimit(limit, fallback = 100, max = 300) {
  const parsed = Number.parseInt(String(limit ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function nullableString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDate(value) {
  if (value === undefined) return undefined;
  const normalized = nullableString(value);
  if (!normalized) return null;
  return new Date(normalized);
}

// Exact port of the client-side fmtTenure() this migration removes from
// HrEmployeeDetail.jsx, so the displayed tenure doesn't change wording when
// it moves server-side.
function computeTenureLabel(hireDate) {
  if (!hireDate) return null;
  const start = new Date(hireDate);
  const now = new Date();
  const months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (months < 1) return "Menos de 1 mes";
  if (months < 12) return `${months} mes${months > 1 ? "es" : ""}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem > 0
    ? `${years} año${years > 1 ? "s" : ""} y ${rem} mes${rem > 1 ? "es" : ""}`
    : `${years} año${years > 1 ? "s" : ""}`;
}

function normalizeEmployeePayload(data) {
  // userProfileId/supervisorEmployeeId/departmentId/jobTitleId are left to
  // the `...data` spread below (no `?? undefined` override here): Zod's
  // `.optional().nullable()` already distinguishes "field absent" (undefined
  // — don't touch on update) from "field explicitly cleared" (null — write
  // null), and collapsing null to undefined here silently turned every
  // "clear this relation" request into a no-op, both for
  // resolveDenormalizedFields below and for actually unlinking
  // userProfileId/supervisorEmployeeId in the database.
  return {
    ...data,
    firstName: data.firstName?.trim(),
    lastName: data.lastName?.trim(),
    employeeCode: nullableString(data.employeeCode),
    workEmail: nullableString(data.workEmail),
    personalEmail: nullableString(data.personalEmail),
    phone: nullableString(data.phone),
    emergencyContactName: nullableString(data.emergencyContactName),
    emergencyContactPhone: nullableString(data.emergencyContactPhone),
    employmentType: nullableString(data.employmentType),
    workLocation: nullableString(data.workLocation),
    notesMarkdown: nullableString(data.notesMarkdown),
    hireDate: normalizeDate(data.hireDate),
    terminationDate: normalizeDate(data.terminationDate),
  };
}

function buildSearchWhere(search) {
  const query = String(search ?? "").trim();
  if (!query) return {};
  return {
    OR: [
      { firstName: { contains: query, mode: "insensitive" } },
      { lastName: { contains: query, mode: "insensitive" } },
      { employeeCode: { contains: query, mode: "insensitive" } },
      { workEmail: { contains: query, mode: "insensitive" } },
      { personalEmail: { contains: query, mode: "insensitive" } },
      { jobTitle: { contains: query, mode: "insensitive" } },
      { department: { contains: query, mode: "insensitive" } },
      { notesMarkdown: { contains: query, mode: "insensitive" } },
    ],
  };
}

function mapCatalogPayload(payload) {
  return {
    name: payload.name.trim(),
    description: nullableString(payload.description),
  };
}

export function createHrService({ prisma, activityBridge }) {
  const bridge =
    activityBridge ??
    createActivityBridge({
      prisma,
      activityService: createActivityService({ prisma }),
    });
  // activeCompanyId: the caller's validated active company, resolved by the
  // API's tenant middleware (c.get("companyId"), see
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md
  // §5) and threaded down from each route handler. When provided, THIS is
  // the company every HR operation runs against — never re-derived. Without
  // it (any caller that hasn't been updated to pass it yet), falls back to
  // the pre-existing "most recently created membership" heuristic, which is
  // wrong for a multi-company user but preserves behavior for anything not
  // yet migrated.
  async function getUserContext(authUserId, activeCompanyId) {
    const profile = await prisma.userProfile.findUnique({
      where: { authUserId },
      select: { id: true },
    });
    if (!profile) {
      throw new HrServiceError("Perfil de usuario no encontrado.", 404);
    }

    if (activeCompanyId) {
      const membership = await prisma.membership.findFirst({
        where: { userId: profile.id, companyId: activeCompanyId, enabled: true },
        select: { companyId: true },
      });
      if (!membership?.companyId) {
        throw new HrServiceError("No tienes acceso a esta empresa.", 403);
      }
      return { actorId: profile.id, companyId: membership.companyId };
    }

    const membership = await prisma.membership.findFirst({
      where: { userId: profile.id, enabled: true },
      orderBy: { createdAt: "desc" },
      select: { companyId: true },
    });
    if (!membership?.companyId) {
      throw new HrServiceError("No tienes una empresa activa para RH.", 403);
    }

    return {
      actorId: profile.id,
      companyId: membership.companyId,
    };
  }

  async function assertEmployee({ id, companyId }) {
    const row = await prisma.hrEmployee.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!row) {
      throw new HrServiceError("Colaborador no encontrado.", 404);
    }
  }

  async function assertDepartment({ id, companyId }) {
    if (!id) return;
    const row = await prisma.hrDepartment.findFirst({
      where: { id, companyId },
      select: { id: true, enabled: true },
    });
    if (!row) {
      throw new HrServiceError("Departamento no encontrado.", 404);
    }
    if (!row.enabled) {
      throw new HrServiceError(
        "El departamento seleccionado est� deshabilitado.",
        400,
      );
    }
  }

  async function assertJobTitle({ id, companyId }) {
    if (!id) return;
    const row = await prisma.hrJobTitle.findFirst({
      where: { id, companyId },
      select: { id: true, enabled: true },
    });
    if (!row) {
      throw new HrServiceError("Puesto no encontrado.", 404);
    }
    if (!row.enabled) {
      throw new HrServiceError(
        "El puesto seleccionado est� deshabilitado.",
        400,
      );
    }
  }

  async function assertSupervisor({
    supervisorEmployeeId,
    companyId,
    currentEmployeeId = null,
  }) {
    if (!supervisorEmployeeId) return;
    if (currentEmployeeId && supervisorEmployeeId === currentEmployeeId) {
      throw new HrServiceError(
        "Un colaborador no puede ser su propio supervisor.",
        400,
      );
    }
    const row = await prisma.hrEmployee.findFirst({
      where: { id: supervisorEmployeeId, companyId, enabled: true },
      select: { id: true },
    });
    if (!row) {
      throw new HrServiceError(
        "Supervisor no encontrado en la empresa activa.",
        404,
      );
    }
  }

  // The employee's "photo" is now the FileAsset marked isCover among their
  // generic moduleKey/entityType/metadata.sourceEntityId-tagged files (see
  // the FileAsset.isCover/sortOrder migration this feature added) — there is
  // no more dedicated profileImageFileId column. This helper keeps every
  // OTHER consumer that used to read that column directly (chat @mention
  // avatars via getEmployee(), the org chart, the employee list export)
  // working, exposed under the same `profileImageFileId` field name so
  // those call sites don't need their own changes.
  async function resolveCoverFileIdsBatch(employeeIds, companyId) {
    const map = new Map();
    if (!employeeIds.length) return map;
    const files = await prisma.fileAsset.findMany({
      where: {
        entityId: companyId,
        moduleKey: { in: ["runly.hr", "atlas.hr"] },
        entityType: "HrEmployee",
        isCover: true,
      },
      select: { id: true, metadata: true },
    });
    for (const file of files) {
      const sourceEntityId = file.metadata?.sourceEntityId ?? null;
      if (sourceEntityId) map.set(sourceEntityId, file.id);
    }
    return map;
  }

  // Resolves department/jobTitle/managerName from their relation ids so the
  // client never has to keep these denormalized text columns in sync itself
  // (see docs/superpowers/specs/2026-09-15-hr-employee-blueprint-migration-design.md,
  // goal 7). Only touches a field when its id was actually present in the
  // payload (undefined = "not part of this update", matching
  // normalizeEmployeePayload's existing convention); an explicit null id
  // clears the denormalized text too.
  async function resolveDenormalizedFields({ departmentId, jobTitleId, supervisorEmployeeId, companyId }) {
    const result = {};
    if (departmentId !== undefined) {
      if (departmentId === null) {
        result.department = null;
      } else {
        const dept = await prisma.hrDepartment.findFirst({
          where: { id: departmentId, companyId },
          select: { name: true },
        });
        result.department = dept?.name ?? null;
      }
    }
    if (jobTitleId !== undefined) {
      if (jobTitleId === null) {
        result.jobTitle = null;
      } else {
        const jt = await prisma.hrJobTitle.findFirst({
          where: { id: jobTitleId, companyId },
          select: { name: true },
        });
        result.jobTitle = jt?.name ?? null;
      }
    }
    if (supervisorEmployeeId !== undefined) {
      if (supervisorEmployeeId === null) {
        result.managerName = null;
      } else {
        const sup = await prisma.hrEmployee.findFirst({
          where: { id: supervisorEmployeeId, companyId },
          select: { firstName: true, lastName: true },
        });
        result.managerName = sup
          ? `${sup.firstName ?? ""} ${sup.lastName ?? ""}`.trim() || null
          : null;
      }
    }
    return result;
  }

  async function assertUserLinkEligibility({
    companyId,
    userProfileId,
    currentEmployeeId = null,
  }) {
    if (
      userProfileId === undefined ||
      userProfileId === null ||
      !String(userProfileId).trim()
    ) {
      return;
    }

    const membership = await prisma.membership.findFirst({
      where: { companyId, userId: userProfileId, enabled: true },
      select: { id: true },
    });
    if (!membership) {
      throw new HrServiceError(
        "La cuenta seleccionada no pertenece a la empresa activa.",
        400,
      );
    }

    const linked = await prisma.hrEmployee.findFirst({
      where: {
        companyId,
        userProfileId,
        ...(currentEmployeeId ? { id: { not: currentEmployeeId } } : {}),
      },
      select: { id: true },
    });
    if (linked) {
      throw new HrServiceError(
        "La cuenta de usuario ya est� vinculada a otro colaborador.",
        409,
      );
    }
  }

  async function assertNoHierarchyCycle({
    employeeId,
    supervisorEmployeeId,
    companyId,
  }) {
    if (!supervisorEmployeeId || !employeeId) return;
    let cursor = supervisorEmployeeId;
    const visited = new Set();
    while (cursor) {
      if (cursor === employeeId) {
        throw new HrServiceError(
          "La jerarqu�a propuesta genera un ciclo de supervisi�n.",
          409,
        );
      }
      if (visited.has(cursor)) {
        break;
      }
      visited.add(cursor);
      const next = await prisma.hrEmployee.findFirst({
        where: { id: cursor, companyId },
        select: { supervisorEmployeeId: true },
      });
      cursor = next?.supervisorEmployeeId ?? null;
    }
  }

  async function logAudit({
    actorId,
    entityId,
    action,
    before,
    after,
    metadata,
    companyId,
    activityHint,
  }) {
    await bridge.logAndPublish({
      auditEntry: {
        actorId,
        moduleKey: "runly.hr",
        entityType: "HrEmployee",
        entityId,
        action,
        before,
        after,
        metadata,
      },
      hint: activityHint,
      companyId,
    });
  }

  return {
    async listEmployees({
      authUserId,
      companyId: activeCompanyId,
      search,
      status,
      enabled,
      limit,
      page,
      pageSize,
      sortBy,
      sortDir,
    }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);

      // Paginated path (used by RunlyTable)
      if (page !== undefined || pageSize !== undefined) {
        const take = Math.min(Math.max(1, Number(pageSize) || 20), 200);
        const skip = (Math.max(1, Number(page) || 1) - 1) * take;
        const SORT_MAP = {
          full_name: [
            { lastName: sortDir || "asc" },
            { firstName: sortDir || "asc" },
          ],
          hire_date: [{ hireDate: sortDir || "asc" }],
          status: [{ status: sortDir || "asc" }],
          department: [{ department: sortDir || "asc" }],
        };
        const orderBy = SORT_MAP[sortBy] ?? [{ updatedAt: "desc" }];
        const where = {
          companyId,
          ...(enabled === undefined ? {} : { enabled: Boolean(enabled) }),
          ...(status ? { status } : {}),
          ...buildSearchWhere(search),
        };
        const [rows, total] = await Promise.all([
          prisma.hrEmployee.findMany({
            where, orderBy, take, skip,
            include: { userProfile: { select: { avatarFileId: true } } },
          }),
          prisma.hrEmployee.count({ where }),
        ]);
        const coverFileIds = await resolveCoverFileIdsBatch(
          rows.map((r) => r.id),
          companyId,
        );
        return {
          rows: rows.map((r) => ({
            id: r.id,
            photo_file_id: coverFileIds.get(r.id) ?? r.userProfile?.avatarFileId ?? null,
            full_name: `${r.firstName} ${r.lastName}`.trim(),
            first_name: r.firstName ?? "",
            last_name: r.lastName ?? "",
            employee_code: r.employeeCode ?? "",
            job_title: r.jobTitle ?? "",
            department: r.department ?? "",
            status: r.status,
            employment_type: r.employmentType ?? "",
            // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date export value
            hire_date: r.hireDate ? r.hireDate.toISOString().slice(0, 10) : "",
            work_email: r.workEmail ?? "",
            personal_email: r.personalEmail ?? "",
            phone: r.phone ?? "",
            work_location: r.workLocation ?? "",
            manager_name: r.managerName ?? "",
            termination_date: r.terminationDate
              ? // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date export value
                r.terminationDate.toISOString().slice(0, 10)
              : "",
            emergency_contact_name: r.emergencyContactName ?? "",
            emergency_contact_phone: r.emergencyContactPhone ?? "",
          })),
          total,
        };
      }

      // Legacy path: returns full employee objects for org chart / explorer / detail
      const take = normalizeLimit(limit);
      return prisma.hrEmployee.findMany({
        where: {
          companyId,
          ...(enabled === undefined ? {} : { enabled: Boolean(enabled) }),
          ...(status ? { status } : {}),
          ...buildSearchWhere(search),
        },
        include: {
          supervisor: { select: { id: true, firstName: true, lastName: true } },
          departmentRef: { select: { id: true, name: true } },
          jobTitleRef: { select: { id: true, name: true } },
          userProfile: { select: { id: true, displayName: true, email: true, avatarFileId: true } },
        },
        orderBy: [{ updatedAt: "desc" }],
        take,
      });
    },

    async listEmployeesForExport({ authUserId, companyId: activeCompanyId, ids }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const where = { companyId, enabled: true };
      if (ids?.length) where.id = { in: ids };
      return prisma.hrEmployee.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });
    },

    async getEmployee({ authUserId, companyId: activeCompanyId, id }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const row = await prisma.hrEmployee.findFirst({
        where: { id, companyId },
        include: {
          supervisor: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              userProfile: { select: { avatarFileId: true } },
            },
          },
          reportees: {
            where: { enabled: true },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              status: true,
              userProfile: { select: { avatarFileId: true } },
            },
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          },
          departmentRef: { select: { id: true, name: true } },
          jobTitleRef: { select: { id: true, name: true } },
          userProfile: {
            select: {
              id: true,
              displayName: true,
              email: true,
              avatarFileId: true,
            },
          },
        },
      });
      if (!row) {
        throw new HrServiceError("Colaborador no encontrado.", 404);
      }
      // Own FileAsset cover wins; fall back to the linked account's avatar
      // (same fallback listEmployees already applies) — for the employee
      // itself and for the supervisor/reportees shown in the org chart.
      const coverFileIds = await resolveCoverFileIdsBatch(
        [row.id, row.supervisor?.id, ...row.reportees.map((r) => r.id)].filter(Boolean),
        companyId,
      );
      const photoFor = (employee) =>
        coverFileIds.get(employee.id) ?? employee.userProfile?.avatarFileId ?? null;
      return {
        ...row,
        tenureLabel: computeTenureLabel(row.hireDate),
        profileImageFileId: photoFor(row),
        supervisor: row.supervisor
          ? { ...row.supervisor, profileImageFileId: photoFor(row.supervisor) }
          : null,
        reportees: row.reportees.map((r) => ({
          ...r,
          profileImageFileId: photoFor(r),
        })),
      };
    },

    async createEmployee({ authUserId, companyId: activeCompanyId, payload }) {
      const { actorId, companyId } = await getUserContext(authUserId, activeCompanyId);
      const parsed = hrEmployeeCreateSchema.parse(payload);
      const normalized = normalizeEmployeePayload(parsed);

      await assertUserLinkEligibility({
        companyId,
        userProfileId: normalized.userProfileId ?? null,
      });
      await assertSupervisor({
        supervisorEmployeeId: normalized.supervisorEmployeeId,
        companyId,
      });
      await assertDepartment({ id: normalized.departmentId, companyId });
      await assertJobTitle({ id: normalized.jobTitleId, companyId });

      if (normalized.employeeCode) {
        const codeConflict = await prisma.hrEmployee.findFirst({
          where: {
            companyId,
            employeeCode: normalized.employeeCode,
            enabled: true,
          },
          select: { id: true },
        });
        if (codeConflict) {
          throw new HrServiceError(
            "El código de colaborador ya está en uso.",
            400,
          );
        }
      }

      const denormalized = await resolveDenormalizedFields({
        departmentId: normalized.departmentId,
        jobTitleId: normalized.jobTitleId,
        supervisorEmployeeId: normalized.supervisorEmployeeId,
        companyId,
      });
      const created = await prisma.hrEmployee.create({
        data: {
          ...normalized,
          ...denormalized,
          companyId,
        },
      });

      await logAudit({
        actorId,
        entityId: created.id,
        action: "hr.employee.create",
        before: null,
        after: created,
        metadata: { source: "api" },
        companyId,
      });
      return created;
    },

    async updateEmployee({ authUserId, companyId: activeCompanyId, id, payload }) {
      const { actorId, companyId } = await getUserContext(authUserId, activeCompanyId);
      await assertEmployee({ id, companyId });
      const before = await prisma.hrEmployee.findUnique({ where: { id } });
      const parsed = hrEmployeeUpdateSchema.parse(payload);
      const normalized = normalizeEmployeePayload(parsed);

      await assertUserLinkEligibility({
        companyId,
        userProfileId: normalized.userProfileId,
        currentEmployeeId: id,
      });
      await assertSupervisor({
        supervisorEmployeeId: normalized.supervisorEmployeeId,
        companyId,
        currentEmployeeId: id,
      });
      await assertNoHierarchyCycle({
        employeeId: id,
        supervisorEmployeeId: normalized.supervisorEmployeeId,
        companyId,
      });
      await assertDepartment({ id: normalized.departmentId, companyId });
      await assertJobTitle({ id: normalized.jobTitleId, companyId });

      if (normalized.employeeCode) {
        const codeConflict = await prisma.hrEmployee.findFirst({
          where: {
            companyId,
            employeeCode: normalized.employeeCode,
            enabled: true,
            id: { not: id },
          },
          select: { id: true },
        });
        if (codeConflict) {
          throw new HrServiceError(
            "El código de colaborador ya está en uso.",
            400,
          );
        }
      }

      const denormalized = await resolveDenormalizedFields({
        departmentId: normalized.departmentId,
        jobTitleId: normalized.jobTitleId,
        supervisorEmployeeId: normalized.supervisorEmployeeId,
        companyId,
      });
      const updated = await prisma.hrEmployee.update({
        where: { id },
        data: { ...normalized, ...denormalized },
      });
      await logAudit({
        actorId,
        entityId: id,
        action: "hr.employee.update",
        before,
        after: updated,
        metadata: { source: "api" },
        companyId,
      });
      return updated;
    },

    async setEmployeeEnabled({ authUserId, companyId: activeCompanyId, id, enabled }) {
      const { actorId, companyId } = await getUserContext(authUserId, activeCompanyId);
      await assertEmployee({ id, companyId });
      const before = await prisma.hrEmployee.findUnique({ where: { id } });
      const updated = await prisma.hrEmployee.update({
        where: { id },
        data: { enabled: Boolean(enabled) },
      });
      await logAudit({
        actorId,
        entityId: id,
        action: updated.enabled ? "hr.employee.enable" : "hr.employee.disable",
        before,
        after: updated,
        metadata: { source: "api" },
        companyId,
        activityHint: {
          type: "hr.employee.setEnabled",
          summary: updated.enabled
            ? `Colaborador habilitado: ${updated.firstName ?? ""} ${updated.lastName ?? ""}`.trim()
            : `Colaborador deshabilitado: ${updated.firstName ?? ""} ${updated.lastName ?? ""}`.trim(),
          severity: updated.enabled ? "success" : "warning",
          link: `/hr/employees/${id}`,
        },
      });
      return updated;
    },

    async getEmployeeAudit({ authUserId, companyId: activeCompanyId, id, limit }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      await assertEmployee({ id, companyId });
      const take = normalizeLimit(limit, 50, 200);
      return prisma.auditLog.findMany({
        where: {
          moduleKey: { in: ["runly.hr", "atlas.hr"] },
          entityType: "HrEmployee",
          entityId: id,
        },
        include: {
          actor: {
            select: {
              id: true,
              displayName: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take,
      });
    },

    async listUserOptions({ authUserId, companyId: activeCompanyId, search, limit }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const take = normalizeLimit(limit, 40, 100);
      const query = String(search ?? "").trim();
      const memberships = await prisma.membership.findMany({
        where: {
          companyId,
          enabled: true,
          user: {
            enabled: true,
            ...(query
              ? {
                  OR: [
                    { displayName: { contains: query, mode: "insensitive" } },
                    { email: { contains: query, mode: "insensitive" } },
                  ],
                }
              : {}),
          },
        },
        select: {
          user: {
            select: {
              id: true,
              displayName: true,
              email: true,
            },
          },
        },
        take,
      });

      return memberships
        .map((m) => m.user)
        .filter(Boolean)
        .map((user) => ({
          id: user.id,
          label: user.displayName || user.email,
          email: user.email,
        }));
    },

    async listDepartments({ authUserId, companyId: activeCompanyId, search, enabled, limit }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const take = normalizeLimit(limit, 100, 300);
      const query = String(search ?? "").trim();
      return prisma.hrDepartment.findMany({
        where: {
          companyId,
          ...(enabled === undefined ? {} : { enabled: Boolean(enabled) }),
          ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
        },
        orderBy: [{ name: "asc" }],
        take,
      });
    },

    async createDepartment({ authUserId, companyId: activeCompanyId, payload }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const parsed = hrCatalogCreateSchema.parse(payload);
      const data = mapCatalogPayload(parsed);

      try {
        return await prisma.hrDepartment.create({
          data: {
            companyId,
            ...data,
          },
        });
      } catch (error) {
        if (error?.code === "P2002") {
          throw new HrServiceError(
            "Ya existe un departamento con ese nombre.",
            409,
          );
        }
        throw error;
      }
    },

    async updateDepartment({ authUserId, companyId: activeCompanyId, id, payload }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const parsed = hrCatalogUpdateSchema.parse(payload);
      const data = mapCatalogPayload(parsed);

      const current = await prisma.hrDepartment.findFirst({
        where: { id, companyId },
        select: { id: true },
      });
      if (!current) {
        throw new HrServiceError("Departamento no encontrado.", 404);
      }

      try {
        return await prisma.hrDepartment.update({
          where: { id },
          data,
        });
      } catch (error) {
        if (error?.code === "P2002") {
          throw new HrServiceError(
            "Ya existe un departamento con ese nombre.",
            409,
          );
        }
        throw error;
      }
    },

    async setDepartmentEnabled({ authUserId, companyId: activeCompanyId, id, enabled }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const parsed = hrCatalogEnabledSchema.parse({ enabled });
      const current = await prisma.hrDepartment.findFirst({
        where: { id, companyId },
        select: { id: true },
      });
      if (!current) {
        throw new HrServiceError("Departamento no encontrado.", 404);
      }
      return prisma.hrDepartment.update({
        where: { id },
        data: { enabled: parsed.enabled },
      });
    },

    async listJobTitles({ authUserId, companyId: activeCompanyId, search, enabled, limit }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const take = normalizeLimit(limit, 100, 300);
      const query = String(search ?? "").trim();
      return prisma.hrJobTitle.findMany({
        where: {
          companyId,
          ...(enabled === undefined ? {} : { enabled: Boolean(enabled) }),
          ...(query ? { name: { contains: query, mode: "insensitive" } } : {}),
        },
        orderBy: [{ name: "asc" }],
        take,
      });
    },

    async createJobTitle({ authUserId, companyId: activeCompanyId, payload }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const parsed = hrCatalogCreateSchema.parse(payload);
      const data = mapCatalogPayload(parsed);

      try {
        return await prisma.hrJobTitle.create({
          data: {
            companyId,
            ...data,
          },
        });
      } catch (error) {
        if (error?.code === "P2002") {
          throw new HrServiceError("Ya existe un puesto con ese nombre.", 409);
        }
        throw error;
      }
    },

    async updateJobTitle({ authUserId, companyId: activeCompanyId, id, payload }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const parsed = hrCatalogUpdateSchema.parse(payload);
      const data = mapCatalogPayload(parsed);

      const current = await prisma.hrJobTitle.findFirst({
        where: { id, companyId },
        select: { id: true },
      });
      if (!current) {
        throw new HrServiceError("Puesto no encontrado.", 404);
      }

      try {
        return await prisma.hrJobTitle.update({
          where: { id },
          data,
        });
      } catch (error) {
        if (error?.code === "P2002") {
          throw new HrServiceError("Ya existe un puesto con ese nombre.", 409);
        }
        throw error;
      }
    },

    async setJobTitleEnabled({ authUserId, companyId: activeCompanyId, id, enabled }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const parsed = hrCatalogEnabledSchema.parse({ enabled });
      const current = await prisma.hrJobTitle.findFirst({
        where: { id, companyId },
        select: { id: true },
      });
      if (!current) {
        throw new HrServiceError("Puesto no encontrado.", 404);
      }
      return prisma.hrJobTitle.update({
        where: { id },
        data: { enabled: parsed.enabled },
      });
    },

    async getOrgChart({ authUserId, companyId: activeCompanyId, rootEmployeeId = null, enabled = true }) {
      const { companyId } = await getUserContext(authUserId, activeCompanyId);
      const employees = await prisma.hrEmployee.findMany({
        where: {
          companyId,
          ...(enabled === undefined ? {} : { enabled: Boolean(enabled) }),
        },
        select: {
          id: true,
          employeeCode: true,
          userProfileId: true,
          firstName: true,
          lastName: true,
          status: true,
          supervisorEmployeeId: true,
          departmentId: true,
          jobTitleId: true,
          departmentRef: { select: { id: true, name: true } },
          jobTitleRef: { select: { id: true, name: true } },
          userProfile: {
            select: { id: true, displayName: true, avatarFileId: true },
          },
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      });

      const coverFileIds = await resolveCoverFileIdsBatch(
        employees.map((e) => e.id),
        companyId,
      );

      const childrenByParent = new Map();
      for (const employee of employees) {
        const key = employee.supervisorEmployeeId ?? "__root__";
        if (!childrenByParent.has(key)) {
          childrenByParent.set(key, []);
        }
        childrenByParent.get(key).push(employee);
      }

      const buildNode = (employee) => ({
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        employeeCode: employee.employeeCode ?? null,
        userProfileId: employee.userProfileId ?? null,
        linkedUser: employee.userProfile
          ? {
              id: employee.userProfile.id,
              displayName: employee.userProfile.displayName,
              avatarFileId: employee.userProfile.avatarFileId ?? null,
            }
          : null,
        status: employee.status,
        department: employee.departmentRef?.name ?? null,
        jobTitle: employee.jobTitleRef?.name ?? null,
        profileImageFileId:
          coverFileIds.get(employee.id) ?? employee.userProfile?.avatarFileId ?? null,
        children: (childrenByParent.get(employee.id) ?? []).map(buildNode),
      });

      if (rootEmployeeId) {
        const root = employees.find(
          (employee) => employee.id === rootEmployeeId,
        );
        if (!root) {
          throw new HrServiceError(
            "Colaborador ra�z no encontrado para organigrama.",
            404,
          );
        }
        return {
          roots: [buildNode(root)],
          totalNodes: employees.length,
        };
      }

      const roots = (childrenByParent.get("__root__") ?? []).map(buildNode);
      return {
        roots,
        totalNodes: employees.length,
      };
    },
  };
}

export { HrServiceError };
