import test from "node:test";
import assert from "node:assert/strict";
import { isElementVisible, matchesVisibilityRule, visibleSections } from "../visibility-rules.js";
import { tabOfSection } from "../schema-tabs.js";

test("matchesVisibilityRule operators", () => {
  assert.equal(matchesVisibilityRule({ field: "tipo", equals: "EMPRESA" }, { tipo: "EMPRESA" }), true);
  assert.equal(matchesVisibilityRule({ field: "tipo", notEquals: "EMPRESA" }, { tipo: "EMPRESA" }), false);
  assert.equal(matchesVisibilityRule({ field: "tipo", in: ["A", "B"] }, { tipo: "B" }), true);
  assert.equal(matchesVisibilityRule({ field: "credito", truthy: true }, {}), false);
  assert.equal(matchesVisibilityRule(null, {}), true);
  assert.equal(isElementVisible({}, {}), true);
});

test("visibleSections applies section and tab rules", () => {
  const tabs = [{ key: "general" }, { key: "credito", visibleWhen: { field: "credito", truthy: true } }];
  const sections = [
    { id: "datos", tab: "general" },
    { id: "fiscal", tab: "general", visibleWhen: { field: "tipo", equals: "EMPRESA" } },
    { id: "limites", tab: "credito" },
  ];
  const ids = (values) => visibleSections(sections, tabs, values, tabOfSection).map((section) => section.id);
  assert.deepEqual(ids({}), ["datos"]);
  assert.deepEqual(ids({ tipo: "EMPRESA", credito: true }), ["datos", "fiscal", "limites"]);
});
