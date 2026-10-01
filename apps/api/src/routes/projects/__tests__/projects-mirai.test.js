// apps/api/src/routes/projects/__tests__/projects-mirai.test.js
//
// Focused tests for runly.projects MirAI tools/actions (spec
// 2026-09-30-mirai-remaining-modules §4): tools return exact totals + ids,
// prepare() never writes, execute() goes through the service + effects, and
// project-role filtering (VIEWER cannot create/update/delete tasks).
import test from "node:test";
import assert from "node:assert/strict";
import { createProjectsMiraiQueries } from "../projects-mirai-queries.js";
import { createProjectsMiraiActions } from "../mirai-actions.js";
import { createProjectsMiraiCapabilities } from "../mirai-capabilities.js";

const actx = { companyId: "co1", actorProfileId: "me", actorAuthUserId: "auth", actorProfile: { id: "me", displayName: "Yo" } };
const PROJECT = { id: "p1", name: "Lanzamiento", companyId: "co1", ownerId: "me", members: [] };

function fakeProjectsSvc(projects = [PROJECT]) {
  return { listProjects: async () => projects, getProject: async () => null };
}

test("projects_list_tasks: returns exact total and up to 30 rows with taskId", async () => {
  const tasks = [
    { id: "t1", title: "A", priority: "HIGH", dueDate: null, project: { name: "Lanzamiento" }, status: { name: "Backlog" }, assignee: null },
  ];
  const prisma = {
    task: { count: async () => 1, findMany: async () => tasks },
  };
  const [projects_list_tasks] = createProjectsMiraiQueries({ prisma, projectsSvc: fakeProjectsSvc() });
  const out = await projects_list_tasks.run({}, actx);
  assert.equal(out.total, 1);
  assert.deepEqual(out.tareas[0], { taskId: "t1", titulo: "A", proyecto: "Lanzamiento", estado: "Backlog", prioridad: "HIGH", asignado: null, vence: null });
});

test("projects_list_tasks: no accessible projects short-circuits without querying tasks", async () => {
  const prisma = { task: { count: async () => { throw new Error("should not be called"); } } };
  const [projects_list_tasks] = createProjectsMiraiQueries({ prisma, projectsSvc: fakeProjectsSvc([]) });
  const out = await projects_list_tasks.run({}, actx);
  assert.deepEqual(out, { total: 0, tareas: [] });
});

test("projects_task_summary: exact counts by status and overdue", async () => {
  const prisma = {
    task: {
      count: async ({ where }) => (where.dueDate ? 1 : 3),
      groupBy: async ({ by }) => (by[0] === "statusId" ? [{ statusId: "s1", _count: { id: 3 } }] : []),
    },
    taskStatus: { findMany: async () => [{ id: "s1", name: "Backlog" }] },
    userProfile: { findMany: async () => [] },
  };
  const [, projects_task_summary] = createProjectsMiraiQueries({ prisma, projectsSvc: fakeProjectsSvc() });
  const out = await projects_task_summary.run({}, actx);
  assert.equal(out.total, 3);
  assert.deepEqual(out.porEstado, [{ estado: "Backlog", tareas: 3 }]);
  assert.equal(out.vencidas, 1);
});

function setupActions({ task = null, statuses = [{ id: "s1", name: "Backlog", isDefault: true }], members = [] } = {}) {
  const calls = [];
  const prisma = {
    taskStatus: { findMany: async () => statuses },
    task: { findFirst: async () => task },
    projectMember: { findMany: async () => members, findFirst: async () => null },
    userProfile: { findFirst: async () => null },
  };
  const tasksSvc = {
    createTask: async (projectId, createdBy, data) => { calls.push(["create", data]); return { id: "t1", projectId, title: data.title, assigneeId: data.assigneeId ?? null, dueDate: null }; },
    updateTask: async (id, data) => { calls.push(["update", id, data]); return { ...task, ...data, id }; },
    deleteTask: async (id) => { calls.push(["delete", id]); return task; },
  };
  const effects = {
    afterCreate: async () => calls.push(["fx:create"]),
    afterUpdate: async () => calls.push(["fx:update"]),
    afterDelete: async () => calls.push(["fx:delete"]),
  };
  const actions = Object.fromEntries(createProjectsMiraiActions({ prisma, projectsSvc: fakeProjectsSvc(), tasksSvc, effects }).map((a) => [a.key, a]));
  return { actions, calls };
}

