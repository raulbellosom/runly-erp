import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSections } from "../runly-form-schema.js";

test("normalizeSections builds a custom-fields section from apiPath/categoryField/valuePrefix", () => {
  const fieldMap = new Map();
  const sections = normalizeSections(
    {
      sections: [
        {
          id: "custom",
          title: "Campos personalizados",
          icon: "SlidersHorizontal",
          type: "custom-fields",
          customFields: {
            apiPath: "/inventory/custom-fields",
            categoryField: "categoryId",
            valuePrefix: "customValues",
          },
        },
      ],
    },
    fieldMap,
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, "custom-fields");
  assert.equal(sections[0].title, "Campos personalizados");
  assert.equal(sections[0].icon, "SlidersHorizontal");
  assert.deepEqual(sections[0].customFields, {
    apiPath: "/inventory/custom-fields",
    categoryField: "categoryId",
    valuePrefix: "customValues",
  });
});

test("normalizeSections still handles a plain fields section unaffected by the new type", () => {
  const fieldMap = new Map();
  const sections = normalizeSections(
    { sections: [{ title: "Datos", fields: [{ field: "name", label: "Nombre" }] }] },
    fieldMap,
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, "fields");
  assert.equal(sections[0].fields[0], "name");
});

test("normalizeSections builds a component section and registers its declared fields", () => {
  const fieldMap = new Map();
  const sections = normalizeSections(
    {
      sections: [
        {
          id: "address",
          title: "Dirección",
          type: "component",
          component: "runly.identity:AddressFieldsSection",
          fields: ["country", "state", "city"],
        },
      ],
    },
    fieldMap,
  );
  assert.equal(sections.length, 1);
  assert.equal(sections[0].type, "component");
  assert.equal(sections[0].component, "runly.identity:AddressFieldsSection");
  assert.deepEqual(sections[0].fields, ["country", "state", "city"]);
  assert.equal(fieldMap.has("country"), true);
  assert.equal(fieldMap.get("country").type, "text");
  assert.equal(fieldMap.get("country").required, false);
});

test("normalizeSections component section merges into an existing fieldMap entry without clobbering it", () => {
  const fieldMap = new Map([["country", { name: "country", label: "País", type: "text", required: true }]]);
  normalizeSections(
    { sections: [{ type: "component", component: "x:Y", fields: ["country"] }] },
    fieldMap,
  );
  assert.equal(fieldMap.get("country").required, true);
  assert.equal(fieldMap.get("country").label, "País");
});
