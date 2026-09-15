import test from "node:test";
import assert from "node:assert/strict";
import {
  getByPath,
  replacePathTokens,
  buildChipList,
  resolveHeroModel,
  resolveKpis,
  splitSectionsByColumn,
  normalizeComponentSection,
  normalizeSectionColumn,
} from "../detail-presentation.js";

test("getByPath reads dotted paths and tolerates gaps", () => {
  const obj = { a: { b: { c: 3 } }, x: null };
  assert.equal(getByPath(obj, "a.b.c"), 3);
  assert.equal(getByPath(obj, "a.z.c"), undefined);
  assert.equal(getByPath(obj, "x.y"), undefined);
  assert.equal(getByPath(obj, ""), undefined);
});

test("replacePathTokens replaces primitive tokens and skips objects", () => {
  const out = replacePathTokens("/app/drivers/:driver_id/x/:id", {
    driver_id: "d 1",
    id: "v1",
    obj: { nope: true },
  });
  assert.equal(out, "/app/drivers/d%201/x/v1");
});

test("buildChipList drops empty fields and shapes a color chip", () => {
  const chips = buildChipList(
    [
      { field: "vehicle_type_name", label: "Tipo", icon: "Layers" },
      { field: "missing", label: "X" },
      { field: "color", label: "Color", type: "color" },
    ],
    { vehicle_type_name: "Pick Up", color: "Verde Oliva" },
  );
  assert.equal(chips.length, 2);
  assert.deepEqual(
    { key: chips[0].key, label: chips[0].label, value: chips[0].value, icon: chips[0].icon },
    { key: "vehicle_type_name", label: "Tipo", value: "Pick Up", icon: "Layers" },
  );
  assert.equal(chips[1].type, "color");
  assert.ok("colorHex" in chips[1]);
});

test("resolveHeroModel returns null without schema.hero", () => {
  assert.equal(resolveHeroModel({}, { plate: "X" }), null);
});

test("resolveHeroModel builds title, joined subtitle, image + accent", () => {
  const schema = {
    hero: {
      titleField: "plate",
      subtitleFields: ["vehicle_brand_name", "vehicle_model_year"],
      statusField: "status",
      imageField: "cover_image_file_asset_id",
      imageDocsPath: "/fleet/vehicles/:id/documents",
      fallbackIcon: "Truck",
      accentColorField: "color",
      metaChips: [{ field: "vehicle_type_name", label: "Tipo" }],
    },
  };
  const model = resolveHeroModel(schema, {
    plate: "PVR-8109",
    vehicle_brand_name: "Chevrolet",
    vehicle_model_year: 2005,
    status: "active",
    cover_image_file_asset_id: "asset-1",
    color: "Verde Oliva",
    vehicle_type_name: "Pick Up",
  });
  assert.equal(model.title, "PVR-8109");
  assert.equal(model.subtitle, "Chevrolet · 2005");
  assert.equal(model.statusValue, "active");
  assert.equal(model.imageAssetId, "asset-1");
  assert.equal(model.imageDocsPath, "/fleet/vehicles/:id/documents");
  assert.equal(model.fallbackIcon, "Truck");
  assert.equal(model.chips.length, 1);
  assert.equal(model.statusMap, null);
});

test("resolveHeroModel and buildChipList resolve select-field labels via fieldMap", () => {
  const fieldMap = new Map([
    [
      "itemType",
      { type: "select", options: [{ value: "equipment", label: "Equipo / Maquinaria" }] },
    ],
  ]);
  const schema = {
    hero: {
      titleField: "name",
      subtitleFields: ["itemType", "model"],
      metaChips: [{ field: "itemType", label: "Tipo" }],
    },
  };
  const model = resolveHeroModel(
    schema,
    { name: "Asus TUF 15", itemType: "equipment", model: "TUF Gaming 15" },
    fieldMap,
  );
  assert.equal(model.subtitle, "Equipo / Maquinaria · TUF Gaming 15");
  assert.equal(model.chips[0].value, "Equipo / Maquinaria");
});

