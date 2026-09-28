import test from "node:test";
import assert from "node:assert/strict";
import {
  addSection, addTab, createDefaultLayout, placeField, pruneLayout, removeTab, unplacedFields, uniqueLayoutKey,
} from "../layoutHelpers.js";

const entity = { key: "orden", label: "Orden", fields: [{ key: "nombre" }, { key: "foto" }, { key: "monto" }] };

test("default layout places every field in one section", () => {
  const layout = createDefaultLayout(entity);
  assert.deepEqual(layout.tabs[0].sections[0].fields, ["nombre", "foto", "monto"]);
  assert.deepEqual(unplacedFields(layout, entity), []);
});

test("keys stay unique across tabs and sections", () => {
  const layout = addTab(createDefaultLayout(entity), "Datos");
  const keys = layout.tabs.flatMap((tab) => [tab.key, ...tab.sections.map((section) => section.key)]);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(uniqueLayoutKey(layout, "General", "tab"), "general_2");
  assert.equal(uniqueLayoutKey(layout, "123", "tab"), "tab_123");
});

test("placing a field moves it and removing a tab unplaces its fields", () => {
  let layout = addTab(createDefaultLayout(entity), "Extra");
  const target = layout.tabs[1].sections[0].key;
  layout = placeField(layout, "foto", target);
  assert.deepEqual(layout.tabs[0].sections[0].fields, ["nombre", "monto"]);
  assert.deepEqual(layout.tabs[1].sections[0].fields, ["foto"]);
  layout = removeTab(layout, layout.tabs[1].key);
  assert.deepEqual(unplacedFields(layout, entity).map((field) => field.key), ["foto"]);
});

test("only one attachments section is added", () => {
  let layout = addSection(createDefaultLayout(entity), "general", { label: "Documentos", type: "attachments" });
  layout = addSection(layout, "general", { label: "Otra", type: "attachments" });
  assert.equal(layout.tabs[0].sections.filter((section) => section.type === "attachments").length, 1);
});

test("pruneLayout drops deleted fields from sections, hero and kpis", () => {
  const layout = { ...createDefaultLayout(entity), detail: { hero: { titleField: "nombre", imageField: "foto" }, kpis: [{ field: "foto", label: "x" }, { field: "monto", label: "M" }] } };
  const pruned = pruneLayout(layout, ["nombre", "monto"]);
  assert.deepEqual(pruned.tabs[0].sections[0].fields, ["nombre", "monto"]);
  assert.equal(pruned.detail.hero.imageField, undefined);
  assert.deepEqual(pruned.detail.kpis, [{ field: "monto", label: "M" }]);
  assert.equal(pruneLayout(layout, ["monto"]).detail.hero, undefined);
});
