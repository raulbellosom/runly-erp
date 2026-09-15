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
