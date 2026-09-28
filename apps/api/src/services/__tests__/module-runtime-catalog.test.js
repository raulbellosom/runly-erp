import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUNDLE_EXTERNALS } from "../module-bundler-service.js";
import { buildCatalog } from "../../../../../scripts/generate-module-runtime-catalog.mjs";

const catalog = JSON.parse(readFileSync(new URL("../../../../../packages/module-compiler/src/runtime-catalog.json", import.meta.url), "utf8"));

test("runtime catalog matches the installed versions (run scripts/generate-module-runtime-catalog.mjs)", () => {
  assert.deepEqual(catalog, buildCatalog());
});

test("every shared bundler external is documented in the catalog", () => {
  const shared = new Set(catalog.libraries.filter((library) => library.category === "shared").map((library) => library.name));
  const externals = BUNDLE_EXTERNALS.filter((name) => !name.startsWith("@atlas/") && !name.startsWith("react/"));
  assert.deepEqual(externals.filter((name) => !shared.has(name)), []);
  assert.deepEqual([...shared].filter((name) => !BUNDLE_EXTERNALS.includes(name)), []);
});
