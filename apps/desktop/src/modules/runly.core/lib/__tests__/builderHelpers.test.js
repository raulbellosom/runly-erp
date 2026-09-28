import test from "node:test";
import assert from "node:assert/strict";
import { addView, removeView, navigationTargets, navigationItems, addNavigationItem } from "../builderHelpers.js";

const base = {
  key: "custom.encuestas",
  name: "Encuestas",
  icon: "Medal",
  entities: [{ key: "contacto", label: "Contacto", pluralLabel: "Contactos", fields: [] }],
  views: [],
};

test("addView gives a second dashboard and kanban unique keys and paths", () => {
  let def = addView(base, { kind: "DASHBOARD" });
  def = addView(def, { kind: "DASHBOARD" });
  def = addView(def, { kind: "KANBAN", entityKey: "contacto" });
  def = addView(def, { kind: "KANBAN", entityKey: "contacto" });
  const keys = def.views.map((v) => v.key);
  const paths = def.views.map((v) => v.path);
  assert.equal(new Set(keys).size, 4);
  assert.equal(new Set(paths).size, 4);
  assert.deepEqual(paths, [
    "/app/m/custom.encuestas/dashboard",
    "/app/m/custom.encuestas/dashboard-2",
    "/app/m/custom.encuestas/contacto-kanban",
    "/app/m/custom.encuestas/contacto-kanban-2",
  ]);
});

test("custom views can be added to the menu and are dropped with their view", () => {
  const def = addView(base, { kind: "KANBAN", entityKey: "contacto" });
  const target = navigationTargets(def).find((t) => t.kind === "KANBAN");
  assert.equal(target.permission, "encuestas.contacto.read");
  const withNav = addNavigationItem(def, target);
  assert.equal(navigationItems(withNav).length, 2);
  assert.equal(navigationItems(withNav)[1].kind, undefined);
  const removed = removeView(withNav, target.page);
  assert.equal(navigationItems(removed).length, 1);
});

test("records views get field defaults from the entity and a menu target", () => {
  const def = {
    ...base,
    entities: [{ key: "cita", label: "Cita", pluralLabel: "Citas", fields: [
      { key: "nombre", type: "text", label: "Nombre" },
      { key: "fecha", type: "date", label: "Fecha" },
      { key: "estado", type: "select", label: "Estado", options: [] },
    ] }],
  };
  let next = addView(def, { kind: "CALENDAR", entityKey: "cita" });
  next = addView(next, { kind: "REPORT", entityKey: "cita" });
  const [calendar, report] = next.views;
  assert.equal(calendar.path, "/app/m/custom.encuestas/cita-calendar");
  assert.equal(calendar.dateField, "fecha");
  assert.equal(calendar.titleField, "nombre");
  assert.equal(calendar.colorField, "estado");
  assert.equal(report.groupBy, "estado");
  assert.deepEqual(report.measures, [{ key: "total", label: "Registros", aggregate: "count" }]);
  const target = navigationTargets(next).find((t) => t.page === calendar.key);
  assert.equal(target.kind, "CALENDAR");
  assert.equal(target.permission, "encuestas.cita.read");
});
