// apps/api/src/routes/hr/mirai-actions.js
//
// runly.hr actions MirAI can propose (spec 2026-09-30-mirai-ledger-hr-fleet
// §4). prepare() validates and resolves employee/department/job-title names
// -> ids without writing; execute() goes through hr-service.js exactly like
// the HTTP routes in ../hr-routes.js (same permissions). hr-service.js
// already calls its own logAudit()/activity publishing internally after
// every write (via createActivityBridge) — no separate effects file is
// needed, the same way the HTTP routes don't have one either.
//
// Map (routes/hr-routes.js -> services/hr-service.js):
//   POST  /hr/employees             -> hrService.createEmployee()       perm hr.employee.create
//   PATCH /hr/employees/:id         -> hrService.updateEmployee()       perm hr.employee.update
//   PATCH /hr/employees/:id/enabled -> hrService.setEmployeeEnabled()   perm hr.employee.delete
//
// Omitted (documented, not wired to MirAI):
//   - supervisorEmployeeId / userProfileId on update: changing a supervisor
//     risks an unintended reporting-line change from a single chat turn
//     (the service's own cycle check would catch a cycle, but not a
//     mis-resolved name), and linking/unlinking a login account is an
//     identity action, not an HR edit. Both stay on the HR screen.
//   - employeeCode and emergency-contact fields on update: low-conversational
//     value; left to the HR screen to keep the action's surface small.
//   - Department/job-title/org-chart CRUD: out of scope per spec §4 (only
//     the employee entity has create/update/deactivate actions).
import { z } from "zod";

const STATUS_LABEL = { active: "activo", inactive: "inactivo", vacation: "vacaciones", terminated: "baja" };
const EMPLOYMENT_TYPE_LABEL = { full_time: "tiempo completo", part_time: "medio tiempo", contractor: "contratista", intern: "practicante" };
const LINK = (id) => `/app/m/runly.hr/hr/employees/${id}`;

const createArgs = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  department: z.string().trim().max(120).nullable().optional(),
  position: z.string().trim().max(120).nullable().optional(),
  workEmail: z.string().trim().email().max(200).optional(),
  personalEmail: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  employmentType: z.enum(["full_time", "part_time", "contractor", "intern"]).optional(),
  workLocation: z.string().trim().max(120).optional(),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["active", "inactive", "vacation", "terminated"]).optional(),
  notes: z.string().trim().max(10000).optional(),
});
const updateArgs = z.object({
  employeeId: z.string().min(1).optional(),
  employeeName: z.string().trim().min(1).max(200).optional(),
  firstName: z.string().trim().min(1).max(100).optional(),
  lastName: z.string().trim().min(1).max(100).optional(),
  department: z.string().trim().max(120).nullable().optional(),
  position: z.string().trim().max(120).nullable().optional(),
  workEmail: z.string().trim().email().max(200).optional(),
  personalEmail: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  employmentType: z.enum(["full_time", "part_time", "contractor", "intern"]).optional(),
  workLocation: z.string().trim().max(120).optional(),
  status: z.enum(["active", "inactive", "vacation", "terminated"]).optional(),
  notes: z.string().trim().max(10000).optional(),
});
const targetArgs = z.object({
  employeeId: z.string().min(1).optional(),
  employeeName: z.string().trim().min(1).max(200).optional(),
});

