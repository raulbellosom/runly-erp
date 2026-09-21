import assert from "node:assert/strict";
import { test } from "node:test";

import { FormsServiceError, createFormsService } from "../forms-service.js";

const COMPANY_ID = "11111111-1111-7111-8111-111111111111";
const SITE_ID = "22222222-2222-7222-8222-222222222222";
const USER_ID = "33333333-3333-7333-8333-333333333333";

function createPrismaStub() {
  const forms = [];
  return {
    websiteForm: {
      findMany: async ({ where }) =>
        forms.filter((f) => f.companyId === where.companyId && f.siteId === where.siteId && f.enabled === where.enabled),
      findFirst: async ({ where }) =>
        forms.find((f) => f.id === where.id && f.companyId === where.companyId) ?? null,
      create: async ({ data }) => {
        const created = { id: `form-${forms.length}`, enabled: true, ...data };
        forms.push(created);
        return created;
      },
    },
    membership: {
      findFirst: async ({ where }) =>
        where.userId === USER_ID && where.companyId === COMPANY_ID ? { id: "membership-1" } : null,
    },
  };
}

test("createForm rejects a defaultAssigneeUserId that isn't an active member", async () => {
  const service = createFormsService({ prisma: createPrismaStub() });
  await assert.rejects(
    () =>
      service.createForm({
        companyId: COMPANY_ID,
        siteId: SITE_ID,
        data: { name: "Contacto", defaultAssigneeUserId: "44444444-4444-7444-8444-444444444444" },
      }),
    (error) => {
      assert.ok(error instanceof FormsServiceError);
      assert.equal(error.status, 422);
      return true;
    },
  );
});

test("createForm + listForms happy path", async () => {
  const service = createFormsService({ prisma: createPrismaStub() });
  const created = await service.createForm({
    companyId: COMPANY_ID,
    siteId: SITE_ID,
    data: { name: "Contacto", defaultAssigneeUserId: USER_ID },
  });
  assert.equal(created.name, "Contacto");

  const list = await service.listForms({ companyId: COMPANY_ID, siteId: SITE_ID });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, created.id);
});

test("listFormAssignees lists only active company members", async () => {
  const service = createFormsService({
    prisma: {
      membership: {
        findMany: async ({ where }) => {
          assert.deepEqual(where, {
            companyId: COMPANY_ID,
            enabled: true,
            user: { enabled: true },
          });
          return [
            {
              user: {
                id: USER_ID,
                displayName: "Ana Lopez",
                email: "ana@example.com",
              },
            },
          ];
        },
      },
    },
  });

  const assignees = await service.listFormAssignees({ companyId: COMPANY_ID });
  assert.deepEqual(assignees, [
    { id: USER_ID, displayName: "Ana Lopez", email: "ana@example.com" },
  ]);
});
