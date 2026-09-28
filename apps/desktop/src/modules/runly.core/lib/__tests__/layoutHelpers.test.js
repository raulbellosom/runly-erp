import test from "node:test";
import assert from "node:assert/strict";
import {
  addSection, addTab, createDefaultLayout, disableDetailTree, enableDetailTree, hasDetailTree, placeField, pruneLayout,
  removeTab, ruleSummary, setFieldRule, setSectionRule, treeOf, unplacedFields, uniqueLayoutKey, withTree,
} from "../layoutHelpers.js";

test("rules: set, move with field, summary, prune", () => {
  let layout = addTab(createDefaultLayout(entity), "Extra");
  const [first, second] = [layout.tabs[0].sections[0].key, layout.tabs[1].sections[0].key];
  layout = setFieldRule(layout, first, "foto", { field: "estado", equals: "A" });
  layout = setSectionRule(layout, second, { field: "estado", truthy: true });
  assert.deepEqual(layout.tabs[0].sections[0].fieldRules, { foto: { field: "estado", equals: "A" } });
  layout = placeField(layout, "foto", second);
  assert.equal(layout.tabs[0].sections[0].fieldRules, undefined);
  const fields = new Map([["estado", { key: "estado", label: "Estado", type: "select", options: [{ value: "A", label: "Activo" }] }]]);
  assert.equal(ruleSummary({ field: "estado", equals: "A" }, fields), "Estado = Activo");
  assert.equal(ruleSummary({ field: "estado", truthy: false }, fields), "Estado está vacío");
  const pruned = pruneLayout(layout, ["nombre", "foto", "monto"]);
  assert.equal(pruned.tabs[1].sections[0].visibleWhen, undefined);
});

test("independent detail tree starts as a copy and is edited separately", () => {
  let layout = enableDetailTree(createDefaultLayout(entity));
  assert.ok(hasDetailTree(layout));
  const detail = treeOf(layout, "detail");
  layout = withTree(layout, "detail", addTab(detail, "Resumen"));
  assert.equal(layout.detail.tabs.length, 2);
  assert.equal(layout.tabs.length, 1);
  layout = disableDetailTree(layout);
  assert.equal(hasDetailTree(layout), false);
});

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

test("related sources list relations pointing to the entity", async () => {
  const { relatedSources, addSection: add } = await import("../layoutHelpers.js");
  const definition = { entities: [
    { key: "cliente", label: "Cliente", fields: [{ key: "nombre", type: "text" }] },
    { key: "pedido", label: "Pedido", pluralLabel: "Pedidos", fields: [{ key: "cliente", label: "Cliente", type: "relation", targetEntity: "cliente" }] },
  ] };
  const sources = relatedSources(definition, "cliente");
  assert.deepEqual(sources.map((item) => item.source), [{ entity: "pedido", field: "cliente" }]);
  const layout = add(createDefaultLayout(entity), "general", { label: "Pedidos", type: "related", source: sources[0].source });
  assert.deepEqual(layout.tabs[0].sections.at(-1), { key: "pedidos", label: "Pedidos", type: "related", source: { entity: "pedido", field: "cliente" } });
});
