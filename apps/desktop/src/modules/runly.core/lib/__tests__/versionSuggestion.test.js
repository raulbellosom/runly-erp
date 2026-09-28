import test from "node:test";
import assert from "node:assert/strict";
import { bumpVersion, compareVersions, describeChanges, versionOptions } from "../versionSuggestion.js";

const published = {
  version: "1.2.0",
  entities: [{ key: "cliente", fields: [{ key: "nombre", type: "text" }, { key: "edad", type: "number" }] }],
  views: [{ key: "k", kind: "KANBAN" }],
};

test("bump and compare", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
  assert.ok(compareVersions("1.10.0", "1.9.9") > 0);
});

test("change levels", () => {
  const added = structuredClone(published);
  added.entities[0].fields.push({ key: "rfc", type: "text" });
  assert.equal(describeChanges(published, added).level, "minor");
  assert.deepEqual(describeChanges(published, added).reasons, ["agregaste 1 campo"]);
  const removed = structuredClone(published);
  removed.entities[0].fields.pop();
  assert.equal(describeChanges(published, removed).level, "major");
  const relabeled = structuredClone(published);
  relabeled.entities[0].fields[0].label = "Nombre completo";
  assert.equal(describeChanges(published, relabeled).level, "patch");
  assert.equal(describeChanges(published, { ...published, version: "9.9.9" }).level, null);
});

test("options recommend the matching bump; first publish keeps the draft version", () => {
  const added = structuredClone(published);
  added.views.push({ key: "c", kind: "CARDS" });
  const result = versionOptions({ publishedVersion: "1.2.0", publishedDefinition: published, definition: added });
  assert.equal(result.suggested, "1.3.0");
  assert.deepEqual(result.options.map((option) => [option.version, option.recommended]), [["1.2.1", false], ["1.3.0", true], ["2.0.0", false]]);
  assert.deepEqual(versionOptions({ publishedVersion: null, definition: { version: "0.1.0" } }), { first: true, suggested: "0.1.0", options: [], changes: { level: null, reasons: [] } });
});