test("create: resolves the default status, writes nothing in prepare", async () => {
  const { actions, calls } = setupActions();
  const out = await actions["projects.task.create"].prepare({ project: "Lanzamiento", title: "Nueva tarea" }, actx);
  assert.equal(out.input.projectId, "p1");
  assert.equal(out.input.statusId, "s1");
  assert.equal(calls.length, 0);
});

test("create: unknown project lists the caller's projects", async () => {
  const { actions } = setupActions();
  const out = await actions["projects.task.create"].prepare({ project: "No existe", title: "x" }, actx);
  assert.match(out.error, /No encontre el proyecto/);
});

test("create: a VIEWER-only project is rejected", async () => {
  const viewerProject = { ...PROJECT, ownerId: "someone-else" };
  const prisma = { projectMember: { findFirst: async () => ({ role: "VIEWER" }) } };
  const actions = Object.fromEntries(
    createProjectsMiraiActions({ prisma, projectsSvc: fakeProjectsSvc([viewerProject]), tasksSvc: {}, effects: {} }).map((a) => [a.key, a]),
  );
  const out = await actions["projects.task.create"].prepare({ project: "Lanzamiento", title: "x" }, actx);
  assert.match(out.error, /No tienes acceso suficiente/);
});

test("create: execute calls tasksSvc and the shared effects", async () => {
  const { actions, calls } = setupActions();
  const res = await actions["projects.task.create"].execute({ projectId: "p1", title: "x", statusId: "s1", assigneeId: null, priority: "NONE", dueDate: null }, actx);
  assert.equal(res.id, "t1");
  assert.deepEqual(calls.map((c) => c[0]), ["create", "fx:create"]);
});

test("update: changing status previews before/after and targets the task", async () => {
  const task = { id: "t1", title: "Tarea", projectId: "p1", statusId: "s1", status: { name: "Backlog" }, assignee: null, assigneeId: null, priority: "NONE", dueDate: null, project: PROJECT };
  const { actions } = setupActions({ task, statuses: [{ id: "s1", name: "Backlog" }, { id: "s2", name: "Listo" }] });
  const out = await actions["projects.task.update"].prepare({ taskId: "t1", status: "Listo" }, actx);
  assert.equal(out.input.data.statusId, "s2");
  assert.equal(out.targetId, "t1");
  assert.ok(out.preview.fields.some((f) => f.label === "Estado" && f.before === "Backlog"));
});

test("update: no-op change returns an error", async () => {
  const task = { id: "t1", title: "Tarea", projectId: "p1", statusId: "s1", status: { name: "Backlog" }, assignee: null, assigneeId: null, priority: "NONE", dueDate: null, project: PROJECT };
  const { actions } = setupActions({ task });
  const out = await actions["projects.task.update"].prepare({ taskId: "t1", title: "Tarea" }, actx);
  assert.match(out.error, /ningun cambio/);
});

test("delete: unknown task returns an error; execute calls deleteTask and effects", async () => {
  const notFound = setupActions().actions["projects.task.delete"];
  assert.ok((await notFound.prepare({ taskId: "nope" }, actx)).error);

  const task = { id: "t1", title: "Tarea", projectId: "p1", status: { name: "Backlog" }, project: PROJECT };
  const { actions, calls } = setupActions({ task });
  const prepared = await actions["projects.task.delete"].prepare({ taskId: "t1" }, actx);
  assert.equal(prepared.targetId, "t1");
  const res = await actions["projects.task.delete"].execute({ taskId: "t1" }, actx);
  assert.equal(res.id, "t1");
  assert.deepEqual(calls.map((c) => c[0]), ["delete", "fx:delete"]);
});

test("describeContext: returns null for a task in another company", async () => {
  const prisma = { task: { findFirst: async () => ({ id: "t1", title: "x", project: { companyId: "other-co" }, status: {} }) } };
  const cap = createProjectsMiraiCapabilities({ prisma, effects: {} });
  const line = await cap.describeContext({ recordType: "task", recordId: "t1" }, actx);
  assert.equal(line, null);
});
