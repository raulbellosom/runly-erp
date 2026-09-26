import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contactsProposalModule } from "../transcript-proposal-modules/contacts-proposal-module.js";

const COMPANY = "c1";
const OTHER_COMPANY = "c2";
const USER = "u1";
const MODULE_ID = "mod-contacts";

function basePrisma(overrides = {}) {
  return {
    runlyModule: {
      findUnique: async () => ({ id: MODULE_ID, status: "INSTALLED", enabled: true }),
    },
    companyModule: {
      findMany: async () => [], // no per-company override -> enabled by default
    },
    contact: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async ({ data }) => ({ id: "new-contact-1", ...data }),
      update: async ({ where, data }) => ({ id: where.id, ...data }),
    },
    membership: {
      findFirst: async () => null,
      findMany: async () => [],
    },
    userPermissionGrant: {
      findMany: async () => [],
    },
    ...overrides,
  };
}

describe("contactsProposalModule.isAvailable", () => {
  it("is available when the module is globally installed+enabled and not disabled for this company", async () => {
    const prisma = basePrisma();
    const result = await contactsProposalModule.isAvailable({ prisma, companyId: COMPANY });
    assert.equal(result, true);
  });

  it("is unavailable when the module is not INSTALLED at the instance level", async () => {
    const prisma = basePrisma({ runlyModule: { findUnique: async () => ({ id: MODULE_ID, status: "DISABLED", enabled: true }) } });
    const result = await contactsProposalModule.isAvailable({ prisma, companyId: COMPANY });
    assert.equal(result, false);
  });

  it("is unavailable when explicitly disabled for this company (CompanyModule override)", async () => {
    const prisma = basePrisma({ companyModule: { findMany: async () => [{ moduleId: MODULE_ID }] } });
    const result = await contactsProposalModule.isAvailable({ prisma, companyId: COMPANY });
    assert.equal(result, false);
  });
});

describe("contactsProposalModule.normalize", () => {
  it("drops proposals with no identifiable name and defaults an invalid suggestedType to 'person'", () => {
    const out = contactsProposalModule.normalize([
      { name: "Juan Pérez", suggestedType: "customer", email: "juan@acme.com" },
      { name: "", suggestedType: "customer" }, // no name -> dropped
      { name: "A", suggestedType: "customer" }, // too short -> dropped
      { name: "María López", suggestedType: "not-a-real-type" },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0].name, "Juan Pérez");
    assert.equal(out[0].email, "juan@acme.com");
    assert.equal(out[1].suggestedType, "person");
  });
});

describe("contactsProposalModule.matchExisting", () => {
  it("attaches matchedContactId on an exact case-insensitive name match, scoped to the company", async () => {
    const prisma = basePrisma({
      contact: {
        findMany: async ({ where }) => {
          assert.equal(where.companyId, COMPANY);
          return [{ id: "existing-1", type: "person", name: "Juan Pérez", legalName: null, email: null, phone: null, taxId: null }];
        },
      },
    });
    const [result] = await contactsProposalModule.matchExisting({
      prisma, companyId: COMPANY, proposals: [{ name: "juan pérez", suggestedType: "person" }],
    });
    assert.equal(result.matchedContactId, "existing-1");
  });

  it("leaves matchedContactId null when no exact match is found", async () => {
    const prisma = basePrisma();
    const [result] = await contactsProposalModule.matchExisting({
      prisma, companyId: COMPANY, proposals: [{ name: "Nadie Conocido", suggestedType: "person" }],
    });
    assert.equal(result.matchedContactId, null);
  });
});

function membershipWithPermission(key) {
  return {
    findFirst: async () => ({
      role: { key: "member", permissions: [{ permission: { key, active: true } }] },
    }),
    findMany: async () => [],
  };
}

