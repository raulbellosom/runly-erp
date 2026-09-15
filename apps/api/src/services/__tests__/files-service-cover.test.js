// apps/api/src/services/__tests__/files-service-cover.test.js
//
// Unit tests for the generic setFileCover/reorderFiles methods added to
// files-service.js for the HR employee blueprint migration (see
// docs/superpowers/specs/2026-09-15-hr-employee-blueprint-migration-design.md).
// Mock-based (this repo's heavier files-workspace-fixture.js integration
// suite requires a local FILES_TEST_DATABASE_URL and is skipped without one
// — not available in this environment, so these are plain unit tests
// against a minimal prisma mock, matching this session's other new tests).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFilesService } from "../files-service.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const OTHER_COMPANY_ID = "01900000-0000-7000-8000-000000000009";
const AUTH_USER_ID = "01900000-0000-7000-8000-000000000002";
const PROFILE_ID = "01900000-0000-7000-8000-000000000003";
const EMPLOYEE_ID = "01900000-0000-7000-8000-000000000004";
const FILE_A = "01900000-0000-7000-8000-000000000005";
const FILE_B = "01900000-0000-7000-8000-000000000006";

function metadataMatches(row, where) {
  if (!where?.metadata) return true;
  const { path, equals } = where.metadata;
  let cursor = row.metadata;
  for (const key of path) cursor = cursor?.[key];
  return cursor === equals;
}

// Handles both plain-value equality (where.entityId = "x") and Prisma's
// `{ in: [...] }` operator (where.entityType = { in: ALLOWED_TYPES }),
// since files-service.js's real queries use both shapes.
function fieldMatches(rowValue, whereValue) {
  if (whereValue === undefined) return true;
  if (whereValue && typeof whereValue === "object" && Array.isArray(whereValue.in)) {
    return whereValue.in.includes(rowValue);
  }
  return rowValue === whereValue;
}

function rowMatches(row, where) {
  if (!fieldMatches(row.id, where.id)) return false;
  if (!fieldMatches(row.entityId, where.entityId)) return false;
  if (!fieldMatches(row.moduleKey, where.moduleKey)) return false;
  if (!fieldMatches(row.entityType, where.entityType)) return false;
  if (!fieldMatches(row.enabled, where.enabled)) return false;
  if (!metadataMatches(row, where)) return false;
  return true;
}

function buildPrismaMock(files) {
  const byId = new Map(files.map((f) => [f.id, { enabled: true, ...f }]));
  return {
    userProfile: { findUnique: async () => ({ id: PROFILE_ID }) },
    membership: { findFirst: async () => ({ companyId: COMPANY_ID }) },
    fileAsset: {
      findFirst: async ({ where }) => {
        const row = [...byId.values()].find((r) => rowMatches(r, where));
        return row ? { ...row } : null;
      },
      findMany: async ({ where, orderBy }) => {
        let rows = [...byId.values()].filter((r) => rowMatches(r, where));
        if (orderBy?.sortOrder) rows = rows.sort((a, b) => a.sortOrder - b.sortOrder);
        return rows.map((r) => ({ ...r }));
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of byId.values()) {
          if (rowMatches(row, where)) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
      update: async ({ where, data }) => {
        const row = byId.get(where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
    $transaction: async (ops) => Promise.all(ops),
  };
}

describe("files-service setFileCover", () => {
  it("marks the target file as cover and clears any other cover in the same group", async () => {
    const prisma = buildPrismaMock([
      {
        id: FILE_A,
        entityId: COMPANY_ID,
        moduleKey: "runly.hr",
        entityType: "HrEmployee",
        metadata: { sourceEntityId: EMPLOYEE_ID },
        isCover: true,
        sortOrder: 0,
      },
      {
        id: FILE_B,
        entityId: COMPANY_ID,
        moduleKey: "runly.hr",
        entityType: "HrEmployee",
        metadata: { sourceEntityId: EMPLOYEE_ID },
        isCover: false,
        sortOrder: 1,
      },
    ]);
    const service = createFilesService({ prisma, supabaseAdmin: {} });
    const result = await service.setFileCover({
      authUserId: AUTH_USER_ID,
      activeContext: { companyId: COMPANY_ID, profileId: PROFILE_ID },
      id: FILE_B,
    });
    assert.equal(result.isCover, true);
    const other = await prisma.fileAsset.findFirst({ where: { id: FILE_A } });
    assert.equal(other.isCover, false);
  });

  it("rejects a file with no moduleKey/entityType/sourceEntityId group", async () => {
    const prisma = buildPrismaMock([
      { id: FILE_A, entityId: COMPANY_ID, moduleKey: null, entityType: null, metadata: null, isCover: false, sortOrder: 0 },
    ]);
    const service = createFilesService({ prisma, supabaseAdmin: {} });
    await assert.rejects(() =>
      service.setFileCover({
        authUserId: AUTH_USER_ID,
        activeContext: { companyId: COMPANY_ID, profileId: PROFILE_ID },
        id: FILE_A,
      }),
    );
  });
});

describe("files-service reorderFiles", () => {
  it("writes sequential sortOrder for the given group, in the requested order", async () => {
    const prisma = buildPrismaMock([
      { id: FILE_A, entityId: COMPANY_ID, moduleKey: "runly.hr", entityType: "HrEmployee", metadata: { sourceEntityId: EMPLOYEE_ID }, isCover: false, sortOrder: 0 },
      { id: FILE_B, entityId: COMPANY_ID, moduleKey: "runly.hr", entityType: "HrEmployee", metadata: { sourceEntityId: EMPLOYEE_ID }, isCover: false, sortOrder: 1 },
    ]);
    const service = createFilesService({ prisma, supabaseAdmin: {} });
    const result = await service.reorderFiles({
      authUserId: AUTH_USER_ID,
      activeContext: { companyId: COMPANY_ID, profileId: PROFILE_ID },
      moduleKey: "runly.hr",
      entityType: "HrEmployee",
      entityId: EMPLOYEE_ID,
      orderedIds: [FILE_B, FILE_A],
    });
    assert.deepEqual(result.map((r) => r.id), [FILE_B, FILE_A]);
    assert.equal(result[0].sortOrder, 0);
    assert.equal(result[1].sortOrder, 1);
  });

  it("never reorders files belonging to a different company, even if entityId matches", async () => {
    const prisma = buildPrismaMock([
      { id: FILE_A, entityId: OTHER_COMPANY_ID, moduleKey: "runly.hr", entityType: "HrEmployee", metadata: { sourceEntityId: EMPLOYEE_ID }, isCover: false, sortOrder: 0 },
    ]);
    const service = createFilesService({ prisma, supabaseAdmin: {} });
    const result = await service.reorderFiles({
      authUserId: AUTH_USER_ID,
      activeContext: { companyId: COMPANY_ID, profileId: PROFILE_ID },
      moduleKey: "runly.hr",
      entityType: "HrEmployee",
      entityId: EMPLOYEE_ID,
      orderedIds: [FILE_A],
    });
    assert.deepEqual(result, []);
  });
});