test("resolveHeroModel keeps statusMap and defaults fallbackIcon", () => {
  const model = resolveHeroModel(
    { hero: { titleField: "insurer_name", statusField: "is_active", statusMap: { true: "Vigente", false: "Vencida" } } },
    { insurer_name: "AXA", is_active: true },
  );
  assert.equal(model.imageAssetId, null);
  assert.equal(model.fallbackIcon, "FileText");
  assert.deepEqual(model.statusMap, { true: "Vigente", false: "Vencida" });
  assert.equal(model.statusValue, true);
});

test("resolveKpis maps fields, types and href tokens", () => {
  const items = resolveKpis(
    {
      kpis: [
        { label: "Matricula", field: "plate", icon: "Hash" },
        { label: "Operador", field: "driver_name", hrefTemplate: "/app/m/runly.fleet/drivers/:driver_id" },
        { label: "Poliza", field: "active_insurance_policy.expiry_date", type: "date" },
      ],
    },
    { plate: "PVR-8109", driver_name: "Jesus B.", driver_id: "d1", active_insurance_policy: { expiry_date: "2027-04-10" } },
  );
  assert.equal(items.length, 3);
  assert.equal(items[0].rawValue, "PVR-8109");
  assert.equal(items[0].type, "text");
  assert.equal(items[1].href, "/app/m/runly.fleet/drivers/d1");
  assert.equal(items[2].rawValue, "2027-04-10");
  assert.equal(items[2].type, "date");
});

test("resolveKpis returns [] without schema.kpis", () => {
  assert.deepEqual(resolveKpis({}, {}), []);
});

test("splitSectionsByColumn: layout off keeps one list", () => {
  const sections = [{ id: "a" }, { id: "b", column: "aside" }];
  const r = splitSectionsByColumn(sections, undefined);
  assert.equal(r.twoColumn, false);
  assert.equal(r.main.length, 2);
  assert.equal(r.aside.length, 0);
});

test("splitSectionsByColumn: two-column partitions by section.column", () => {
  const sections = [
    { id: "spec" },
    { id: "driver", column: "aside" },
    { id: "fin", column: "main" },
    { id: "docs", column: "aside" },
  ];
  const r = splitSectionsByColumn(sections, "two-column");
  assert.equal(r.twoColumn, true);
  assert.deepEqual(r.main.map((s) => s.id), ["spec", "fin"]);
  assert.deepEqual(r.aside.map((s) => s.id), ["driver", "docs"]);
});

test("normalizeComponentSection returns null without a component key", () => {
  assert.equal(normalizeComponentSection({}, 0, "Historial", "History"), null);
  assert.equal(normalizeComponentSection({ component: "  " }, 0, null, null), null);
});

test("normalizeComponentSection builds a component section descriptor", () => {
  const section = normalizeComponentSection(
    { id: "history", component: "runly.inventory:HistorySection", column: "aside" },
    3,
    "Historial de auditoría",
    "History",
  );
  assert.deepEqual(section, {
    id: "history",
    title: "Historial de auditoría",
    type: "component",
    icon: "History",
    column: "aside",
    component: "runly.inventory:HistorySection",
  });
});

test("normalizeSectionColumn defaults to main and recognizes aside", () => {
  assert.equal(normalizeSectionColumn(undefined), "main");
  assert.equal(normalizeSectionColumn(null), "main");
  assert.equal(normalizeSectionColumn(""), "main");
  assert.equal(normalizeSectionColumn("main"), "main");
  assert.equal(normalizeSectionColumn("aside"), "aside");
  assert.equal(normalizeSectionColumn("ASIDE"), "aside");
  assert.equal(normalizeSectionColumn("  aside  "), "aside");
});

test("normalizeComponentSection falls back to a generated id", () => {
  const section = normalizeComponentSection(
    { component: "runly.inventory:AssignmentSection" },
    2,
    null,
    null,
  );
  assert.equal(section.id, "section-2");
});
