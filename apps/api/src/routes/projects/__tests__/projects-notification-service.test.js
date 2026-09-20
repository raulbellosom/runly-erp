import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createProjectsNotificationService } from "../projects-notification-service.js";

const COMPANY_ID  = "01971a2b-0000-7000-8000-000000000001";
const ACTOR_ID    = "01971a2b-0000-7000-8000-000000000002";
const USER_A      = "01971a2b-0000-7000-8000-000000000003";
const TASK_ID     = "01971a2b-0000-7000-8000-000000000010";
const PROJECT_ID  = "01971a2b-0000-7000-8000-000000000020";
const STATUS_A_ID = "01971a2b-0000-7000-8000-000000000030";
const STATUS_B_ID = "01971a2b-0000-7000-8000-000000000031";

function buildPrismaMock() {
  const published = [];

  const fakeTask = {
    id: TASK_ID,
    title: "Tarea de prueba",
    taskNumber: 42,
    projectId: PROJECT_ID,
    project: { id: PROJECT_ID, name: "Proyecto X", companyId: COMPANY_ID },
    assignees: [{ userId: USER_A }],
  };

  const fakeProject = { id: PROJECT_ID, name: "Proyecto X" };

  return {
    task: { findFirst: async () => fakeTask },
    project: { findFirst: async () => fakeProject },
    taskStatus: {
      findFirst: async ({ where }) =>
        where.id === STATUS_A_ID ? { name: "Por hacer" } : { name: "En progreso" },
    },
    // findMany: used by resolveRecipientUserIds inside notifSvc.publish
    membership: {
      findFirst: async () => ({ companyId: COMPANY_ID }),
      findMany: async ({ where }) => {
        const ids = where?.userId?.in ?? [];
        return ids.map((id) => ({ userId: id }));
      },
    },
    $transaction: async (fn) =>
      fn({
        notification: {
          findFirst: async () => null,
          create: async ({ data }) => {
            published.push(data);
            return { id: "notif-1", ...data };
          },
        },
        notificationDelivery: { createMany: async () => {} },
        notificationPreference: { findFirst: async () => null },
      }),
    _published: published,
  };
}

describe("createProjectsNotificationService", () => {
  it("notifyTaskAssigned uses ?open=task:<id> link", async () => {
    const prisma = buildPrismaMock();
    const svc = createProjectsNotificationService({ prisma });
    await svc.notifyTaskAssigned({ companyId: COMPANY_ID, actorId: ACTOR_ID, taskId: TASK_ID, assignedUserId: USER_A });
    const link = prisma._published[0]?.link;
    assert.ok(link?.includes(`?open=task:${TASK_ID}`), `got: ${link}`);
  });

  it("notifyTaskUnassigned uses ?open=task:<id> link", async () => {
    const prisma = buildPrismaMock();
    const svc = createProjectsNotificationService({ prisma });
    await svc.notifyTaskUnassigned({ companyId: COMPANY_ID, actorId: ACTOR_ID, taskId: TASK_ID, removedUserId: USER_A });
    const link = prisma._published[0]?.link;
    assert.ok(link?.includes(`?open=task:${TASK_ID}`), `got: ${link}`);
  });

  it("notifyTaskComment uses ?open=task:<id> link", async () => {
    const prisma = buildPrismaMock();
    const svc = createProjectsNotificationService({ prisma });
    await svc.notifyTaskComment({ companyId: COMPANY_ID, authorId: ACTOR_ID, taskId: TASK_ID });
    const link = prisma._published[0]?.link;
    assert.ok(link?.includes(`?open=task:${TASK_ID}`), `got: ${link}`);
  });

  it("notifyTaskStatusChanged uses ?open=task:<id> link", async () => {
    const prisma = buildPrismaMock();
    const svc = createProjectsNotificationService({ prisma });
    await svc.notifyTaskStatusChanged({
      companyId: COMPANY_ID,
      actorId: ACTOR_ID,
      taskId: TASK_ID,
      oldStatusId: STATUS_A_ID,
      newStatusId: STATUS_B_ID,
    });
    const link = prisma._published[0]?.link;
    assert.ok(link?.includes(`?open=task:${TASK_ID}`), `got: ${link}`);
  });

  it("notifyMemberAdded uses ?open=project:<id> link", async () => {
    const prisma = buildPrismaMock();
    const svc = createProjectsNotificationService({ prisma });
    await svc.notifyMemberAdded({ companyId: COMPANY_ID, actorId: ACTOR_ID, projectId: PROJECT_ID, addedUserId: USER_A });
    const link = prisma._published[0]?.link;
    assert.ok(link?.includes(`?open=project:${PROJECT_ID}`), `got: ${link}`);
  });
});


describe('projects notification regressions', () => {
  it('keeps separate comments and sends a mention instead of a duplicate comment alert', async () => {
    const prisma = buildPrismaMock();
    const svc = createProjectsNotificationService({ prisma });
    for (const commentId of ['comment-a', 'comment-b']) {
      await svc.notifyTaskComment({ companyId: COMPANY_ID, authorId: ACTOR_ID, taskId: TASK_ID, commentId, mentionedUserIds: [USER_A] });
    }
    assert.equal(prisma._published.length, 2);
    assert.ok(prisma._published.every(n => n.eventType === 'projects.task.mention'));
    assert.notEqual(prisma._published[0].dedupeKey, prisma._published[1].dedupeKey);
  });
  it('reads reactions from generic comments and resolves the task', async () => {
    const prisma = buildPrismaMock();
    prisma.entityComment = { findFirst: async ({ where }) => {
      assert.equal(where.entityType, 'Task');
      assert.equal(where.companyId, COMPANY_ID);
      return { entityId: TASK_ID, authorId: USER_A };
    } };
    await createProjectsNotificationService({ prisma }).notifyTaskReaction({ companyId: COMPANY_ID, actorId: ACTOR_ID, commentId: 'comment-a' });
    assert.equal(prisma._published.length, 1);
    assert.equal(prisma._published[0].userId, USER_A);
    assert.equal(prisma._published[0].link, `/app/m/runly.projects?open=task:${TASK_ID}`);
  });
});


it('reminds primary assignees even without a multi-assignee row, once per day', async () => {
  const published = [];
  const keys = new Set();
  const prisma = {
    projectTaskAssignee: { findMany: async () => [] },
    task: { findMany: async () => [{ id: TASK_ID, assigneeId: USER_A, title: 'Vence hoy', projectId: PROJECT_ID, project: { companyId: COMPANY_ID } }] },
    notification: { findFirst: async ({ where }) => keys.has(where.dedupeKey) ? { id: 'existing' } : null },
  };
  const svc = createProjectsNotificationService({ prisma, notificationService: { publish: async args => { published.push(args); keys.add(args.input.dedupeKey); return { created: 1 }; } } });
  await svc.processTasksDueSoon();
  await svc.processTasksDueSoon();
  assert.equal(published.length, 1);
  assert.deepEqual(published[0].input.recipients.userIds, [USER_A]);
});
