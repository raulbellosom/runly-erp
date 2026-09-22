import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createChatEntityReferencesService } from "../chat-entity-references-service.js";

// Existing projection tests run as a member of the explicitly selected company.
function withActor(prisma = {}) {
  const membership = prisma.membership?.findFirst ?? (async () => ({ companyId: 'company-1' }));
  return {
    userProfile: { findUnique: async () => ({ id: 'profile-1' }) },
    project: { findFirst: async () => ({ id: 'proj-1', companyId: 'company-1' }) },
    task: { findFirst: async () => ({ projectId: 'proj-1' }) },
    ...prisma,
    membership: { findFirst: async args => {
      const row = await membership(args);
      return row ? { role: { key: 'runly.admin' }, ...row } : null;
    } },
  };
}

describe('explicit reference scope and permissions', () => {
  it('does not access any module without a company or its read permission', async () => {
    let accessed = false;
    const prisma = withActor();
    prisma.membership.findFirst = async () => ({ role: { key: 'restricted', permissions: [] } });
    prisma.userPermissionGrant = { findFirst: async () => null };
    const service = createChatEntityReferencesService({ prisma, contactsService: { getById: async () => { accessed = true; } } });
    const entityRefs = [{ entityType: 'contact', recordId: 'contact' }];
    assert.deepEqual(await service.resolveEntityRefs({ authUserId: 'test', entityRefs }), []);
    assert.deepEqual(await service.resolveEntityRefs({ authUserId: 'test', companyId: 'company-1', entityRefs }), []);
    assert.equal(accessed, false);
  });
  it('threads the conversation company through file and calendar authorization', async () => {
    const seen = [];
    const service = createChatEntityReferencesService({ prisma: withActor(),
      filesService: { getById: async ({ activeContext }) => { seen.push(activeContext.companyId); return { originalName: 'Example' }; } },
      calendarEventService: { getEvent: async (_user, _id, companyId) => { seen.push(companyId); return { title: 'Example', startAt: new Date() }; } },
    });
    await service.resolveEntityRefs({ authUserId: 'test', companyId: 'selected-company', entityRefs: [{ entityType: 'file', recordId: 'file' }, { entityType: 'calendar_event', recordId: 'event' }] });
    assert.deepEqual(seen, ['selected-company', 'selected-company']);
  });
});