describe("contactsProposalModule.assertWriteAccess", () => {
  it("rejects when the caller lacks contacts.contacts.create for a 'create' proposal (no match)", async () => {
    const prisma = basePrisma({ membership: membershipWithPermission("something.else") });
    await assert.rejects(
      contactsProposalModule.assertWriteAccess({
        prisma, profileId: USER, companyId: COMPANY,
        proposal: { matchedContactId: null }, decision: { type: "person" },
      }),
      /permiso/i,
    );
  });

  it("allows a 'create' proposal when the caller has contacts.contacts.create", async () => {
    const prisma = basePrisma({ membership: membershipWithPermission("contacts.contacts.create") });
    await assert.doesNotReject(
      contactsProposalModule.assertWriteAccess({
        prisma, profileId: USER, companyId: COMPANY,
        proposal: { matchedContactId: null }, decision: { type: "person" },
      }),
    );
  });

  it("requires contacts.contacts.update (not .create) for a matched proposal", async () => {
    const prisma = basePrisma({ membership: membershipWithPermission("contacts.contacts.create") });
    await assert.rejects(
      contactsProposalModule.assertWriteAccess({
        prisma, profileId: USER, companyId: COMPANY,
        proposal: { matchedContactId: "existing-1" }, decision: { type: "person" },
      }),
      /permiso/i,
    );
  });

  it("rejects an invalid/missing contact type even with full permission", async () => {
    const prisma = basePrisma({ membership: membershipWithPermission("contacts.contacts.create") });
    await assert.rejects(
      contactsProposalModule.assertWriteAccess({
        prisma, profileId: USER, companyId: COMPANY,
        proposal: { matchedContactId: null }, decision: { type: "not-a-type" },
      }),
      /tipo de contacto/i,
    );
  });
});

describe("contactsProposalModule.commit", () => {
  it("creates a new contact scoped to the company when there is no match", async () => {
    let createArgs;
    const prisma = basePrisma({ contact: { ...basePrisma().contact, create: async (args) => { createArgs = args; return { id: "new-1", ...args.data }; } } });
    const result = await contactsProposalModule.commit({
      prisma, profileId: USER, companyId: COMPANY,
      proposal: { name: "Juan Pérez", matchedContactId: null, email: "juan@acme.com", phone: null, company: null },
      decision: { type: "customer" },
    });
    assert.equal(result.id, "new-1");
    assert.equal(createArgs.data.companyId, COMPANY);
    assert.equal(createArgs.data.type, "customer");
    assert.equal(createArgs.data.name, "Juan Pérez");
  });

  it("updates the matched contact instead of creating a duplicate", async () => {
    let updateArgs;
    let ownershipCheckedCompany;
    const prisma = basePrisma({
      contact: {
        ...basePrisma().contact,
        findFirst: async ({ where }) => { ownershipCheckedCompany = where.companyId; return { id: where.id }; },
        update: async (args) => { updateArgs = args; return { id: args.where.id, ...args.data }; },
      },
    });
    const result = await contactsProposalModule.commit({
      prisma, profileId: USER, companyId: COMPANY,
      proposal: { name: "Juan Pérez", matchedContactId: "existing-1", email: "nuevo@acme.com", phone: null, company: null },
      decision: { type: "customer" },
    });
    assert.equal(result.id, "existing-1");
    assert.equal(updateArgs.where.id, "existing-1");
    assert.equal(updateArgs.data.email, "nuevo@acme.com");
    // update() re-derives ownership from the SAME companyId passed in, never
    // from the client — this is what protects against the cross-company
    // matchedContactId case (spec §19 point 2 / acceptance criterion 4).
    assert.equal(ownershipCheckedCompany, COMPANY);
  });

  it("never lets a matchedContactId belonging to another company be updated", async () => {
    const prisma = basePrisma({
      contact: {
        ...basePrisma().contact,
        // Real assertContactOwnership behavior: a contact that exists but
        // belongs to a DIFFERENT company is invisible to this query.
        findFirst: async ({ where }) => (where.companyId === OTHER_COMPANY ? { id: where.id } : null),
      },
    });
    await assert.rejects(
      contactsProposalModule.commit({
        prisma, profileId: USER, companyId: COMPANY,
        proposal: { name: "Alguien", matchedContactId: "contact-in-other-company", email: null, phone: null, company: null },
        decision: { type: "person" },
      }),
    );
  });
});
