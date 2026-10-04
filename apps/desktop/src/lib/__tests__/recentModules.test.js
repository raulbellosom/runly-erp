import { test } from "node:test";
import assert from "node:assert/strict";
import { pushRecentKey, filterModulesByQuery } from "../recentModules.js";

test("pushRecentKey moves key to front, dedupes and caps", () => {
  assert.deepEqual(pushRecentKey(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assert.deepEqual(pushRecentKey(["a", "b"], "c", 2), ["c", "a"]);
  assert.deepEqual(pushRecentKey(["a"], ""), ["a"]);
});

test("filterModulesByQuery ignores accents and ranks name prefix first", () => {
  const modules = [
    { key: "runly.hr", name: "Recursos humanos", summary: "Empleados y nómina" },
    { key: "runly.calendar", name: "Calendario", summary: "Eventos" },
    { key: "runly.notes", name: "Notas", summary: "Calendario de notas" },
  ];
  assert.deepEqual(
    filterModulesByQuery(modules, "cal").map((m) => m.key),
    ["runly.calendar", "runly.notes"],
  );
  assert.deepEqual(filterModulesByQuery(modules, "nomina").map((m) => m.key), ["runly.hr"]);
  assert.equal(filterModulesByQuery(modules, "  ").length, 3);
});
