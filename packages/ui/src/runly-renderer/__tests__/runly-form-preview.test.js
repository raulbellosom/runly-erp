import test from "node:test";
import assert from "node:assert/strict";
import { formatDisplayValue, computeCompletion, computePreviewModel } from "../runly-form-preview.js";

test("formatDisplayValue formats currency, date, boolean, and falls back to String", () => {
  assert.equal(formatDisplayValue({ type: "boolean" }, true), "Sí");
  assert.equal(formatDisplayValue({ type: "boolean" }, false), "No");
  assert.equal(formatDisplayValue({ type: "date" }, "2026-09-14"), "14/09/2026");
  assert.equal(formatDisplayValue({ type: "text" }, "hola"), "hola");
  assert.equal(formatDisplayValue({ type: "text" }, ""), null);
  assert.equal(formatDisplayValue({ type: "text" }, null), null);
});

test("formatDisplayValue resolves select/relation option labels", () => {
  const field = { type: "select", options: [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }] };
  assert.equal(formatDisplayValue(field, "b"), "Beta");
  assert.equal(formatDisplayValue(field, "z"), "z");
});

test("computeCompletion counts only visible, non-empty fields", () => {
  const fieldMap = new Map([
    ["name", { name: "name" }],
    ["hidden", { name: "hidden" }],
  ]);
  const formValues = { name: "Laptop", hidden: "x" };
  const isFieldVisible = (field) => field.name !== "hidden";
  const result = computeCompletion(fieldMap, formValues, isFieldVisible);
  assert.equal(result.allFieldNames.length, 2);
  assert.equal(result.filledCount, 1);
  assert.equal(result.completionPercent, 50);
});

test("computePreviewModel returns null without a preview config", () => {
  assert.equal(computePreviewModel(null, new Map(), {}), null);
});

test("computePreviewModel builds title/subtitle/rows from form values", () => {
  const fieldMap = new Map([["status", { name: "status", label: "Estado", type: "text" }]]);
  const formValues = { name: "Laptop XPS", model: "XPS 15", status: "available" };
  const model = computePreviewModel(
    { titleField: "name", subtitleFields: ["model"], rows: [{ field: "status", label: "Estado" }] },
    fieldMap,
    formValues,
  );
  assert.equal(model.title, "Laptop XPS");
  assert.equal(model.subtitle, "XPS 15");
  assert.deepEqual(model.rows, [{ key: "status", label: "Estado", value: "available" }]);
});
