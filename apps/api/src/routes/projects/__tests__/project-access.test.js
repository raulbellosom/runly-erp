// apps/api/src/routes/projects/__tests__/project-access.test.js
//
// Guards the 2026-08-30 fix: every /projects/:id/* route must verify the caller
// is a member of THAT project and that the project is in the caller's company —
// the company-wide RBAC grant is not enough.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createProjectsRouter } from "../projects-routes.js";

const COMPANY = "01900000-0000-7000-8000-000000000001";
const OTHER_COMPANY = "01900000-0000-7000-8000-0000000000ff";
const USER = "01900000-0000-7000-8000-000000000002";
const PROFILE = "01900000-0000-7000-8000-000000000003";

// requirePermission stub: injects the same context the real one would.
function requirePermission() {
  return async (c, next) => {
    c.set("userContext", {
      profile: { id: PROFILE, firstName: "T", lastName: "U" },
      memberships: [{ companyId: COMPANY }],
    });
    c.set("companyId", COMPANY);
    c.set("userId", PROFILE);
    c.set("authUserId", USER);
    await next();
  };
}

function buildRouter({ project, member }) {
  const prisma = {
    project: {
      findFirst: async () => project,
    },
    projectMember: {
      findFirst: async () => member,
      findMany: async () => [],
    },
    // getProject (VIEWER route handler) needs a fuller row + statuses:
    // reuse the same object.
    task: { findMany: async () => [] },
    calendarCalendar: { findFirst: async () => null },
  };
  // getProject in projects-service does its own findFirst with includes;
  // point it at the same project object.
  prisma.project.findFirst = async () => project;

  return createProjectsRouter({ prisma, requirePermission, notificationService: null });
}

describe("requireProjectAccess", () => {
  it('rejects a task UUID from another project even when the URL project is authorized', async () => {
    let mutated = false;
    const prisma = {
      project: { findFirst: async () => ({ id: 'allowed', companyId: COMPANY, ownerId: PROFILE }) },
      task: { findFirst: async ({ where }) => where.projectId === 'allowed' ? null : { id: 'foreign', projectId: 'other' }, update: async () => { mutated = true; } },
    };
    const router = createProjectsRouter({ prisma, requirePermission });
    const response = await router.request('/projects/allowed/tasks/foreign', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Unauthorized' }) });
    assert.equal(response.status, 404);
    assert.equal(mutated, false);
  });
  it("404 when the project is in a different company", async () => {
    const router = buildRouter({
      project: { id: "p1", companyId: OTHER_COMPANY, ownerId: "someone" },
      member: null,
    });
    const res = await router.request("/projects/p1", { method: "GET" });
    assert.equal(res.status, 404);
  });

  it("404 when the caller is not a member of the project", async () => {
    const router = buildRouter({
      project: { id: "p1", companyId: COMPANY, ownerId: "someone-else" },
      member: null,
    });
    const res = await router.request("/projects/p1", { method: "GET" });
    assert.equal(res.status, 404);
  });

  it("403 when a VIEWER member hits an OWNER-only route (edit project)", async () => {
    const router = buildRouter({
      project: { id: "p1", companyId: COMPANY, ownerId: "someone-else", members: [{ userId: PROFILE }], statuses: [] },
      member: { role: "VIEWER" },
    });
    const res = await router.request("/projects/p1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "x" }),
    });
    assert.equal(res.status, 403);
  });

  it("lets an OWNER through to an OWNER-only route", async () => {
    const project = { id: "p1", companyId: COMPANY, ownerId: PROFILE, members: [{ userId: PROFILE }], statuses: [] };
    const prisma = {
      project: {
        findFirst: async () => project,
        update: async () => ({ ...project, name: "renamed" }),
      },
      projectMember: { findFirst: async () => null, findMany: async () => [] },
      calendarCalendar: { findFirst: async () => null },
    };
    const router = createProjectsRouter({ prisma, requirePermission, notificationService: null });
    const res = await router.request("/projects/p1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    assert.equal(res.status, 200);
  });

  it("lets a MEMBER read the project (VIEWER route)", async () => {
    const router = buildRouter({
      project: { id: "p1", companyId: COMPANY, ownerId: "someone-else", members: [{ userId: PROFILE }], statuses: [] },
      member: { role: "MEMBER" },
    });
    const res = await router.request("/projects/p1", { method: "GET" });
    assert.equal(res.status, 200);
  });
});


describe('project routes publish notifications after successful mutations', () => {
  it('adding a member waits for the notification publisher', async () => {
    const publications = [];
    const prisma = {
      project: { findFirst: async () => ({ id: 'project', companyId: COMPANY, ownerId: PROFILE, name: 'Equipo' }) },
      membership: { findFirst: async () => ({ id: 'membership', role: { key: 'runly.admin' } }) },
      projectMember: { create: async ({ data }) => data },
    };
    const router = createProjectsRouter({ prisma, requirePermission, notificationService: { publish: async args => { await new Promise(resolve => setImmediate(resolve)); publications.push(args); } } });
    const res = await router.request('/projects/project/members', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: USER }) });
    assert.equal(res.status, 201);
    assert.equal(publications.length, 1);
    assert.equal(publications[0].input.eventType, 'projects.member.added');
    assert.deepEqual(publications[0].input.recipients.userIds, [USER]);
  });
  it('moving a task between columns notifies its assignee', async () => {
    const publications = [];
    let task = { id: 'task', projectId: 'project', statusId: 'old', assigneeId: USER, title: 'Tarea', assignees: [], project: { name: 'Equipo' } };
    const prisma = {
      project: { findFirst: async () => ({ id: 'project', companyId: COMPANY, ownerId: PROFILE }) },
      task: { findFirst: async () => ({ ...task }), updateMany: async () => ({ count: 0 }), update: async ({ data }) => (task = { ...task, ...data }) },
      taskStatus: { findFirst: async ({ where }) => ({ name: where.id }) },
    };
    const router = createProjectsRouter({ prisma, requirePermission, notificationService: { publish: async args => publications.push(args) } });
    const res = await router.request('/projects/project/tasks/task/move', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ statusId: 'new', position: 0 }) });
    assert.equal(res.status, 200);
    assert.equal(publications.length, 1);
    assert.equal(publications[0].input.eventType, 'projects.task.status_changed');
    assert.deepEqual(publications[0].input.recipients.userIds, [USER]);
  });
});
