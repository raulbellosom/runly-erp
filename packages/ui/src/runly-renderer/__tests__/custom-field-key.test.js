import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldKeyFromLabel } from "../custom-field-key.js";

test("fieldKeyFromLabel slugifies and stays unique", () => {
  assert.equal(fieldKeyFromLabel("Memoria RAM (GB)"), "memoria_ram_gb");
  assert.equal(fieldKeyFromLabel("Año de fabricación"), "ano_de_fabricacion");
  assert.equal(fieldKeyFromLabel("Memoria RAM", ["memoria_ram"]), "memoria_ram_2");
  assert.equal(fieldKeyFromLabel("!!!"), "campo");
});