describe("chat-entity-references-service — resolveEntityRefs", () => {
  it("resolves a contact reference via contactsService.getById", async () => {
    const deps = {
      contactsService: { getById: async ({ authUserId, id }) => {
        assert.equal(authUserId, "auth-1");
        assert.equal(id, "contact-1");
        return { id: "contact-1", name: "Ada Lovelace" };
      } },
      filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "contact", recordId: "contact-1" }],
    });
    assert.deepEqual(result, [{
      entityType: "contact", recordId: "contact-1", title: "Ada Lovelace",
      subtitle: null, url: "/app/m/runly.contacts/contacts/contact-1",
    }]);
  });

  it("resolves a contact reference's subtitle from phone, preferring it over email", async () => {
    const deps = {
      contactsService: { getById: async () => ({ id: "contact-1", name: "Ada Lovelace", phone: "555-0100", email: "ada@example.com" }) },
      filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "contact", recordId: "contact-1" }],
    });
    assert.equal(result[0].subtitle, "555-0100");
  });

  it("falls back to email for a contact reference's subtitle when there's no phone", async () => {
    const deps = {
      contactsService: { getById: async () => ({ id: "contact-1", name: "Ada Lovelace", email: "ada@example.com" }) },
      filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "contact", recordId: "contact-1" }],
    });
    assert.equal(result[0].subtitle, "ada@example.com");
  });

  it("resolves a file reference with originalName as title, includes mimeType and sizeBytes", async () => {
    const deps = {
      filesService: { getById: async () => ({ id: "file-1", originalName: "contrato.pdf", mimeType: "application/pdf", sizeBytes: 12345 }) },
      contactsService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "file", recordId: "file-1" }],
    });
    assert.deepEqual(result[0], {
      entityType: "file", recordId: "file-1", title: "contrato.pdf", subtitle: null,
      url: "/app/m/runly.files/files/file-1", mimeType: "application/pdf", sizeBytes: 12345,
    });
  });

  it("resolves a file reference with null mimeType and sizeBytes when not provided", async () => {
    const deps = {
      filesService: { getById: async () => ({ id: "file-1", originalName: "data.csv" }) },
      contactsService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "file", recordId: "file-1" }],
    });
    assert.deepEqual(result[0], {
      entityType: "file", recordId: "file-1", title: "data.csv", subtitle: null,
      url: "/app/m/runly.files/files/file-1", mimeType: null, sizeBytes: null,
    });
  });

  it("resolves an hr_employee reference joining first/last name", async () => {
    const deps = {
      hrService: { getEmployee: async () => ({ id: "emp-1", firstName: "Grace", lastName: "Hopper" }) },
      contactsService: {}, filesService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "hr_employee", recordId: "emp-1" }],
    });
    assert.equal(result[0].title, "Grace Hopper");
    assert.equal(result[0].url, "/app/m/runly.hr/hr/employees/emp-1");
    assert.equal(result[0].subtitle, null);
    assert.equal(result[0].photoFileId, null);
  });

  it("resolves an hr_employee reference's subtitle and photo from the richer row shape", async () => {
    const deps = {
      hrService: { getEmployee: async () => ({
        id: "emp-1", firstName: "Grace", lastName: "Hopper",
        jobTitleRef: { id: "jt-1", name: "Ingeniera de Software" },
        departmentRef: { id: "d-1", name: "Ingenieria" },
        profileImageFileId: "file-photo-1",
        userProfile: { id: "up-1", avatarFileId: "file-avatar-1" },
      }) },
      contactsService: {}, filesService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "hr_employee", recordId: "emp-1" }],
    });
    // Prefers jobTitleRef over the plain department, and the employee's own
    // profileImageFileId over the linked account's avatar.
    assert.equal(result[0].subtitle, "Ingeniera de Software");
    assert.equal(result[0].photoFileId, "file-photo-1");
  });

  it("falls back to userProfile.avatarFileId and department when hr_employee has no jobTitleRef/photo of its own", async () => {
    const deps = {
      hrService: { getEmployee: async () => ({
        id: "emp-1", firstName: "Grace", lastName: "Hopper",
        department: "Ingenieria",
        userProfile: { id: "up-1", avatarFileId: "file-avatar-1" },
      }) },
      contactsService: {}, filesService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "hr_employee", recordId: "emp-1" }],
    });
    assert.equal(result[0].subtitle, "Ingenieria");
    assert.equal(result[0].photoFileId, "file-avatar-1");
  });

  it("resolves a ledger_account reference, deriving companyId/actorId from authUserId (not passing authUserId through)", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: "profile-1" }) },
      membership: { findFirst: async () => ({ companyId: "company-1" }) },
    };
    let capturedArgs = null;
    const deps = {
      ledgerService: { getAccount: async (args) => {
        capturedArgs = args;
        return { id: "acct-1", name: "Cuenta principal", bank: "BBVA" };
      } },
      contactsService: {}, filesService: {}, hrService: {}, prisma,
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "ledger_account", recordId: "acct-1" }],
    });
    assert.deepEqual(capturedArgs, { companyId: "company-1", accountId: "acct-1", actorId: "profile-1" });
    assert.equal(result[0].title, "Cuenta principal · BBVA");
    assert.equal(result[0].url, "/app/m/runly.ledger/accounts/acct-1");
    assert.equal(result[0].subtitle, "BBVA");
    assert.equal(result[0].currency, null);
    assert.equal(result[0].balance, null);
  });

  it("resolves a ledger_account reference's masked account number, currency, and balance from the raw-query row shape", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: "profile-1" }) },
      membership: { findFirst: async () => ({ companyId: "company-1" }) },
    };
    const deps = {
      ledgerService: { getAccount: async () => ({
        id: "acct-1", name: "Cuenta principal", bank: "BBVA",
        account_number: "0123456789", currency: "MXN", current_balance: "1250.50",
      }) },
      contactsService: {}, filesService: {}, hrService: {}, prisma,
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "ledger_account", recordId: "acct-1" }],
    });
    assert.equal(result[0].subtitle, "BBVA · ····6789");
    assert.equal(result[0].currency, "MXN");
    assert.equal(result[0].balance, 1250.5);
  });

  it("drops (does not throw) a reference the caller can't resolve", async () => {
    const deps = {
      contactsService: { getById: async () => { const e = new Error("no"); e.status = 404; throw e; } },
      filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "contact", recordId: "contact-1" }],
    });
    assert.deepEqual(result, []);
  });

  it("drops an unknown entityType without throwing", async () => {
    const deps = { contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma: {} };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "totally_unknown", recordId: "x" }],
    });
    assert.deepEqual(result, []);
  });

  it("resolves multiple refs in parallel (Promise.all), not sequentially", async () => {
    const order = [];
    const deps = {
      contactsService: { getById: async () => { order.push("contact-start"); await new Promise((r) => setTimeout(r, 10)); order.push("contact-end"); return { id: "c1", name: "C" }; } },
      filesService: { getById: async () => { order.push("file-start"); order.push("file-end"); return { id: "f1", originalName: "F" }; } },
      hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "contact", recordId: "c1" }, { entityType: "file", recordId: "f1" }],
    });
    // If sequential, file wouldn't start until contact fully finished — this
    // proves they overlap.
    assert.deepEqual(order, ["contact-start", "file-start", "file-end", "contact-end"]);
  });
});

