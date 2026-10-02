import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createFilePublicLinksService } from "../files/public-links.js";
import { createFilesPublicRouter } from "../../routes/files-public.js";

const COMPANY = "01900000-0000-7000-8000-000000000001";
const OWNER = "01900000-0000-7000-8000-0000000000a1";
const OTHER = "01900000-0000-7000-8000-0000000000b2";
const FILE = { id: "01900000-0000-7000-8000-0000000000f1", enabled: true, uploadedById: OWNER, bucket: "runly-files", objectKey: "k", originalName: "plano.pdf", mimeType: "application/pdf", sizeBytes: 10, entityId: COMPANY };

function setup({ profileId = OWNER, admin = false } = {}) {
  const links = [];
  const audits = [];
  const prisma = {
    modulePublicLink: {
      count: async () => links.filter((l) => !l.revokedAt).length,
      create: async ({ data }) => { const link = { id: `l${links.length + 1}`, useCount: 0, ...data }; links.push(link); return link; },
      findMany: async () => links,
      findFirst: async ({ where }) => links.find((l) => l.id === where.id) ?? null,
      findUnique: async ({ where }) => links.find((l) => l.token === where.token) ?? null,
      update: async ({ where, data }) => Object.assign(links.find((l) => l.id === where.id), data),
    },
    auditLog: { create: async ({ data }) => audits.push(data) },
    fileAsset: { findFirst: async () => FILE },
    company: { findUnique: async () => ({ name: "Acme", brandingConfig: null }) },
    $queryRaw: async () => [{ id: "counted" }],
  };
  const filesService = {
    getUserCompanyContext: async () => ({ profileId, companyId: COMPANY, admin, permissions: new Set() }),
    getById: async () => FILE,
  };
  const args = { authUserId: "auth", activeContext: {}, fileId: FILE.id };
  return { links, audits, prisma, args, service: createFilePublicLinksService({ prisma, filesService }) };
}

const storage = {
  from: () => ({
    createSignedUrl: async (key, seconds, options) => ({ data: { signedUrl: options?.download ? "https://dl" : "https://view" } }),
    getPublicUrl: () => ({ data: { publicUrl: "https://public" } }),
  }),
};

describe("file public links", () => {
  it("owner creates and revokes links with audit entries", async () => {
    const { service, args, audits } = setup();
    const link = await service.create({ ...args, input: { mode: "download", maxUses: 3 } });
    assert.equal(link.mode, "download");
    assert.equal(link.status, "activo");
    const revoked = await service.revoke({ ...args, linkId: link.id });
    assert.equal(revoked.status, "revocado");
    assert.deepEqual(audits.map((a) => a.action), ["files.link.create", "files.link.revoke"]);
  });

  it("rejects non-owners but allows admins", async () => {
    await assert.rejects(setup({ profileId: OTHER }).service.create({ ...setup().args, input: {} }), { status: 403 });
    const admin = setup({ profileId: OTHER, admin: true });
    assert.equal((await admin.service.create({ ...admin.args, input: {} })).mode, "view");
  });

  it("rejects past expiry and unknown modes", async () => {
    const { service, args } = setup();
    await assert.rejects(service.create({ ...args, input: { expiresAt: Date.now() - 1000 } }), { status: 400 });
    await assert.rejects(service.create({ ...args, input: { mode: "edit" } }), { status: 400 });
  });

  it("view links return a preview but no download URL; revoked links answer 410", async () => {
    const { service, args, prisma } = setup();
    const view = await service.create({ ...args, input: { mode: "view" } });
    const app = createFilesPublicRouter({ prisma, supabaseAdmin: { storage } });
    const res = await app.request(`/public/files/${view.token}`);
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.previewUrl, "https://view");
    assert.equal(data.downloadUrl, null);

    const download = await service.create({ ...args, input: { mode: "download" } });
    const dl = await (await app.request(`/public/files/${download.token}`)).json();
    assert.equal(dl.data.downloadUrl, "https://dl");

    await service.revoke({ ...args, linkId: view.id });
    const gone = await app.request(`/public/files/${view.token}`);
    assert.equal(gone.status, 410);
  });
});
