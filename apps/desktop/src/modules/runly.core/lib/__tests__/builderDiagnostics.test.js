import test from "node:test";
import assert from "node:assert/strict";
import { describeDiagnostic } from "../builderDiagnostics.js";

test("describeDiagnostic: missing entities points to the Datos tab in Spanish", () => {
  const item = describeDiagnostic({ path: "entities", code: "REQUIRED", message: "At least one entity is required." }, { entities: [] });
  assert.equal(item.text, "El módulo necesita al menos una entidad.");
  assert.equal(item.tab, "data");
  assert.equal(item.tabLabel, "Datos");
});

test("describeDiagnostic: locates field problems with the labels the user sees", () => {
  const definition = { entities: [{ key: "visita", label: "Visita", fields: [{ key: "nombre", label: "Nombre" }] }] };
  const item = describeDiagnostic({ path: "entities[0].fields[0].key", code: "DUPLICATE_FIELD_KEY", message: 'Duplicate field key "nombre".' }, definition);
  assert.equal(item.text, "Hay dos campos con la clave «nombre».");
  assert.equal(item.location, "Entidad «Visita» › campo «Nombre»");
});

test("describeDiagnostic: unknown codes fall back to the compiler message", () => {
  const item = describeDiagnostic({ path: "views[0]", code: "SOMETHING_NEW", message: "Raw message." }, {});
  assert.equal(item.text, "Raw message.");
  assert.equal(item.tab, "views");
});
