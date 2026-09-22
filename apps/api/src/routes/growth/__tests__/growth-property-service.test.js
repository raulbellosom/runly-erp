import assert from "node:assert/strict";
import { test } from "node:test";

import { createGrowthPropertyService } from "../growth-property-service.js";

const COMPANY_ID = "11111111-1111-7111-8111-111111111111";
const SITE_ID = "22222222-2222-7222-8222-222222222222";

function createPrismaStub({ growthProperties = [], websiteSites = [], growthEvents = [] } = {}) {
  const properties = [...growthProperties];
  return {
    growthProperty: {
      findFirst: async ({ where }) =>
        properties.find(
          (p) =>
            p.companyId === where.companyId &&
            (!where.id || p.id === where.id) &&
            (where.enabled === undefined || p.enabled === where.enabled) &&
            (where.domain === undefined || p.domain === where.domain),
        ) ?? null,
      findMany: async ({ where }) =>
        properties.filter((p) => p.companyId === where.companyId && p.enabled === where.enabled),
      upsert: async ({ where, create }) => {
        const key = where.companyId_websiteSiteId;
        const existing = properties.find(
          (p) => p.companyId === key.companyId && p.websiteSiteId === key.websiteSiteId,
        );
        if (existing) return existing;
        const created = { id: `mirrored-${key.websiteSiteId}`, enabled: true, ...create };
        properties.push(created);
        return created;
      },
      create: async ({ data }) => {
        const created = { id: `new-${properties.length}`, enabled: true, ...data };
        properties.push(created);
        return created;
      },
      update: async ({ where, data }) => {
        const target = properties.find((p) => p.id === where.id);
        Object.assign(target, data);
        return target;
      },
    },
    websiteSite: {
      findFirst: async ({ where }) =>
        websiteSites.find((s) => s.companyId === where.companyId && s.id === where.id) ?? null,
      findMany: async ({ where }) =>
        websiteSites.filter((s) => s.companyId === where.companyId && s.enabled === where.enabled),
    },
    growthEvent: {
      findFirst: async ({ where }) =>
        growthEvents.find((e) => e.companyId === where.companyId && e.siteId === where.siteId) ?? null,
    },
  };
}

test("resolveProperty mirrors a WebsiteSite on first call and reuses it on the second", async () => {
  const prisma = createPrismaStub({
    websiteSites: [
      {
        id: SITE_ID,
        companyId: COMPANY_ID,
        name: "Acme",
        domain: "acme.test",
        analyticsMode: "standard",
        enabled: true,
      },
    ],
  });
  const service = createGrowthPropertyService({ prisma });

  const first = await service.resolveProperty({ companyId: COMPANY_ID, propertyId: SITE_ID });
  assert.equal(first.kind, "website_module");
  assert.equal(first.websiteSiteId, SITE_ID);

  const mirroredCount = (
    await prisma.growthProperty.findMany({ where: { companyId: COMPANY_ID, enabled: true } })
  ).length;
  assert.equal(mirroredCount, 1);

  const second = await service.resolveProperty({ companyId: COMPANY_ID, propertyId: SITE_ID });
  assert.equal(second.id, first.id);
});

test("resolveProperty returns null when neither a GrowthProperty nor a WebsiteSite match", async () => {
  const prisma = createPrismaStub();
  const service = createGrowthPropertyService({ prisma });
  const result = await service.resolveProperty({ companyId: COMPANY_ID, propertyId: SITE_ID });
  assert.equal(result, null);
});

test("createExternalProperty + verifyProperty happy path", async () => {
  const prisma = createPrismaStub();
  const service = createGrowthPropertyService({ prisma });

  const created = await service.createExternalProperty({
    companyId: COMPANY_ID,
    name: "runly.mx",
    domain: "https://runly.mx",
  });
  assert.equal(created.kind, "external_sdk");
  assert.equal(created.status, "pending_verification");

  const notYet = await service.verifyProperty({ companyId: COMPANY_ID, propertyId: created.id });
  assert.equal(notYet.verified, false);

  const withEvent = createPrismaStub({
    growthProperties: [created],
    growthEvents: [{ companyId: COMPANY_ID, siteId: created.id }],
  });
  const service2 = createGrowthPropertyService({ prisma: withEvent });
  const verified = await service2.verifyProperty({ companyId: COMPANY_ID, propertyId: created.id });
  assert.equal(verified.verified, true);
  assert.equal(verified.property.status, "active");
});

test("updateProperty encrypts turnstileSecretKey before storing it", async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-for-growth-property-service";
  const created = {
    id: "prop-1",
    companyId: COMPANY_ID,
    kind: "external_sdk",
    domain: "runly.mx",
    enabled: true,
  };
  const prisma = createPrismaStub({ growthProperties: [created] });
  const service = createGrowthPropertyService({ prisma });

  const updated = await service.updateProperty({
    companyId: COMPANY_ID,
    propertyId: "prop-1",
    patch: { turnstileSiteKey: "0x-site-key", turnstileSecretKey: "0x-secret-key" },
  });

  assert.equal(updated.turnstileSiteKey, "0x-site-key");
  assert.ok(updated.turnstileSecretKey);
  assert.notEqual(updated.turnstileSecretKey, "0x-secret-key");
});

test("createExternalProperty rejects a duplicate domain for the same company", async () => {
  const prisma = createPrismaStub({
    growthProperties: [
      {
        id: "existing-1",
        companyId: COMPANY_ID,
        kind: "external_sdk",
        domain: "runly.mx",
        enabled: true,
      },
    ],
  });
  const service = createGrowthPropertyService({ prisma });

  await assert.rejects(
    () => service.createExternalProperty({ companyId: COMPANY_ID, name: "Dup", domain: "runly.mx" }),
    (error) => {
      assert.equal(error.code, "property_domain_conflict");
      assert.equal(error.status, 409);
      return true;
    },
  );
});
