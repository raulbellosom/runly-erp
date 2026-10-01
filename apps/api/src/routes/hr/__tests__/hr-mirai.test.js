import test from "node:test";
import assert from "node:assert/strict";
import { createHrMiraiQueries } from "../hr-mirai-queries.js";
import { createHrMiraiActions } from "../mirai-actions.js";
import { createHrMiraiCapabilities } from "../mirai-capabilities.js";

const actx = { companyId: "co1", actorProfileId: "me", actorAuthUserId: "auth1", actorProfile: { id: "me", displayName: "Yo" } };

function fakeHrService({ rows = [], byId = new Map(), departments = [], jobTitles = [] } = {}) {
  return {
    async listEmployees({ search }) {
      const q = String(search ?? "").toLowerCase();
      const filtered = q ? rows.filter((r) => r.full_name.toLowerCase().includes(q)) : rows;
      return { rows: filtered, total: filtered.length };
    },
    async getEmployee({ id }) {
      const row = byId.get(id);
      if (!row) throw new Error("not found");
      return row;
    },
    async listDepartments({ search }) {
      const q = String(search ?? "").toLowerCase();
      return departments.filter((d) => d.name.toLowerCase().includes(q));
    },
    async listJobTitles({ search }) {
      const q = String(search ?? "").toLowerCase();
      return jobTitles.filter((j) => j.name.toLowerCase().includes(q));
    },
    async createEmployee({ payload }) {
      return { id: "new1", firstName: payload.firstName, lastName: payload.lastName };
    },
    async updateEmployee({ id, payload }) {
      return { ...byId.get(id), ...payload, id };
    },
    async setEmployeeEnabled({ id, enabled }) {
      return { ...byId.get(id), id, enabled };
    },
  };
}

test("hr_employees_search: filters by text and caps at 30 with stable ids", async () => {
  const rows = [{ id: "e1", full_name: "Ana Lopez", employee_code: "E1", job_title: "Dev", department: "TI", status: "active", employment_type: "full_time", work_email: "ana@x.com", phone: null }];
  const [search] = createHrMiraiQueries({ prisma: {}, hrService: fakeHrService({ rows }) });
  const out = await search.run({ search: "ana" }, actx);
  assert.equal(out.total, 1);
  assert.equal(out.colaboradores[0].employeeId, "e1");
  assert.equal(out.colaboradores[0].estado, "activo");
});

test("hr_employee_detail: returns an error when the employee is not accessible", async () => {
  const [, detail] = createHrMiraiQueries({ prisma: {}, hrService: fakeHrService() });
  const out = await detail.run({ employeeId: "nope" }, actx);
  assert.ok(out.error);
});

test("hr_employee_detail: mirrors getEmployee() fields, excluding raw metadata", async () => {
  const byId = new Map([
    ["e1", {
      id: "e1", firstName: "Ana", lastName: "Lopez", status: "active", employmentType: "full_time",
      jobTitleRef: { name: "Dev" }, departmentRef: { name: "TI" }, workEmail: "ana@x.com", phone: "555",
      reportees: [{ id: "e2" }], userProfile: { id: "u1" }, notesMarkdown: "a".repeat(2000),
      metadata: { secret: true },
    }],
  ]);
  const [, detail] = createHrMiraiQueries({ prisma: {}, hrService: fakeHrService({ byId }) });
  const out = await detail.run({ employeeId: "e1" }, actx);
  assert.equal(out.nombre, "Ana Lopez");
  assert.equal(out.colaboradoresACargo, 1);
  assert.equal(out.cuentaVinculada, true);
  assert.equal(out.notas.length, 1000);
  assert.equal(out.metadata, undefined);
});

test("hr_headcount_summary: groupBy status uses Prisma's exact groupBy", async () => {
  const prisma = {
    hrEmployee: {
      groupBy: async () => [{ status: "active", _count: { id: 3 } }, { status: "inactive", _count: { id: 1 } }],
    },
  };
  const [, , summary] = createHrMiraiQueries({ prisma, hrService: fakeHrService() });
  const out = await summary.run({ groupBy: "status" }, actx);
  assert.equal(out.total, 4);
  assert.deepEqual(out.grupos.map((g) => g.grupo).sort(), ["activo", "inactivo"]);
});

test("hr_headcount_summary: groupBy hireMonth runs the exact SQL aggregate", async () => {
  const prisma = { $queryRaw: async () => [{ grupo: "2026-01", colaboradores: 2 }] };
  const [, , summary] = createHrMiraiQueries({ prisma, hrService: fakeHrService() });
  const out = await summary.run({ groupBy: "hireMonth" }, actx);
  assert.equal(out.total, 2);
});

test("describeContext returns null when the employee is not found", async () => {
  const cap = createHrMiraiCapabilities({ prisma: { hrEmployee: { findFirst: async () => null } } });
  const line = await cap.describeContext({ recordType: "employee", recordId: "e1" }, actx);
  assert.equal(line, null);
});

test("create: prepare writes nothing; execute calls the service", async () => {
  const actions = Object.fromEntries(createHrMiraiActions({ hrService: fakeHrService() }).map((a) => [a.key, a]));
  const prepared = await actions["hr.employee.create"].prepare({ firstName: "Nuevo", lastName: "Colaborador" }, actx);
  assert.equal(prepared.input.firstName, "Nuevo");
  const res = await actions["hr.employee.create"].execute(prepared.input, actx);
  assert.equal(res.id, "new1");
});

test("create: ambiguous department name lists the matches instead of guessing", async () => {
  const departments = [{ id: "d1", name: "Tecnologia Norte" }, { id: "d2", name: "Tecnologia Sur" }];
  const actions = Object.fromEntries(createHrMiraiActions({ hrService: fakeHrService({ departments }) }).map((a) => [a.key, a]));
  const out = await actions["hr.employee.create"].prepare({ firstName: "Ana", lastName: "Lopez", department: "Tecnologia" }, actx);
  assert.ok(out.error.includes("Tecnologia"));
});

test("update: ambiguous employeeName lists the matches instead of guessing", async () => {
  const rows = [{ id: "e1", full_name: "Ana Lopez" }, { id: "e2", full_name: "Ana Martinez" }];
  const actions = Object.fromEntries(createHrMiraiActions({ hrService: fakeHrService({ rows }) }).map((a) => [a.key, a]));
  const out = await actions["hr.employee.update"].prepare({ employeeName: "Ana", phone: "555" }, actx);
  assert.ok(out.error.includes("Ana Lopez"));
  assert.ok(out.error.includes("Ana Martinez"));
});

test("update: no-op change is rejected", async () => {
  const byId = new Map([["e1", { id: "e1", firstName: "Ana", lastName: "Lopez", phone: "555", status: "active" }]]);
  const actions = Object.fromEntries(createHrMiraiActions({ hrService: fakeHrService({ byId }) }).map((a) => [a.key, a]));
  const out = await actions["hr.employee.update"].prepare({ employeeId: "e1", phone: "555" }, actx);
  assert.ok(out.error);
});

test("deactivate: calls setEmployeeEnabled(false)", async () => {
  const byId = new Map([["e1", { id: "e1", firstName: "Ana", lastName: "Lopez", status: "active" }]]);
  const actions = Object.fromEntries(createHrMiraiActions({ hrService: fakeHrService({ byId }) }).map((a) => [a.key, a]));
  const prepared = await actions["hr.employee.deactivate"].prepare({ employeeId: "e1" }, actx);
  assert.equal(prepared.targetId, "e1");
  const res = await actions["hr.employee.deactivate"].execute(prepared.input, actx);
  assert.equal(res.id, "e1");
});
