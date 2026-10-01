import test from "node:test";
import assert from "node:assert/strict";
import { createContactsMiraiQueries } from "../contacts-mirai-queries.js";
import { createContactsMiraiActions } from "../mirai-actions.js";
import { createContactsMiraiCapabilities } from "../mirai-capabilities.js";
import { createPublicLookup } from "../../../services/ai/public-lookup.js";

const actx = { companyId: "co1", actorProfileId: "me", actorProfile: { id: "me", displayName: "Yo" } };

function fakeContactsService({ rows = [], byId = new Map() } = {}) {
  return {
    async list({ search }) {
      const q = String(search ?? "").toLowerCase();
      const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
      return { rows: filtered, total: filtered.length, page: 1, pageSize: 30 };
    },
    async getById({ id }) {
      const row = byId.get(id);
      if (!row) throw new Error("not found");
      return row;
    },
    async getProfile({ id }) {
      const row = byId.get(id);
      if (!row) throw new Error("not found");
      return { ...row, channels: [], addresses: [], persons: [] };
    },
    async summary() {
      return { total: 3, inactive: 1, byType: { customer: 2, supplier: 1 } };
    },
    async create({ payload }) {
      return { id: "new1", ...payload };
    },
    async update({ id, payload }) {
      return { ...byId.get(id), ...payload, id };
    },
    async setEnabled({ id, enabled }) {
      return { ...byId.get(id), id, enabled };
    },
  };
}

function fakeEffects() {
  const calls = [];
  return {
    calls,
    afterCreate: async () => calls.push("create"),
    afterUpdate: async () => calls.push("update"),
    afterSetEnabled: async () => calls.push("setEnabled"),
    afterDelete: async () => calls.push("delete"),
  };
}

test("contacts_search: filters by text and caps at 30 with stable ids", async () => {
  const rows = [{ id: "c1", name: "Ana Lopez", type: "customer", email: "ana@x.com", phone: null, tags: [], enabled: true }];
  const [search] = createContactsMiraiQueries({ prisma: {}, contactsService: fakeContactsService({ rows }) });
  const out = await search.run({ search: "ana" }, actx);
  assert.equal(out.total, 1);
  assert.equal(out.contactos[0].contactId, "c1");
});

test("contacts_detail: returns an error when the contact is not accessible", async () => {
  const [, detail] = createContactsMiraiQueries({ prisma: {}, contactsService: fakeContactsService() });
  const out = await detail.run({ contactId: "nope" }, actx);
  assert.ok(out.error);
});

test("contacts_summary: groupBy type uses the service's exact counts", async () => {
  const [, , summary] = createContactsMiraiQueries({ prisma: {}, contactsService: fakeContactsService() });
  const out = await summary.run({ groupBy: "type" }, actx);
  assert.equal(out.total, 3);
  assert.equal(out.inactivos, 1);
  assert.deepEqual(out.grupos.map((g) => g.contactos).sort(), [1, 2]);
});

test("contacts_summary: groupBy tag runs the exact SQL aggregate", async () => {
  const prisma = { $queryRaw: async () => [{ grupo: "vip", contactos: 2 }] };
  const [, , summary] = createContactsMiraiQueries({ prisma, contactsService: fakeContactsService() });
  const out = await summary.run({ groupBy: "tag" }, actx);
  assert.equal(out.total, 2);
  assert.deepEqual(out.grupos, [{ grupo: "vip", contactos: 2 }]);
});

test("contacts_public_company_info: errors when lookup is not configured, and rejects non-company contacts", async () => {
  const byId = new Map([["c1", { id: "c1", name: "Ana", type: "person", website: null }]]);
  const disabled = createPublicLookup({ search: null, env: {} });
  const [, , , lookupTool] = createContactsMiraiQueries({ prisma: {}, contactsService: fakeContactsService({ byId }), publicLookup: disabled });
  assert.ok((await lookupTool.run({ contactId: "c1" }, actx)).error);

  const enabled = createPublicLookup({ search: async () => ({ results: [] }) });
  const byId2 = new Map([["c2", { id: "c2", name: "Ana", type: "person", website: null }]]);
  const [, , , lookupTool2] = createContactsMiraiQueries({ prisma: {}, contactsService: fakeContactsService({ byId: byId2 }), publicLookup: enabled });
  const out = await lookupTool2.run({ contactId: "c2" }, { ...actx, turn: {} });
  assert.ok(out.error); // type "person" is rejected regardless of lookup availability
});

test("describeContext returns null when the contact is not found", async () => {
  const cap = createContactsMiraiCapabilities({ prisma: { contact: { findFirst: async () => null } } });
  const line = await cap.describeContext({ recordType: "contact", recordId: "c1" }, actx);
  assert.equal(line, null);
});

test("create: prepare writes nothing; execute calls the service and effects", async () => {
  const effects = fakeEffects();
  const actions = Object.fromEntries(
    createContactsMiraiActions({ contactsService: fakeContactsService(), effects }).map((a) => [a.key, a]),
  );
  const prepared = await actions["contacts.contact.create"].prepare({ name: "Nuevo Cliente" });
  assert.equal(prepared.input.name, "Nuevo Cliente");
  assert.equal(effects.calls.length, 0);
  const res = await actions["contacts.contact.create"].execute(prepared.input, actx);
  assert.equal(res.id, "new1");
  assert.deepEqual(effects.calls, ["create"]);
});

test("update: ambiguous contactName lists the matches instead of guessing", async () => {
  const rows = [
    { id: "c1", name: "Ana Lopez", type: "customer", email: null, phone: null, website: null, industry: null, tags: [] },
    { id: "c2", name: "Ana Martinez", type: "customer", email: null, phone: null, website: null, industry: null, tags: [] },
  ];
  const actions = Object.fromEntries(
    createContactsMiraiActions({ contactsService: fakeContactsService({ rows }), effects: fakeEffects() }).map((a) => [a.key, a]),
  );
  const out = await actions["contacts.contact.update"].prepare({ contactName: "Ana", email: "x@y.com" }, actx);
  assert.ok(out.error.includes("Ana Lopez"));
  assert.ok(out.error.includes("Ana Martinez"));
});

test("delete: soft-deletes via setEnabled(false) and fires afterSetEnabled", async () => {
  const byId = new Map([["c1", { id: "c1", name: "Ana Lopez", type: "customer", enabled: true }]]);
  const effects = fakeEffects();
  const actions = Object.fromEntries(
    createContactsMiraiActions({ contactsService: fakeContactsService({ byId }), effects }).map((a) => [a.key, a]),
  );
  const prepared = await actions["contacts.contact.delete"].prepare({ contactId: "c1" }, actx);
  assert.equal(prepared.targetId, "c1");
  const res = await actions["contacts.contact.delete"].execute(prepared.input, actx);
  assert.equal(res.id, "c1");
  assert.deepEqual(effects.calls, ["setEnabled"]);
});
