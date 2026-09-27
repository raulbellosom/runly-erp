import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeText,
  scoreMatch,
  scoreItem,
  buildCommandItems,
  mapSearchGroups,
  STATIC_PAGES,
} from "../commandPalette.js";

const contacts = {
  key: "atlas.contacts",
  name: "Contactos",
  summary: "Clientes, proveedores, personas y empresas",
  icon: "ContactRound",
  color: "#3b82f6",
  category: "operaciones",
  navigation: [
    { label: "Directorio", path: "/", icon: "Contact" },
    { label: "Empresas", path: "/contacts/companies", icon: "Building2" },
  ],
};

const ledger = {
  key: "atlas.ledger",
  name: "Libro de cuentas",
  summary: "Cuentas bancarias y registro de movimientos",
  icon: "Wallet",
  color: "#10b981",
  category: "contabilidad",
  navigation: [{ label: "Cuentas", path: "/ledger/accounts", icon: "Landmark" }],
};

const empty = {
  key: "atlas.empty",
  name: "Vacío",
  summary: "",
  description: "",
  icon: "Box",
  color: "#888",
  category: "general",
  navigation: [],
};

const modules = [contacts, ledger, empty];

test("normalizeText strips diacritics and lowercases", () => {
  assert.equal(normalizeText("Empresás"), "empresas");
  assert.equal(normalizeText("  ÁÉÍÓÚ  "), "aeiou");
  assert.equal(normalizeText(null), "");
});

test("scoreMatch ranks exact > prefix > word-boundary > substring > none", () => {
  assert.equal(scoreMatch("cuentas", "Cuentas"), 1000);
  assert.equal(scoreMatch("cue", "Cuentas bancarias"), 100);
  assert.equal(scoreMatch("ban", "Cuentas bancarias"), 60);
  assert.equal(scoreMatch("tas", "Cuentas"), 30);
  assert.equal(scoreMatch("zzz", "Cuentas"), 0);
  assert.equal(scoreMatch("", "Cuentas"), 0);
});

test("scoreMatch is diacritic and case insensitive", () => {
  assert.ok(scoreMatch("empresa", "Empresás") > 0);
});

test("scoreItem weights title over subtitle and honors keywords", () => {
  const titleHit = scoreItem("contactos", {
    title: "Contactos",
    subtitle: "algo",
    keywords: [],
  });
  const subtitleHit = scoreItem("clientes", {
    title: "Contactos",
    subtitle: "Clientes y proveedores",
    keywords: [],
  });
  assert.ok(titleHit > subtitleHit);

  const keywordHit = scoreItem("atlas.contacts", {
    title: "Contactos",
    subtitle: "",
    keywords: ["atlas.contacts", "Operaciones"],
  });
  assert.ok(keywordHit > 0);

  assert.equal(scoreItem("", { title: "Contactos" }), 0);
});

test("empty query: section order is active, modules, tools, pages", () => {
  const { sections } = buildCommandItems({
    availableModules: modules,
    activeModule: contacts,
    query: "",
  });
  assert.deepEqual(
    sections.map((s) => s.id),
    ["active", "modules", "tools", "pages"],
  );
});

test("empty query without an active module: no active section", () => {
  const { sections } = buildCommandItems({
    availableModules: modules,
    activeModule: null,
    query: "",
  });
  assert.deepEqual(
    sections.map((s) => s.id),
    ["modules", "tools", "pages"],
  );
});

test("every available module appears in the modules section", () => {
  const { sections } = buildCommandItems({
    availableModules: modules,
    activeModule: contacts,
    query: "",
  });
  const mods = sections.find((s) => s.id === "modules");
  assert.deepEqual(
    mods.items.map((i) => i.title).sort(),
    ["Contactos", "Libro de cuentas", "Vacío"].sort(),
  );
});

test("active module is excluded from tools but present in modules", () => {
  const { sections } = buildCommandItems({
    availableModules: modules,
    activeModule: contacts,
    query: "",
  });
  const tools = sections.find((s) => s.id === "tools");
  const toolModuleKeys = new Set(
    tools.items.map((i) => i.target.split("/")[3]),
  );
  assert.ok(!toolModuleKeys.has("atlas.contacts"));
  assert.ok(toolModuleKeys.has("atlas.ledger"));

  const mods = sections.find((s) => s.id === "modules");
  assert.ok(mods.items.some((i) => i.title === "Contactos"));
});

test("module with no navigation still lists as a module, contributes no tools", () => {
  const { sections } = buildCommandItems({
    availableModules: modules,
    activeModule: null,
    query: "",
  });
  const tools = sections.find((s) => s.id === "tools");
  assert.ok(!tools.items.some((i) => i.target.includes("atlas.empty")));
  const mods = sections.find((s) => s.id === "modules");
  assert.ok(mods.items.some((i) => i.title === "Vacío"));
});

test("query filters and ranks; unrelated modules drop out", () => {
  const { sections, flat } = buildCommandItems({
    availableModules: modules,
    activeModule: null,
    query: "empres",
  });
  const mods = sections.find((s) => s.id === "modules");
  // "Vacío" and "Libro de cuentas" have no "empres" match anywhere
  assert.ok(!mods || !mods.items.some((i) => i.title === "Libro de cuentas"));
  // The "Empresas" action from contacts should be present somewhere
  assert.ok(flat.some((i) => i.title === "Empresas"));
});

