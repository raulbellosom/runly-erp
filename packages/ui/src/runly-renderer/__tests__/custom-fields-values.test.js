import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCustomFieldsPayload, extraDefinitionsFrom, seedCustomFieldValues } from "../custom-fields-values.js";

const ram = { id: "f1", fieldKey: "ram", fieldType: "text", categoryId: "t1", onDemand: false };
const factura = { id: "f2", fieldKey: "tiene_factura", fieldType: "boolean", categoryId: null, onDemand: true };
const color = { id: "f3", fieldKey: "color", fieldType: "text", categoryId: "t2", onDemand: false };

test("seedCustomFieldValues flattens stored values and casts booleans", () => {
  const sections = [{ type: "custom-fields", customFields: { valuePrefix: "customValues" } }];
  const out = seedCustomFieldValues({ name: "X" }, sections, {
    customValues: [{ fieldId: "f1", value: "16 GB", field: ram }, { fieldId: "f2", value: "true", field: factura }],
  });
  assert.deepEqual(out, { name: "X", "customValues.ram": "16 GB", "customValues.tiene_factura": true });
});

test("extraDefinitionsFrom keeps on-demand fields and valued fields outside the type", () => {
  const entries = [
    { value: "16 GB", field: ram },
    { value: null, field: factura },
    { value: "", field: color },
  ];
  assert.deepEqual(extraDefinitionsFrom(entries, [ram]).map((d) => d.id), ["f2"]);
});

test("buildCustomFieldsPayload sends extra fields even when empty, plus removals", () => {
  const values = { "customValues.ram": "", "customValues.tiene_factura": false, "customValues.__removed": ["f3"] };
  const out = buildCustomFieldsPayload(values, [ram, { ...factura, _extra: true }], "customValues");
  assert.deepEqual(out, { customValues: [{ fieldId: "f2", value: "false" }], removedCustomFieldIds: ["f3"] });
});
