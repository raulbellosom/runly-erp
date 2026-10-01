import test from "node:test";
import assert from "node:assert/strict";
import { createModuleToolset, parseMiraiPageContext } from "../mirai-module-tools.js";
import { createWebSearchTool } from "../mirai-web-search.js";
import { runMiraiToolLoop } from "../mirai-tool-loop.js";

function fakeRegistry({ modules = {} } = {}) {
  return {
    getModule: async (_ctx, moduleKey) => (modules[moduleKey] ? { scope: { companyId: "co1" }, module: modules[moduleKey] } : { error: "no disponible" }),
    describeContext: async (_ctx, pageContext) => (modules[pageContext?.moduleKey] ? `El usuario esta en el modulo ${modules[pageContext.moduleKey].label}.` : null),
  };
}

function calTool(name, run = async () => ({ ok: true })) {
  return { name, permission: "calendar.events.read", definition: { description: "d", parameters: { type: "object", properties: {} } }, run };
}

test("use_module activates a module's tools and run() dispatches to it with a scoped actx", async () => {
  let seenActx = null;
  const module = {
    label: "Calendario", tools: [calTool("calendar_summary", async (_a, actx) => { seenActx = actx; return { total: 1 }; })], actions: [],
  };
  const registry = fakeRegistry({ modules: { "runly.calendar": module } });
  const toolset = createModuleToolset({ prisma: {}, registry, proposalService: {} });
  const ctx = {};
  const used = await toolset.run("use_module", { moduleKey: "runly.calendar" }, ctx);
  assert.deepEqual(used.consultas, ["calendar_summary"]);
  const names = toolset.getTools(ctx).map((t) => t.function.name);
  assert.ok(names.includes("calendar_summary"));
  const result = await toolset.run("calendar_summary", {}, ctx);
  assert.deepEqual(result, { total: 1 });
  assert.equal(seenActx.companyId, "co1");
});

test("use_module on a 4th distinct module in the same turn is rejected", async () => {
  const modules = {};
  for (const key of ["m1", "m2", "m3", "m4"]) modules[key] = { label: key, tools: [], actions: [] };
  const registry = fakeRegistry({ modules });
  const toolset = createModuleToolset({ prisma: {}, registry, proposalService: {} });
  const ctx = {};
  for (const key of ["m1", "m2", "m3"]) {
    const out = await toolset.run("use_module", { moduleKey: key }, ctx);
    assert.ok(!out.error, `expected ${key} to activate`);
  }
  const fourth = await toolset.run("use_module", { moduleKey: "m4" }, ctx);
  assert.equal(fourth.error, "Demasiados modulos en una consulta.");
});

test("startTurn activates the page module and returns the registry's describeContext line", async () => {
  const module = { label: "Calendario", tools: [calTool("calendar_summary")], actions: [] };
  const registry = fakeRegistry({ modules: { "runly.calendar": module } });
  const toolset = createModuleToolset({ prisma: {}, registry, proposalService: {} });
  const ctx = { pageContext: { moduleKey: "runly.calendar" } };
  const line = await toolset.startTurn(ctx);
  assert.equal(line, "El usuario esta en el modulo Calendario.");
  assert.ok(ctx.activeModules.has("runly.calendar"));
});

test("parseMiraiPageContext rejects an oversized moduleKey", () => {
  assert.equal(parseMiraiPageContext({ moduleKey: "x".repeat(201) }), null);
  assert.deepEqual(parseMiraiPageContext({ moduleKey: "runly.calendar" }), { moduleKey: "runly.calendar" });
});

test("createWebSearchTool: disabled errors, enabled respects the per-turn budget, snippet is capped", async () => {
  const disabled = createWebSearchTool({ search: async () => ({}), enabled: false, checkRate: () => true });
  const off = await disabled.run({ query: "precio del cafe" }, {});
  assert.match(off.error, /no esta configurada/);

  const longSnippet = "x".repeat(900);
  const enabled = createWebSearchTool({
    search: async () => ({ answer: "a", results: [{ title: "t", url: "u", content: longSnippet }] }),
    enabled: true,
    checkRate: () => true,
  });
  const ctx = {};
  const first = await enabled.run({ query: "precio del cafe" }, ctx);
  assert.equal(first.results[0].snippet.length, 500);
  await enabled.run({ query: "precio del cafe 2" }, ctx);
  const third = await enabled.run({ query: "precio del cafe 3" }, ctx);
  assert.match(third.error, /Maximo 2 busquedas/);
});

test("runMiraiToolLoop re-evaluates getTools per round: use_module widens the toolset mid-turn", async () => {
  const calls = [];
  const toolsPerCall = [];
  const baseTools = [{ type: "function", function: { name: "use_module", parameters: {} } }];
  const extraTools = [...baseTools, { type: "function", function: { name: "calendar_summary", parameters: {} } }];
  let activated = false;
  const getTools = () => (activated ? extraTools : baseTools);
  const runTool = async (name) => {
    if (name === "use_module") { activated = true; return { modulo: "Calendario" }; }
    return { error: `Herramienta desconocida: ${name}` };
  };
  const callModel = async (_messages, tools) => {
    calls.push(1);
    toolsPerCall.push(tools);
    if (calls.length === 1) return { tool_calls: [{ id: "1", function: { name: "use_module", arguments: "{}" } }] };
    return { content: "listo" };
  };
  const out = await runMiraiToolLoop({
    callModel, getTools, runTool, messages: [], ctx: {}, toolLog: [], clampToolResult: (v) => JSON.stringify(v),
    maxIterations: 5, tooManyStepsText: "too many", emptyText: "empty",
  });
  assert.equal(out.text, "listo");
  assert.equal(calls.length, 2);
  assert.notDeepEqual(toolsPerCall[0], toolsPerCall[1]);
  assert.equal(toolsPerCall[1].length, 2);
});
