import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldMetaFor, formatAuditValue, humanizeField, splitSummary } from "../audit-trail-format.js";

test("humanizeField and fieldMetaFor fall back to readable labels", () => {
  assert.equal(humanizeField("warrantyExpiry"), "Warranty expiry");
  assert.equal(humanizeField("purchase_price"), "Purchase price");
  assert.equal(fieldMetaFor({ notes: { label: "Notas" } }, "notes").label, "Notas");
  assert.equal(fieldMetaFor(null, "plate").label, "Plate");
});

test("formatAuditValue renders empties, booleans, options, dates and uuids", () => {
  assert.equal(formatAuditValue(null), "—");
  assert.equal(formatAuditValue(true), "Sí");
  assert.equal(formatAuditValue("a", { type: "select", options: [{ value: "a", label: "Alta" }] }), "Alta");
  assert.equal(formatAuditValue("2026-09-15"), "15/09/2026");
  assert.equal(formatAuditValue("01900000-0000-7000-8000-000000000001"), "otro registro");
  assert.equal(formatAuditValue("Casa"), "Casa");
});

test("splitSummary strips the leading actor name", () => {
  assert.equal(splitSummary("Raul Belloso actualizó el activo X", "Raul Belloso"), "actualizó el activo X");
  assert.equal(splitSummary("Sistema creó", "Raul"), "Sistema creó");
});

test("plainPreview strips markdown and isRichValue detects it", async () => {
  const { plainPreview, isRichValue } = await import("../audit-trail-format.js");
  assert.equal(plainPreview("## Nota\n* [ ] falta **mucho**\n* [x] [link](http://a)"), "Nota falta mucho link");
  assert.equal(isRichValue("* [ ] tarea"), true);
  assert.equal(isRichValue("Casa Raul"), false);
  assert.equal(isRichValue("x", { type: "markdown" }), true);
});