export function createHrMiraiActions({ hrService }) {
  // Resolves { employeeId } directly, or { employeeName } via a
  // company-scoped search (exact match wins; several partial matches -> list
  // the names so the model can ask which one), same pattern as
  // contacts/mirai-actions.js's resolveContact().
  async function resolveEmployee(actx, { employeeId, employeeName }) {
    const authUserId = actx.actorAuthUserId;
    const companyId = actx.companyId;
    if (employeeId) {
      const row = await hrService.getEmployee({ authUserId, companyId, id: employeeId }).catch(() => null);
      return row ? { employee: row } : { error: "No encontre ese colaborador, o no pertenece a esta empresa. Usa hr_employees_search para obtener su employeeId." };
    }
    if (!employeeName) return { error: "Indica el employeeId (de hr_employees_search) o el nombre del colaborador." };
    const { rows } = await hrService.listEmployees({ authUserId, companyId, search: employeeName, page: 1, pageSize: 10 });
    const q = employeeName.toLowerCase();
    const exact = rows.filter((r) => r.full_name.toLowerCase() === q);
    const matches = exact.length ? exact : rows;
    if (matches.length === 1) {
      const row = await hrService.getEmployee({ authUserId, companyId, id: matches[0].id }).catch(() => null);
      return row ? { employee: row } : { error: "No encontre ese colaborador." };
    }
    if (!matches.length) return { error: `No encontre ningun colaborador llamado "${employeeName}".` };
    return { error: `Hay varios colaboradores que coinciden con "${employeeName}": ${matches.map((r) => r.full_name).join(", ")}.` };
  }

  async function resolveDepartment(actx, name) {
    if (name === undefined) return { skip: true };
    if (name === null) return { id: null, name: null };
    const rows = await hrService.listDepartments({ authUserId: actx.actorAuthUserId, companyId: actx.companyId, search: name, enabled: true, limit: 10 });
    const q = name.toLowerCase();
    const exact = rows.filter((r) => r.name.toLowerCase() === q);
    const matches = exact.length ? exact : rows;
    if (matches.length === 1) return { id: matches[0].id, name: matches[0].name };
    if (!matches.length) return { error: `No encontre el departamento "${name}".` };
    return { error: `Hay varios departamentos que coinciden con "${name}": ${matches.map((r) => r.name).join(", ")}.` };
  }

  async function resolveJobTitle(actx, name) {
    if (name === undefined) return { skip: true };
    if (name === null) return { id: null, name: null };
    const rows = await hrService.listJobTitles({ authUserId: actx.actorAuthUserId, companyId: actx.companyId, search: name, enabled: true, limit: 10 });
    const q = name.toLowerCase();
    const exact = rows.filter((r) => r.name.toLowerCase() === q);
    const matches = exact.length ? exact : rows;
    if (matches.length === 1) return { id: matches[0].id, name: matches[0].name };
    if (!matches.length) return { error: `No encontre el puesto "${name}".` };
    return { error: `Hay varios puestos que coinciden con "${name}": ${matches.map((r) => r.name).join(", ")}.` };
  }

  const create = {
    key: "hr.employee.create",
    moduleKey: "runly.hr",
    operation: "create",
    label: "Dar de alta colaborador",
    permission: "hr.employee.create",
    description: "Da de alta un colaborador (nombre, puesto, departamento, contacto, tipo de empleo, fecha de ingreso).",
    parameters: {
      type: "object",
      properties: {
        firstName: { type: "string" },
        lastName: { type: "string" },
        department: { type: "string" },
        position: { type: "string" },
        workEmail: { type: "string" },
        personalEmail: { type: "string" },
        phone: { type: "string" },
        employmentType: { type: "string", enum: ["full_time", "part_time", "contractor", "intern"] },
        workLocation: { type: "string" },
        hireDate: { type: "string", description: "YYYY-MM-DD" },
        status: { type: "string", enum: ["active", "inactive", "vacation", "terminated"] },
        notes: { type: "string" },
      },
      required: ["firstName", "lastName"],
    },
    async prepare(args, actx) {
      const parsed = createArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica al menos el nombre y apellido del colaborador." };
      const a = parsed.data;
      const dept = await resolveDepartment(actx, a.department);
      if (dept.error) return { error: dept.error };
      const jobTitle = await resolveJobTitle(actx, a.position);
      if (jobTitle.error) return { error: jobTitle.error };
      const payload = {
        firstName: a.firstName,
        lastName: a.lastName,
        departmentId: dept.skip ? undefined : dept.id,
        jobTitleId: jobTitle.skip ? undefined : jobTitle.id,
        workEmail: a.workEmail,
        personalEmail: a.personalEmail,
        phone: a.phone,
        employmentType: a.employmentType,
        workLocation: a.workLocation,
        hireDate: a.hireDate,
        status: a.status,
        notesMarkdown: a.notes,
      };
      return {
        input: payload,
        preview: {
          title: "Dar de alta colaborador",
          fields: [
            { label: "Nombre", value: `${a.firstName} ${a.lastName}` },
            a.position ? { label: "Puesto", value: a.position } : null,
            a.department ? { label: "Departamento", value: a.department } : null,
            a.employmentType ? { label: "Tipo de empleo", value: EMPLOYMENT_TYPE_LABEL[a.employmentType] } : null,
            a.hireDate ? { label: "Fecha de ingreso", value: a.hireDate } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const row = await hrService.createEmployee({ authUserId: actx.actorAuthUserId, companyId: actx.companyId, payload: input });
      const nombre = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
      return { id: row.id, summary: `Colaborador creado: ${nombre}`, link: LINK(row.id) };
    },
  };

  const update = {
    key: "hr.employee.update",
    moduleKey: "runly.hr",
    operation: "update",
    label: "Editar colaborador",
    permission: "hr.employee.update",
    description:
      "Cambia los datos de un colaborador existente (puesto, departamento, contacto, tipo de empleo, estado, notas). Usa el employeeId de hr_employees_search o el nombre; envia solo los campos que cambian. No cambia el supervisor ni la cuenta vinculada.",
    parameters: {
      type: "object",
      properties: {
        employeeId: { type: "string" },
        employeeName: { type: "string" },
        firstName: { type: "string" },
        lastName: { type: "string" },
        department: { type: "string" },
        position: { type: "string" },
        workEmail: { type: "string" },
        personalEmail: { type: "string" },
        phone: { type: "string" },
        employmentType: { type: "string", enum: ["full_time", "part_time", "contractor", "intern"] },
        workLocation: { type: "string" },
        status: { type: "string", enum: ["active", "inactive", "vacation", "terminated"] },
        notes: { type: "string" },
      },
    },
    async prepare(args, actx) {
      const parsed = updateArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el colaborador a editar y los campos a cambiar." };
      const a = parsed.data;
      const found = await resolveEmployee(actx, a);
      if (found.error) return { error: found.error };
      const row = found.employee;
      const data = {};
      const fields = [{ label: "Colaborador", value: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() }];

      if (a.firstName !== undefined && a.firstName !== row.firstName) {
        data.firstName = a.firstName;
        fields.push({ label: "Nombre", before: row.firstName, value: a.firstName });
      }
      if (a.lastName !== undefined && a.lastName !== row.lastName) {
        data.lastName = a.lastName;
        fields.push({ label: "Apellido", before: row.lastName, value: a.lastName });
      }
      const maybe = (key, label, current) => {
        if (a[key] !== undefined && a[key] !== (current ?? "")) {
          data[key] = a[key];
          fields.push({ label, before: current || "(vacio)", value: a[key] || "(vacio)" });
        }
      };
      maybe("workEmail", "Correo laboral", row.workEmail);
      maybe("personalEmail", "Correo personal", row.personalEmail);
      maybe("phone", "Telefono", row.phone);
      maybe("workLocation", "Ubicacion", row.workLocation);
      if (a.notes !== undefined && a.notes !== (row.notesMarkdown ?? "")) {
        data.notesMarkdown = a.notes;
        fields.push({ label: "Notas", before: row.notesMarkdown ? "(con contenido)" : "(vacio)", value: a.notes ? "(con contenido)" : "(vacio)" });
      }
      if (a.employmentType !== undefined && a.employmentType !== row.employmentType) {
        data.employmentType = a.employmentType;
        fields.push({ label: "Tipo de empleo", before: EMPLOYMENT_TYPE_LABEL[row.employmentType] ?? row.employmentType ?? "(vacio)", value: EMPLOYMENT_TYPE_LABEL[a.employmentType] });
      }
      if (a.status !== undefined && a.status !== row.status) {
        data.status = a.status;
        fields.push({ label: "Estado", before: STATUS_LABEL[row.status] ?? row.status, value: STATUS_LABEL[a.status] });
      }
      if (a.department !== undefined) {
        const dept = a.department === null ? { id: null, name: null } : await resolveDepartment(actx, a.department);
        if (dept.error) return { error: dept.error };
        const before = row.departmentRef?.name ?? row.department ?? null;
        if ((dept.name ?? null) !== before) {
          data.departmentId = dept.id;
          fields.push({ label: "Departamento", before: before ?? "(sin departamento)", value: dept.name ?? "(sin departamento)" });
        }
      }
      if (a.position !== undefined) {
        const jobTitle = a.position === null ? { id: null, name: null } : await resolveJobTitle(actx, a.position);
        if (jobTitle.error) return { error: jobTitle.error };
        const before = row.jobTitleRef?.name ?? row.jobTitle ?? null;
        if ((jobTitle.name ?? null) !== before) {
          data.jobTitleId = jobTitle.id;
          fields.push({ label: "Puesto", before: before ?? "(sin puesto)", value: jobTitle.name ?? "(sin puesto)" });
        }
      }

      if (!Object.keys(data).length) return { error: "No indicaste ningun cambio respecto al colaborador actual." };
      return { input: { employeeId: row.id, data }, preview: { title: "Editar colaborador", fields }, targetId: row.id };
    },
    async execute(input, actx) {
      const row = await hrService.updateEmployee({ authUserId: actx.actorAuthUserId, companyId: actx.companyId, id: input.employeeId, payload: input.data });
      const nombre = `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim();
      return { id: row.id, summary: `Colaborador actualizado: ${nombre}`, link: LINK(row.id) };
    },
  };

  const deactivate = {
    key: "hr.employee.deactivate",
    moduleKey: "runly.hr",
    operation: "delete",
    label: "Desactivar colaborador",
    permission: "hr.employee.delete",
    description: "Desactiva (da de baja logica) a un colaborador existente. Usa el employeeId de hr_employees_search o el nombre.",
    parameters: { type: "object", properties: { employeeId: { type: "string" }, employeeName: { type: "string" } } },
    async prepare(args, actx) {
      const parsed = targetArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el colaborador a desactivar." };
      const found = await resolveEmployee(actx, parsed.data);
      if (found.error) return { error: found.error };
      const row = found.employee;
      return {
        input: { employeeId: row.id },
        targetId: row.id,
        preview: {
          title: "Desactivar colaborador",
          fields: [
            { label: "Colaborador", value: `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() },
            { label: "Puesto", value: row.jobTitleRef?.name ?? row.jobTitle ?? "(sin puesto)" },
          ],
        },
      };
    },
    async execute(input, actx) {
      const row = await hrService.setEmployeeEnabled({ authUserId: actx.actorAuthUserId, companyId: actx.companyId, id: input.employeeId, enabled: false });
      return { id: row.id, summary: `Colaborador desactivado: ${`${row.firstName ?? ""} ${row.lastName ?? ""}`.trim()}` };
    },
  };

  return [create, update, deactivate];
}
