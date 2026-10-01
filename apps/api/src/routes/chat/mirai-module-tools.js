// apps/api/src/routes/chat/mirai-module-tools.js
//
// On-demand module tools for MirAI (spec §6). Core defs are always sent;
// a module's read tools join the request once the module is active for the
// turn (page module or use_module). Actions are proposals (never executed
// here) confirmed on a card.
import { z } from "zod";
import { buildActionContext } from "./mirai-proposal-service.js";

const MAX_MODULES_PER_TURN = 3;
const DESCRIPTION_MAX = 240;

export const miraiPageContextSchema = z.object({
  moduleKey: z.string().max(200),
  path: z.string().max(200).optional(),
  recordType: z.string().max(200).optional(),
  recordId: z.string().max(200).optional(),
  label: z.string().max(200).optional(),
});

export function parseMiraiPageContext(value) {
  const parsed = miraiPageContextSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export const MODULE_TOOL_DEFS = [
  { type: "function", function: { name: "list_modules", description: "Lista los modulos del ERP con los que puedes trabajar para este usuario (consultas exactas y acciones).", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "use_module", description: "Activa las herramientas de un modulo (consultas, totales, analisis) y devuelve sus acciones disponibles para propose_action. Usalo antes de consultar o actuar en un modulo.", parameters: { type: "object", properties: { moduleKey: { type: "string", description: "Ej: runly.calendar" } }, required: ["moduleKey"] } } },
  { type: "function", function: { name: "propose_action", description: "Prepara una accion para que el usuario la confirme en una tarjeta. NO la ejecuta. Solo cuando el usuario pida crear, cambiar o eliminar algo.", parameters: { type: "object", properties: { actionKey: { type: "string" }, args: { type: "object" } }, required: ["actionKey", "args"] } } },
  { type: "function", function: { name: "cancel_proposal", description: "Cancela la propuesta pendiente de esta conversacion cuando el usuario ya no la quiere.", parameters: { type: "object", properties: {} } } },
];

const toolDef = (t) => ({ type: "function", function: { name: t.name, description: t.definition.description, parameters: t.definition.parameters } });

export function createModuleToolset({ prisma, registry, proposalService }) {
  // Per-turn state lives on ctx: ctx.activeModules (Map moduleKey -> { scope, module }).
  async function activate(ctx, moduleKey) {
    ctx.activeModules ??= new Map();
    if (ctx.activeModules.has(moduleKey)) return { module: ctx.activeModules.get(moduleKey).module };
    if (ctx.activeModules.size >= MAX_MODULES_PER_TURN) return { error: "Demasiados modulos en una consulta." };
    const out = await registry.getModule(ctx, moduleKey);
    if (out.error) return out;
    ctx.activeModules.set(moduleKey, out);
    return { module: out.module };
  }

  // Called once per turn before the loop. Never throws.
  async function startTurn(ctx) {
    ctx.activeModules = new Map();
    if (!ctx.pageContext?.moduleKey) return null;
    await activate(ctx, ctx.pageContext.moduleKey).catch(() => null);
    return registry.describeContext(ctx, ctx.pageContext);
  }

  function getTools(ctx) {
    const extra = [...(ctx.activeModules?.values() ?? [])].flatMap(({ module }) => module.tools.map(toolDef));
    return [...MODULE_TOOL_DEFS, ...extra];
  }

  const runners = {
    async list_modules(_args, ctx) {
      const out = await registry.listModules(ctx);
      if (out.error) return { error: out.error };
      return {
        modulos: out.modules.map((m) => ({ moduleKey: m.moduleKey, nombre: m.label, resumen: m.summary, consultas: m.tools.length, acciones: m.actions.length })),
      };
    },
    async use_module(args, ctx) {
      const out = await activate(ctx, String(args?.moduleKey ?? ""));
      if (out.error) return { error: out.error };
      return {
        modulo: out.module.label,
        consultas: out.module.tools.map((t) => t.name),
        acciones: out.module.actions.map((a) => ({
          actionKey: a.key, nombre: a.label, operacion: a.operation,
          descripcion: String(a.description ?? "").slice(0, DESCRIPTION_MAX), parametros: a.parameters,
        })),
      };
    },
    async propose_action(args, ctx) {
      const out = await proposalService.propose(ctx, { actionKey: args?.actionKey, args: args?.args });
      if (out.proposalId) ctx.proposalId = out.proposalId;
      return out;
    },
    async cancel_proposal(_args, ctx) {
      const out = await proposalService.cancelPending(ctx);
      ctx.proposalId = null;
      return out.cancelled ? { cancelled: out.cancelled } : { note: "No habia propuestas pendientes." };
    },
  };

  // -> result, or undefined when `name` is not a module tool of this turn.
  async function run(name, args, ctx) {
    if (runners[name]) return runners[name](args, ctx);
    for (const { scope, module } of ctx.activeModules?.values() ?? []) {
      const tool = module.tools.find((t) => t.name === name);
      if (tool) return tool.run(args ?? {}, buildActionContext(prisma, scope, ctx));
    }
    return undefined;
  }

  return { startTurn, getTools, run };
}