describe("chat-entity-references-service — project/task/calendar_event", () => {
  it("resolves a project reference, deriving profileId from authUserId (not passing authUserId through)", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: "profile-1" }) },
      membership: { findFirst: async () => ({ companyId: "company-1" }) },
    };
    let capturedArgs = null;
    const deps = {
      projectsService: { getProject: async (id, userId) => { capturedArgs = { id, userId }; return { id: "proj-1", name: "Relanzamiento web", color: "#6366f1", icon: "Rocket" }; } },
      tasksService: {}, calendarEventService: {}, contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma,
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "project", recordId: "proj-1" }],
    });
    assert.deepEqual(capturedArgs, { id: "proj-1", userId: "profile-1" });
    assert.deepEqual(result, [{
      entityType: "project", recordId: "proj-1", title: "Relanzamiento web",
      subtitle: null, url: "/app/m/runly.projects/proj-1", color: "#6366f1", icon: "Rocket",
    }]);
  });

  it("drops a project reference the caller cannot access (404 from getProject)", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: "profile-1" }) },
      membership: { findFirst: async () => ({ companyId: "company-1" }) },
    };
    const deps = {
      projectsService: { getProject: async () => { throw new Error("Proyecto no encontrado."); } },
      tasksService: {}, calendarEventService: {}, contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma,
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "project", recordId: "proj-1" }],
    });
    assert.deepEqual(result, []);
  });

  it("resolves a task reference, using the task's status name as subtitle", async () => {
    const deps = {
      tasksService: { getTask: async (id) => { assert.equal(id, "task-1"); return { id: "task-1", title: "Diseñar landing", status: { name: "En progreso" } }; } },
      projectsService: {}, calendarEventService: {}, contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "task", recordId: "task-1" }],
    });
    assert.deepEqual(result, [{
      entityType: "task", recordId: "task-1", title: "Diseñar landing",
      subtitle: "En progreso", url: "/app/m/runly.projects/tasks/task-1",
    }]);
  });

  it("resolves a calendar_event reference, deriving profileId from authUserId", async () => {
    const prisma = {
      userProfile: { findUnique: async () => ({ id: "profile-1" }) },
      membership: { findFirst: async () => ({ companyId: "company-1" }) },
    };
    let capturedArgs = null;
    const deps = {
      calendarEventService: { getEvent: async (userId, id) => { capturedArgs = { userId, id }; return { id: "evt-1", title: "Reunion de seguimiento", startAt: "2026-09-01T15:00:00.000Z" }; } },
      projectsService: {}, tasksService: {}, contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma,
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "calendar_event", recordId: "evt-1" }],
    });
    assert.deepEqual(capturedArgs, { userId: "profile-1", id: "evt-1" });
    assert.equal(result[0].title, "Reunion de seguimiento");
    assert.equal(result[0].url, "/app/m/runly.calendar/events/evt-1");
    assert.equal(typeof result[0].subtitle, "string");
  });
});

