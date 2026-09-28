import test from "node:test";
import assert from "node:assert/strict";
import { createModuleFilesCapability } from "../module-files-service.js";

const COMPANY = "c-1";
function ctx(values = {}) {
  const map = { companyId: COMPANY, authUserId: "u-1", userId: "p-1", ...values };
  return { get: (key) => map[key] };
}

function setup(assets) {
  const calls = { updates: [], uploads: [], findMany: [] };
  const matches = (asset, where) => Object.entries(where).every(([key, value]) => key === "metadata" || asset[key] === value);
  const prisma = {
    fileAsset: {
      findFirst: async ({ where }) => assets.find((asset) => matches(asset, where)) ?? null,
      findMany: async (args) => { calls.findMany.push(args); return []; },
      update: async (args) => { calls.updates.push(args); return { id: args.where.id, ...args.data }; },
    },
  };
  const filesService = { upload: async (args) => { calls.uploads.push(args); return { id: "new" }; } };
  const supabaseAdmin = { storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://signed" } }) }) } };
  return { files: createModuleFilesCapability({ prisma, filesService, supabaseAdmin })("custom.taller"), calls };
}

const OWN = { id: "f1", moduleKey: "custom.taller", entityType: "taller.orden", entityId: COMPANY, enabled: true, metadata: {} };

test("upload forces the bound module key", async () => {
  const { files, calls } = setup([]);
  await files.upload(ctx(), { file: {}, entityType: "taller.orden", sourceEntityId: "r1" });
  assert.deepEqual(calls.uploads[0].fields, { moduleKey: "custom.taller", entityType: "taller.orden", entityId: "r1" });
});

test("list scopes by module, entity type, company and record", async () => {
  const { files, calls } = setup([]);
  await files.list(ctx(), { entityType: "taller.orden", sourceEntityId: "r1" });
  const where = calls.findMany[0].where;
  assert.equal(where.moduleKey, "custom.taller");
  assert.equal(where.entityId, COMPANY);
  assert.deepEqual(where.metadata, { path: ["sourceEntityId"], equals: "r1" });
});

test("link rejects foreign assets and assets owned by another record", async () => {
  const foreign = [
    { ...OWN, id: "other-company", entityId: "c-2" },
    { ...OWN, id: "other-module", moduleKey: "custom.otro" },
    { ...OWN, id: "other-type", entityType: "taller.cliente" },
  ];
  const { files, calls } = setup([...foreign, { ...OWN, id: "taken", metadata: { sourceEntityId: "r9" } }, OWN]);
  for (const asset of foreign) {
    await assert.rejects(files.link(ctx(), { fileId: asset.id, entityType: "taller.orden", sourceEntityId: "r1" }), { status: 404 });
  }
  await assert.rejects(files.link(ctx(), { fileId: "taken", entityType: "taller.orden", sourceEntityId: "r1" }), { status: 409 });
  await files.link(ctx(), { fileId: "f1", entityType: "taller.orden", sourceEntityId: "r1" });
  assert.equal(calls.updates[0].data.metadata.sourceEntityId, "r1");
});

test("remove disables only files of the given record", async () => {
  const { files, calls } = setup([{ ...OWN, metadata: { sourceEntityId: "r1" } }]);
  await assert.rejects(files.remove(ctx(), { fileId: "f1", entityType: "taller.orden", sourceEntityId: "r2" }), { status: 404 });
  await files.remove(ctx(), { fileId: "f1", entityType: "taller.orden", sourceEntityId: "r1" });
  assert.deepEqual(calls.updates[0].data, { enabled: false });
});

test("signedUrl requires an owned asset and an active company", async () => {
  const { files } = setup([OWN]);
  await assert.rejects(files.signedUrl(ctx(), { fileId: "nope", entityType: "taller.orden" }), { status: 404 });
  await assert.rejects(files.signedUrl(ctx({ companyId: null }), { fileId: "f1", entityType: "taller.orden" }), { status: 403 });
});