test("nav target: root nav maps to module root, sub nav appends the path", () => {
  const { sections } = buildCommandItems({
    availableModules: modules,
    activeModule: contacts,
    query: "",
  });
  const active = sections.find((s) => s.id === "active");
  const directorio = active.items.find((i) => i.title === "Directorio");
  const empresas = active.items.find((i) => i.title === "Empresas");
  assert.equal(directorio.target, "/app/m/atlas.contacts");
  assert.equal(empresas.target, "/app/m/atlas.contacts/contacts/companies");
});

test("offline: non-offline modules and their actions are blocked", () => {
  const { sections } = buildCommandItems({
    availableModules: modules,
    activeModule: null,
    query: "",
    isOnline: false,
    offlineModuleKeys: ["atlas.ledger"],
  });
  const mods = sections.find((s) => s.id === "modules");
  const contactsRow = mods.items.find((i) => i.title === "Contactos");
  const ledgerRow = mods.items.find((i) => i.title === "Libro de cuentas");
  assert.equal(contactsRow.blocked, true);
  assert.equal(ledgerRow.blocked, false);

  const tools = sections.find((s) => s.id === "tools");
  const ledgerTool = tools.items.find((i) => i.target.includes("atlas.ledger"));
  assert.equal(ledgerTool.blocked, false);
});

test("online: nothing is blocked", () => {
  const { flat } = buildCommandItems({
    availableModules: modules,
    activeModule: contacts,
    query: "",
    isOnline: true,
  });
  assert.ok(flat.every((i) => i.blocked === false));
});

test("static pages are always offered on an empty query", () => {
  const { sections } = buildCommandItems({
    availableModules: modules,
    activeModule: null,
    query: "",
  });
  const pages = sections.find((s) => s.id === "pages");
  assert.deepEqual(
    pages.items.map((i) => i.target).sort(),
    STATIC_PAGES.map((p) => p.path).sort(),
  );
});

test("mapSearchGroups shapes sections and items, drops empty groups", () => {
  assert.deepEqual(mapSearchGroups([]), []);
  assert.deepEqual(mapSearchGroups([{ source: "contacts", label: "Contactos", items: [] }]), []);

  const sections = mapSearchGroups([
    {
      source: "contacts",
      label: "Contactos",
      items: [
        {
          id: "c1",
          title: "Acme",
          subtitle: "a@acme.com",
          icon: "ContactRound",
          target: "/app/m/atlas.contacts/contacts/c1",
        },
      ],
    },
  ]);
  assert.equal(sections[0].id, "search:contacts");
  assert.equal(sections[0].title, "Contactos");
  assert.deepEqual(sections[0].items[0], {
    key: "record:contacts:c1",
    kind: "record",
    title: "Acme",
    subtitle: "a@acme.com",
    keywords: [],
    icon: "ContactRound",
    color: null,
    target: "/app/m/atlas.contacts/contacts/c1",
    blocked: false,
  });
});

test("searchGroups are spliced after active and before modules, never blocked", () => {
  const groups = [
    {
      source: "contacts",
      label: "Contactos",
      items: [
        {
          id: "c1",
          title: "Zeta",
          subtitle: null,
          icon: "ContactRound",
          target: "/app/m/atlas.contacts/contacts/c1",
        },
      ],
    },
  ];
  const withActive = buildCommandItems({
    availableModules: modules,
    activeModule: contacts,
    query: "empres", // matches the "Empresas" nav item so the active section survives
    searchGroups: groups,
  });
  assert.deepEqual(
    withActive.sections.map((s) => s.id).slice(0, 2),
    ["active", "search:contacts"],
  );

  const noActive = buildCommandItems({
    availableModules: modules,
    activeModule: null,
    query: "zeta",
    searchGroups: groups,
  });
  assert.equal(noActive.sections[0].id, "search:contacts");
  // "zeta" matches no local module/action, but the record section still shows
  assert.ok(noActive.flat.some((i) => i.title === "Zeta"));
  assert.ok(noActive.flat.every((i) => i.blocked === false));
});

test("child nav entries are expanded into their own items", () => {
  const withChildren = {
    key: "atlas.web",
    name: "Sitio web",
    summary: "",
    icon: "Globe",
    color: "#000",
    category: "operaciones",
    navigation: [
      {
        label: "Contenido",
        icon: "FileText",
        children: [
          { label: "Paginas", path: "/pages", icon: "FileText" },
          { label: "Blog", path: "/blog", icon: "BookOpen" },
        ],
      },
    ],
  };
  const { sections } = buildCommandItems({
    availableModules: [withChildren],
    activeModule: null,
    query: "",
  });
  const tools = sections.find((s) => s.id === "tools");
  assert.deepEqual(
    tools.items.map((i) => i.target).sort(),
    ["/app/m/atlas.web/pages", "/app/m/atlas.web/blog"].sort(),
  );
});

test("help search group is placed after modules, tools and pages", () => {
  const { sections } = buildCommandItems({
    availableModules: [contacts],
    query: "contactos",
    searchGroups: [
      { source: "help", label: "Ayuda", items: [{ id: "h1", title: "Contactos", target: "/help/x" }] },
      { source: "contacts", label: "Contactos", items: [{ id: "c1", title: "Ana", target: "/c/1" }] },
    ],
  });
  const ids = sections.map((s) => s.id);
  assert.equal(ids.at(-1), "search:help");
  assert.equal(ids[0], "search:contacts");
});
