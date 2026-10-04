import test from "node:test";
import assert from "node:assert/strict";
import { canRenameKeepingData, renameField, validateFieldKey } from "../fieldRename.js";

const DEFINITION = {
  key: "custom.taller",
  entities: [
    { key: "orden", fields: [{ key: "estado", type: "select", fieldId: "f1" }, { key: "cliente", type: "text" }],
      layout: { tabs: [{ sections: [{ fields: ["estado", "cliente"], fieldRules: { cliente: { field: "estado", equals: "abierta" } } }] }],
        detail: { hero: { titleField: "cliente", statusField: "estado" }, kpis: [{ field: "estado" }] } } },
    { key: "linea", fields: [{ key: "orden", type: "relation", targetEntity: "orden", labelField: "estado" }] },
  ],
  views: [
    { key: "k", kind: "KANBAN", entity: "orden", groupBy: "estado", card: { titleField: "cliente" } },
    { key: "d", kind: "DASHBOARD", widgets: [{ source: { entity: "orden", groupBy: "estado" } }, { source: { entity: "linea", groupBy: "estado" } }] },
  ],
  connections: [{ key: "c", entity: "orden", targetField: "cliente", fields: [{ field: "estado", detail: true }] }],
  publicLinks: [{ key: "p", entity: "orden", fields: ["estado"], targetEntity: "orden", formFields: ["estado"], linkField: "estado" }],
};

test("renameField updates every reference to the key in its entity", () => {
  const next = renameField(DEFINITION, "orden", "estado", "situacion");
  const orden = next.entities[0];
  assert.equal(orden.fields[0].key, "situacion");
  assert.equal(orden.fields[0].fieldId, "f1");
  assert.deepEqual(orden.layout.tabs[0].sections[0].fields, ["situacion", "cliente"]);
  assert.equal(orden.layout.tabs[0].sections[0].fieldRules.cliente.field, "situacion");
  assert.equal(orden.layout.detail.hero.statusField, "situacion");
  assert.equal(orden.layout.detail.kpis[0].field, "situacion");
  assert.equal(next.entities[1].fields[0].labelField, "situacion");
  assert.equal(next.views[0].groupBy, "situacion");
  assert.equal(next.views[1].widgets[0].source.groupBy, "situacion");
  assert.equal(next.views[1].widgets[1].source.groupBy, "estado", "other entity untouched");
  assert.equal(next.connections[0].fields[0].field, "situacion");
  assert.deepEqual([next.publicLinks[0].fields, next.publicLinks[0].formFields, next.publicLinks[0].linkField], [["situacion"], ["situacion"], "situacion"]);
});

test("key validation and rename-with-data rule", () => {
  const entity = DEFINITION.entities[0];
  assert.equal(validateFieldKey("cliente", entity, "estado"), "Ya existe un campo con esa clave.");
  assert.match(validateFieldKey("Mal Nombre", entity, "estado"), /minúsculas/);
  assert.equal(validateFieldKey("situacion", entity, "estado"), "");
  assert.equal(canRenameKeepingData({ fieldId: "f1" }, DEFINITION, "orden"), true);
  assert.equal(canRenameKeepingData({ fieldId: "nuevo" }, DEFINITION, "orden"), false);
});
