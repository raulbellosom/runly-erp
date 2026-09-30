import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createContactsService, ContactsServiceError } from "../contacts-service.js";

function buildPrismaMock({ profile, membership, contact }) {
  return {
    userProfile: {
      findUnique: async () => profile,
    },
    membership: {
      findFirst: async () => membership,
    },
    contact: {
      findFirst: async ({ where }) => {
        if (contact && where.id === contact.id && where.companyId === contact.companyId) {
          return contact;
        }
        return null;
      },
    },
  };
}

describe("contacts-service — getById", () => {
  it("returns the contact when it belongs to the caller's company", async () => {
    const contact = { id: "contact-1", companyId: "company-1", name: "Ada Lovelace" };
    const prisma = buildPrismaMock({
      profile: { id: "profile-1" },
      membership: { companyId: "company-1" },
      contact,
    });
    const service = createContactsService({ prisma });
    const result = await service.getById({ authUserId: "auth-1", companyId: "company-1", id: "contact-1" });
    assert.deepEqual(result, contact);
  });

  it("throws 404 when the contact belongs to a different company", async () => {
    const contact = { id: "contact-1", companyId: "company-OTHER", name: "Ada Lovelace" };
    const prisma = buildPrismaMock({
      profile: { id: "profile-1" },
      membership: { companyId: "company-1" },
      contact,
    });
    const service = createContactsService({ prisma });
    await assert.rejects(
      () => service.getById({ authUserId: "auth-1", companyId: "company-1", id: "contact-1" }),
      (err) => err instanceof ContactsServiceError && err.status === 404,
    );
  });

  it("throws 404 when the contact id doesn't exist", async () => {
    const prisma = buildPrismaMock({
      profile: { id: "profile-1" },
      membership: { companyId: "company-1" },
      contact: null,
    });
    const service = createContactsService({ prisma });
    await assert.rejects(
      () => service.getById({ authUserId: "auth-1", companyId: "company-1", id: "does-not-exist" }),
      (err) => err instanceof ContactsServiceError && err.status === 404,
    );
  });

  it("uses the passed-in companyId instead of re-deriving via membership — the multi-tenant fix", async () => {
    // Regression test: getCompanyContext used to always re-derive the
    // company via membership.findFirst({ orderBy: createdAt desc }),
    // ignoring the caller's validated active company entirely. The mocked
    // membership here resolves to a DIFFERENT company than the one passed
    // explicitly — if the fix regresses, this contact (scoped to the
    // explicitly-passed company) would incorrectly 404.
    const contact = { id: "contact-1", companyId: "company-explicit", name: "Ada Lovelace" };
    const prisma = buildPrismaMock({
      profile: { id: "profile-1" },
      membership: { companyId: "company-STALE-FALLBACK" },
      contact,
    });
    const service = createContactsService({ prisma });
    const result = await service.getById({
      authUserId: "auth-1",
      companyId: "company-explicit",
      id: "contact-1",
    });
    assert.deepEqual(result, contact);
  });
});

describe("contacts-service — list filters, rows and summary", () => {
  it("buildListWhere adds type, tag and inclusive created-date bounds", async () => {
    const { buildListWhere } = await import("../contacts-service.js");
    const where = buildListWhere({ companyId: "c-1", type: "supplier", tag: "vip", createdFrom: "2026-09-01", createdTo: "2026-09-30" });
    assert.equal(where.companyId, "c-1");
    assert.equal(where.enabled, true);
    assert.equal(where.type, "supplier");
    assert.deepEqual(where.tags, { has: "vip" });
    assert.equal(where.createdAt.gte.getDate(), 1);
    assert.equal(where.createdAt.lte.getHours(), 23);
    assert.equal(buildListWhere({ companyId: "c-1", createdFrom: "bad" }).createdAt, undefined);
  });

  it("toListRow flattens the default address, primary person and counts", async () => {
    const { toListRow } = await import("../contacts-service.js");
    const row = toListRow({
      id: "k-1",
      name: "ACME",
      addresses: [{ city: "Monterrey", state: "NL" }],
      persons: [{ name: "Ana", role: "Compras" }],
      _count: { persons: 3, addresses: 2 },
    }, "https://thumb");
    assert.equal(row.location, "Monterrey, NL");
    assert.equal(row.primaryPersonName, "Ana");
    assert.equal(row.personsCount, 3);
    assert.equal(row.avatarUrl, "https://thumb");
    assert.equal(row.addresses, undefined);
  });

  it("summary counts active contacts by type plus inactive ones", async () => {
    const prisma = {
      contact: {
        groupBy: async () => [{ type: "customer", _count: { _all: 4 } }, { type: "supplier", _count: { _all: 2 } }],
        count: async ({ where }) => (where.enabled === false ? 5 : 0),
      },
    };
    const service = createContactsService({ prisma });
    const result = await service.summary({ companyId: "c-1" });
    assert.deepEqual(result, { total: 6, inactive: 5, byType: { customer: 4, supplier: 2 } });
  });
});
