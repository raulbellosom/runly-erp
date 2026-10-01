// apps/api/src/routes/hr/hr-mirai-queries.js
//
// Exact runly.hr tools for MirAI (spec 2026-09-30-mirai-ledger-hr-fleet §4):
// search, detail and headcount summary over the caller's company employees.
// The search tool reuses hr-service.js's listEmployees() paginated row shape
// (the same fields GET /hr/employees returns to a paginated caller — no
// notesMarkdown/metadata); the detail tool mirrors getEmployee()'s own
// return. Aggregates are computed in Prisma/SQL, never left for the model to
// add up from a partial list.
export const STATUS_LABEL = { active: "activo", inactive: "inactivo", vacation: "vacaciones", terminated: "baja" };
export const EMPLOYMENT_TYPE_LABEL = { full_time: "tiempo completo", part_time: "medio tiempo", contractor: "contratista", intern: "practicante" };

const LIST_MAX = 30;

function dayKey(value) {
  if (!value) return null;
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date hireDate/terminationDate
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function createHrMiraiQueries({ prisma, hrService }) {
  const hr_employees_search = {
    name: "hr_employees_search",
    permission: "hr.employee.read",
    definition: {
      description: "Busca colaboradores por nombre, codigo, correo, puesto o departamento (texto libre) y/o estado. Devuelve hasta 30 con employeeId y el total real.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Nombre, codigo, correo, puesto o departamento." },
          status: { type: "string", enum: ["active", "inactive", "vacation", "terminated"] },
        },
      },
    },
    async run(args, actx) {
      const result = await hrService.listEmployees({
        authUserId: actx.actorAuthUserId,
        companyId: actx.companyId,
        search: args?.search,
        status: args?.status,
        enabled: true,
        page: 1,
        pageSize: LIST_MAX,
      });
      return {
        total: result.total,
        colaboradores: result.rows.map((r) => ({
          employeeId: r.id,
          nombre: r.full_name,
          codigo: r.employee_code || null,
          puesto: r.job_title || null,
          departamento: r.department || null,
          estado: STATUS_LABEL[r.status] ?? r.status,
          tipoEmpleo: EMPLOYMENT_TYPE_LABEL[r.employment_type] ?? (r.employment_type || null),
          correoLaboral: r.work_email || null,
          telefono: r.phone || null,
        })),
      };
    },
  };

  const hr_employee_detail = {
    name: "hr_employee_detail",
    permission: "hr.employee.read",
    definition: {
      description: "Obtiene el expediente de un colaborador: datos de contacto, puesto, departamento, supervisor y colaboradores a su cargo.",
      parameters: {
        type: "object",
        properties: { employeeId: { type: "string" } },
        required: ["employeeId"],
      },
    },
    async run(args, actx) {
      const row = await hrService
        .getEmployee({ authUserId: actx.actorAuthUserId, companyId: actx.companyId, id: String(args?.employeeId ?? "") })
        .catch(() => null);
      if (!row) return { error: "No encontre ese colaborador, o no pertenece a esta empresa." };
      return {
        employeeId: row.id,
        nombre: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
        codigo: row.employeeCode ?? null,
        puesto: row.jobTitleRef?.name ?? row.jobTitle ?? null,
        departamento: row.departmentRef?.name ?? row.department ?? null,
        estado: STATUS_LABEL[row.status] ?? row.status,
        tipoEmpleo: EMPLOYMENT_TYPE_LABEL[row.employmentType] ?? row.employmentType ?? null,
        fechaIngreso: dayKey(row.hireDate),
        fechaBaja: dayKey(row.terminationDate),
        antiguedad: row.tenureLabel ?? null,
        correoLaboral: row.workEmail ?? null,
        correoPersonal: row.personalEmail ?? null,
        telefono: row.phone ?? null,
        ubicacion: row.workLocation ?? null,
        contactoEmergencia: row.emergencyContactName
          ? { nombre: row.emergencyContactName, telefono: row.emergencyContactPhone ?? null }
          : null,
        supervisor: row.supervisor
          ? { employeeId: row.supervisor.id, nombre: `${row.supervisor.firstName ?? ""} ${row.supervisor.lastName ?? ""}`.trim() }
          : null,
        colaboradoresACargo: (row.reportees ?? []).length,
        cuentaVinculada: Boolean(row.userProfile),
        notas: row.notesMarkdown ? row.notesMarkdown.slice(0, 1000) : null,
      };
    },
  };

  const hr_headcount_summary = {
    name: "hr_headcount_summary",
    permission: "hr.employee.read",
    definition: {
      description: "Conteos exactos de colaboradores activos (enabled), agrupados por departamento, puesto, estado o mes de ingreso (ultimos 12 meses).",
      parameters: {
        type: "object",
        properties: { groupBy: { type: "string", enum: ["department", "position", "status", "hireMonth"] } },
      },
    },
    async run(args, actx) {
      const groupBy = ["department", "position", "status", "hireMonth"].includes(args?.groupBy) ? args.groupBy : "status";

      if (groupBy === "hireMonth") {
        const rows = await prisma.$queryRaw`
          SELECT to_char(date_trunc('month', hire_date), 'YYYY-MM') AS grupo, COUNT(*)::int AS colaboradores
          FROM hr_employee
          WHERE company_id = ${actx.companyId}::uuid AND enabled = true AND hire_date >= NOW() - INTERVAL '12 months'
          GROUP BY grupo ORDER BY grupo`;
        return { total: rows.reduce((sum, r) => sum + r.colaboradores, 0), grupos: rows };
      }

      const FIELD = { department: "department", position: "jobTitle", status: "status" }[groupBy];
      const groups = await prisma.hrEmployee.groupBy({
        by: [FIELD],
        where: { companyId: actx.companyId, enabled: true },
        _count: { id: true },
      });
      const total = groups.reduce((sum, g) => sum + g._count.id, 0);
      return {
        total,
        grupos: groups
          .map((g) => ({
            grupo: groupBy === "status" ? (STATUS_LABEL[g[FIELD]] ?? g[FIELD] ?? "(sin estado)") : (g[FIELD] || "(sin asignar)"),
            colaboradores: g._count.id,
          }))
          .sort((a, b) => b.colaboradores - a.colaboradores),
      };
    },
  };

  return [hr_employees_search, hr_employee_detail, hr_headcount_summary];
}