describe("chat-entity-references-service — vehicle/inventory_item", () => {
  it("resolves a vehicle reference, using plate as title and brand/model/year as subtitle", async () => {
    const deps = {
      fleetService: { getVehicle: async ({ id }) => {
        assert.equal(id, "vehicle-1");
        return {
          plate: "ABC-123", vehicle_brand_name: "Toyota", vehicle_model_name: "Hilux",
          vehicle_model_year: 2022, status: "active", cover_image_file_asset_id: "file-9",
        };
      } },
      inventoryService: {}, projectsService: {}, tasksService: {}, calendarEventService: {},
      contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "vehicle", recordId: "vehicle-1" }],
    });
    assert.deepEqual(result, [{
      entityType: "vehicle", recordId: "vehicle-1", title: "ABC-123",
      subtitle: "Toyota Hilux 2022", url: "/app/m/runly.fleet/vehicles/vehicle-1",
      status: "active", coverImageFileId: "file-9",
    }]);
  });

  it("drops a vehicle reference the caller cannot access (404 from getVehicle)", async () => {
    const deps = {
      fleetService: { getVehicle: async () => { throw new Error("Vehiculo no encontrado."); } },
      inventoryService: {}, projectsService: {}, tasksService: {}, calendarEventService: {},
      contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "vehicle", recordId: "vehicle-1" }],
    });
    assert.deepEqual(result, []);
  });

  it("resolves an inventory_item reference, using assetTag/categoryName as subtitle", async () => {
    const deps = {
      inventoryService: { getItem: async (id, companyId) => {
        assert.equal(id, "item-1");
        assert.equal(companyId, "company-1");
        return { name: "Taladro Bosch", assetTag: "AST-2026-004", categoryName: "Herramientas", status: "available", coverImageFileId: "file-7" };
      } },
      fleetService: {}, projectsService: {}, tasksService: {}, calendarEventService: {},
      contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "inventory_item", recordId: "item-1" }],
    });
    assert.deepEqual(result, [{
      entityType: "inventory_item", recordId: "item-1", title: "Taladro Bosch",
      subtitle: "AST-2026-004 · Herramientas", url: "/app/m/runly.inventory/inventory/item-1",
      status: "available", coverImageFileId: "file-7",
    }]);
  });

  it("drops an inventory_item reference the caller cannot access (404 from getItem)", async () => {
    const deps = {
      inventoryService: { getItem: async () => { throw new Error("Item not found"); } },
      fleetService: {}, projectsService: {}, tasksService: {}, calendarEventService: {},
      contactsService: {}, filesService: {}, hrService: {}, ledgerService: {}, prisma: {},
    };
    const service = createChatEntityReferencesService({ ...deps, prisma: withActor(deps.prisma) });
    const result = await service.resolveEntityRefs({
      authUserId: "auth-1", companyId: "company-1",
      entityRefs: [{ entityType: "inventory_item", recordId: "item-1" }],
    });
    assert.deepEqual(result, []);
  });
});
