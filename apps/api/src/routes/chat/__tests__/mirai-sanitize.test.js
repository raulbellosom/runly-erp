// apps/api/src/routes/chat/__tests__/mirai-sanitize.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeAssistantText } from "../mirai-service.js";

test("sanitizeAssistantText strips bold/heading/table markdown outside code fences", () => {
  const raw = [
    "**Tipo de cambio:** 1USD = 17.19 MXN",
    "# Resumen",
    "| Compra | Venta |",
    "|---|---|",
    "| 16.92 | 17.47 |",
    "* punto uno",
  ].join("\n");
  const out = sanitizeAssistantText(raw);
  assert.ok(!out.includes("**"));
  assert.ok(!out.includes("# Resumen"));
  assert.ok(out.includes("Resumen"));
  assert.ok(!/^\s*\|/m.test(out));
  assert.ok(out.includes("- punto uno"));
});

test("sanitizeAssistantText leaves fenced code blocks untouched", () => {
  const raw = "Usa esto:\n```js\nconst x = ** 2; // no es bold\n```\nListo.";
  const out = sanitizeAssistantText(raw);
  assert.ok(out.includes("const x = ** 2; // no es bold"));
});

test("sanitizeAssistantText is a no-op on plain text", () => {
  const raw = "1USD = 17.19 MXN (fuente: eldolar.info)";
  assert.equal(sanitizeAssistantText(raw), raw);
});
