import test from "node:test";
import assert from "node:assert/strict";
import { firstTabWithError, resolveSchemaTabs, tabOfSection, tabsWithErrors } from "../schema-tabs.js";

const TABS = [{ key: "general", label: "General" }, { key: "docs", label: "Documentos" }];

test("resolveSchemaTabs only returns tabs when there are two or more", () => {
  assert.deepEqual(resolveSchemaTabs({}), []);
  assert.deepEqual(resolveSchemaTabs({ tabs: [TABS[0]] }), []);
  assert.deepEqual(resolveSchemaTabs({ tabs: [...TABS, { label: "sin key" }] }), TABS);
});

test("sections without a known tab fall into the first tab", () => {
  assert.equal(tabOfSection({ tab: "docs" }, TABS), "docs");
  assert.equal(tabOfSection({ tab: "missing" }, TABS), "general");
  assert.equal(tabOfSection({}, []), null);
});

test("error helpers find the tabs holding invalid fields in tab order", () => {
  const sections = [{ tab: "general", fields: ["nombre"] }, { tab: "docs", fields: ["contrato"] }];
  assert.deepEqual([...tabsWithErrors(sections, TABS, { contrato: {} })], ["docs"]);
  assert.equal(firstTabWithError(sections, TABS, { contrato: {}, nombre: {} }), "general");
  assert.equal(firstTabWithError(sections, TABS, {}), null);
});
