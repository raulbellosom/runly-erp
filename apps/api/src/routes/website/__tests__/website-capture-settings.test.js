import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createWebsiteService } from "../website-service.js";
import {
  createFormFieldSchema,
  createFormSchema,
  updateSiteSchema,
} from "../validators.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const SITE_ID = "01900000-0000-7000-8000-000000000002";
const USER_ID = "01900000-0000-7000-8000-000000000003";

describe("website capture validators", () => {
  it("accepts analytics, Turnstile, lead, antispam, assignee, and semantics", () => {
    const site = updateSiteSchema.parse({
      analyticsMode: "consent_required",
      turnstileSiteKey: "public-key",
      turnstileSecretKey: "secret-key",
    });
    assert.equal(site.analyticsMode, "consent_required");
    assert.equal(site.turnstileSiteKey, "public-key");
    assert.equal(site.turnstileSecretKey, "secret-key");

    const form = createFormSchema.parse({
      siteId: SITE_ID,
      name: "Contacto",
      createsLead: true,
      defaultAssigneeUserId: USER_ID,
      honeypotEnabled: true,
      turnstileRequired: true,
    });
    assert.equal(form.createsLead, true);
    assert.equal(form.defaultAssigneeUserId, USER_ID);
    assert.equal(form.honeypotEnabled, true);
    assert.equal(form.turnstileRequired, true);

    const field = createFormFieldSchema.parse({
      label: "Correo",
      name: "email",
      fieldType: "email",
      semanticKey: "email",
    });
    assert.equal(field.semanticKey, "email");
  });
});

describe("website capture settings service", () => {
  it("never returns encrypted Stripe or Turnstile secrets", async () => {
    const service = createWebsiteService({
      prisma: {
        websiteSite: {
          findFirst: async () => ({
            id: SITE_ID,
            companyId: COMPANY_ID,
            stripeSecretKey: "encrypted-stripe",
            turnstileSecretKey: "encrypted-turnstile",
          }),
        },
      },
    });

    const site = await service.getSite({ companyId: COMPANY_ID });
    assert.equal(site.stripeSecretKey, undefined);
    assert.equal(site.turnstileSecretKey, undefined);
    assert.equal(site.stripeSecretKeySet, true);
    assert.equal(site.turnstileSecretKeySet, true);
  });
});
