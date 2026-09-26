import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { SEARCH_PROVIDERS } from "../search-providers.js";

function bySource(source) {
  const provider = SEARCH_PROVIDERS.find((p) => p.source === source);
  assert.ok(provider, `provider ${source} exists`);
  return provider;
}

describe("search providers", () => {
  it("exposes contacts, users, employees and help with permissions and targets", () => {
    assert.deepEqual(
      SEARCH_PROVIDERS.map((p) => p.source),
      ["contacts", "users", "employees", "help"],
    );
    assert.equal(bySource("contacts").permission, "contacts.contacts.read");
    assert.equal(bySource("users").permission, "identity.users.read");
    assert.equal(bySource("employees").permission, "hr.employee.read");
    assert.equal(bySource("help").permission, "runly.help.read");
    assert.equal(
      bySource("contacts").target("abc"),
      "/app/m/runly.contacts/contacts/abc",
    );
    assert.equal(
      bySource("users").target("u1"),
      "/app/m/runly.identity/identity/users/u1",
    );
    assert.equal(
      bySource("employees").target("e1"),
      "/app/m/runly.hr/hr/employees/e1",
    );
    assert.equal(bySource("help").target("runly.chat"), "/app/help?module=runly.chat");
  });

  it("contacts: company-scoped, enabled-only, mapped with subtitle precedence", async () => {
    let captured;
    const prisma = {
      contact: {
        findMany: async (args) => {
          captured = args;
          return [
            { id: "c1", name: "Acme SA", email: "a@acme.com", phone: "555", type: "company" },
            { id: "c2", name: "No Email", email: null, phone: "700", type: "person" },
            { id: "c3", name: "Only Type", email: null, phone: null, type: "person" },
          ];
        },
      },
    };
    const items = await bySource("contacts").run({
      prisma,
      companyId: "co1",
      q: "ac",
      limit: 5,
    });
    assert.equal(captured.where.companyId, "co1");
    assert.equal(captured.where.enabled, true);
    assert.equal(captured.take, 5);
    assert.ok(captured.where.OR.some((clause) => clause.name?.contains === "ac"));
    assert.deepEqual(items, [
      { id: "c1", title: "Acme SA", subtitle: "a@acme.com", icon: "ContactRound" },
      { id: "c2", title: "No Email", subtitle: "700", icon: "ContactRound" },
      { id: "c3", title: "Only Type", subtitle: "person", icon: "ContactRound" },
    ]);
  });

  it("users: queries memberships scoped to the company and maps the nested user", async () => {
    let captured;
    const prisma = {
      membership: {
        findMany: async (args) => {
          captured = args;
          return [
            { user: { id: "u1", displayName: "Jane Doe", email: "jane@x.com" } },
            { user: null },
          ];
        },
      },
    };
    const items = await bySource("users").run({
      prisma,
      companyId: "co1",
      q: "jane",
      limit: 3,
    });
    assert.equal(captured.where.companyId, "co1");
    assert.equal(captured.where.enabled, true);
    assert.equal(captured.where.user.enabled, true);
    assert.equal(captured.take, 3);
    assert.deepEqual(items, [
      { id: "u1", title: "Jane Doe", subtitle: "jane@x.com", icon: "Users" },
    ]);
  });

  it("employees: joins first/last name and falls back through subtitle fields", async () => {
    let captured;
    const prisma = {
      hrEmployee: {
        findMany: async (args) => {
          captured = args;
          return [
            {
              id: "e1",
              firstName: "Ana",
              lastName: "Lopez",
              jobTitle: "Ventas",
              workEmail: "ana@co.com",
              employeeCode: "E-1",
            },
            {
              id: "e2",
              firstName: "Beto",
              lastName: "Ruiz",
              jobTitle: null,
              workEmail: null,
              employeeCode: "E-2",
            },
          ];
        },
      },
    };
    const items = await bySource("employees").run({
      prisma,
      companyId: "co1",
      q: "an",
      limit: 5,
    });
    assert.equal(captured.where.companyId, "co1");
    assert.equal(captured.where.enabled, true);
    assert.deepEqual(items, [
      { id: "e1", title: "Ana Lopez", subtitle: "Ventas", icon: "UserCheck" },
      { id: "e2", title: "Beto Ruiz", subtitle: "E-2", icon: "UserCheck" },
    ]);
  });

  it("help: searches module help content and maps to the safe shape, capped at limit", async () => {
    const prisma = {
      blueprint: {
        findMany: async () => [
          {
            kind: "HELP",
            enabled: true,
            module: { key: "runly.chat", name: "Chat", status: "INSTALLED", enabled: true },
            schema: { scope: "module", viewKey: null, title: "Chat", summary: "Mensajeria interna.", content: "Chat interno, MirAI y soporte externo." },
          },
        ],
      },
    };
    const items = await bySource("help").run({ prisma, companyId: "co1", q: "mensajeria", limit: 5 });
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "runly.chat");
    assert.equal(items[0].title, "Chat");
    assert.equal(items[0].icon, "BookOpen");
    assert.match(items[0].subtitle, /Chat/);
  });
});
