import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFileVisibility, describeFile, FILE_ACCESS_RULES } from "../files/visibility.js";

const COMPANY = "01900000-0000-7000-8000-000000000001";
const ME = "01900000-0000-7000-8000-0000000000a1";
const OTHER = "01900000-0000-7000-8000-0000000000b2";
const BOARD = "01900000-0000-7000-8000-0000000000c3";
const HOTSPOT = "01900000-0000-7000-8000-0000000000d4";

// memberBoards: board ids the caller belongs to.
function fakePrisma({ memberBoards = [], shares = [], queryRows = [] } = {}) {
  const calls = [];
  const memberOf = (where) => memberBoards.includes(where.id ?? where.boardId);
  return {
    calls,
    fileAssetShare: {
      findUnique: async ({ where }) =>
        shares.find((s) => s.fileId === where.fileId_userId.fileId && s.userId === where.fileId_userId.userId) ?? null,
    },
    canvasBoard: {
      findMany: async () => memberBoards.map((id) => ({ id })),
      findFirst: async ({ where }) => (memberOf(where) ? { id: where.id } : null),
    },
    canvasHotspot: {
      findMany: async () => (memberBoards.length ? [{ id: HOTSPOT }] : []),
      findFirst: async ({ where }) => (memberBoards.length && where.id === HOTSPOT ? { id: HOTSPOT } : null),
    },
    canvasLibrary: { findMany: async () => [], findFirst: async () => null },
    task: { findMany: async () => [], findFirst: async () => null },
    $queryRaw: async (strings, ...values) => {
      calls.push(values);
      return queryRows;
    },
  };
}

const context = (extra = {}) => ({ profileId: ME, companyId: COMPANY, admin: false, permissions: new Set(), ...extra });
const file = (extra) => ({ id: "f1", entityId: COMPANY, accessScope: "COMPANY", uploadedById: OTHER, metadata: null, ...extra });

describe("files visibility", () => {
  it("hides a Canvas board attachment from a non-member and shows it to a member", async () => {
    const boardFile = file({ moduleKey: "runly.canvas", entityType: "CanvasBoard", metadata: { sourceEntityId: BOARD } });
    assert.equal(await createFileVisibility({ prisma: fakePrisma() }).canRead(boardFile, context()), false);
    assert.equal(await createFileVisibility({ prisma: fakePrisma({ memberBoards: [BOARD] }) }).canRead(boardFile, context()), true);
  });

  it("hides hotspot files from non-members", async () => {
    const hotspotFile = file({ moduleKey: "runly.canvas", entityType: "CanvasHotspot", metadata: { sourceEntityId: HOTSPOT } });
    assert.equal(await createFileVisibility({ prisma: fakePrisma() }).canRead(hotspotFile, context()), false);
    assert.equal(await createFileVisibility({ prisma: fakePrisma({ memberBoards: [BOARD] }) }).canRead(hotspotFile, context()), true);
  });

  it("admins read everything and list without filters", async () => {
    const visibility = createFileVisibility({ prisma: fakePrisma() });
    const receipt = file({ moduleKey: "runly.pfm", entityType: "PfmReceipt" });
    assert.equal(await visibility.canRead(receipt, context({ admin: true })), true);
    assert.deepEqual(await visibility.listWhere(context({ admin: true })), {});
  });

  it("runly.files uploads are private unless shared with the company", async () => {
    const visibility = createFileVisibility({ prisma: fakePrisma() });
    assert.equal(await visibility.canRead(file({ moduleKey: "runly.files", entityType: "AtlasFile", accessScope: "RESTRICTED" }), context()), false);
    assert.equal(await visibility.canRead(file({ moduleKey: "runly.files", entityType: "AtlasFile", accessScope: "COMPANY" }), context()), true);
    assert.equal(await visibility.canRead(file({ moduleKey: "runly.files", entityType: "AtlasFile", accessScope: "RESTRICTED", uploadedById: ME }), context()), true);
  });

  it("accepted shares grant access to a restricted file", async () => {
    const prisma = fakePrisma({ shares: [{ fileId: "f1", userId: ME, status: "ACCEPTED" }] });
    const restricted = file({ moduleKey: "runly.files", entityType: "AtlasFile", accessScope: "RESTRICTED" });
    assert.equal(await createFileVisibility({ prisma }).canRead(restricted, context()), true);
  });

  it("permission-gated modules require the module read permission", async () => {
    const visibility = createFileVisibility({ prisma: fakePrisma() });
    const hrFile = file({ moduleKey: "runly.hr", entityType: "HrEmployee" });
    assert.equal(await visibility.canRead(hrFile, context()), false);
    assert.equal(await visibility.canRead(hrFile, context({ permissions: new Set(["hr.employee.read"]) })), true);
  });

  it("personal receipts and unknown entity types are owner-only", async () => {
    const visibility = createFileVisibility({ prisma: fakePrisma() });
    assert.equal(await visibility.canRead(file({ moduleKey: "runly.pfm", entityType: "PfmReceipt" }), context()), false);
    assert.equal(await visibility.canRead(file({ moduleKey: "custom.x", entityType: "custom_thing" }), context()), false);
  });

  it("list filter resolves member boards into file ids", async () => {
    const prisma = fakePrisma({ memberBoards: [BOARD], queryRows: [{ id: "board-file" }] });
    const where = await createFileVisibility({ prisma }).listWhere(context());
    assert.ok(where.OR.some((clause) => clause.id?.in?.includes("board-file")));
    assert.ok(prisma.calls.some((values) => values.includes("CanvasBoard") && values.some((v) => Array.isArray(v) && v.includes(BOARD))));
    const open = where.OR.find((clause) => clause.entityType?.in);
    assert.ok(open.entityType.in.includes("UserProfile"));
    assert.ok(!open.entityType.in.includes("HrEmployee"));
  });

  it("describes origin and visibility for the UI", () => {
    assert.equal(describeFile(file({ moduleKey: "runly.files", entityType: "AtlasFile", accessScope: "RESTRICTED" })).access, "private");
    assert.equal(describeFile(file({ moduleKey: "runly.canvas", entityType: "CanvasBoard", metadata: { sourceEntityId: BOARD } })).origin.sourceEntityId, BOARD);
  });

  it("covers every entity type runly.files accepts", async () => {
    const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../files-service.js", import.meta.url), "utf8"));
    const list = source.match(/const ALLOWED_FILE_ENTITY_TYPES = \[([\s\S]*?)\];/)[1];
    const types = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(types.filter((type) => !FILE_ACCESS_RULES[type]), []);
  });
});
