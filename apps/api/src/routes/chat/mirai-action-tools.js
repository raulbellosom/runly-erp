// apps/api/src/routes/chat/mirai-action-tools.js
//
// MirAI tools for confirmable write actions (spec §7.1). Offered on the
// direct MirAI conversation and the private panel only — never on @MirAI
// channel mentions. propose_action never writes to a module: it stores a
// pending proposal the user confirms on a card.
const DESCRIPTION_MAX = 240;

export const ACTION_TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "list_actions",
      description: "Lista las acciones que puedes PROPONER al usuario (crear, editar o eliminar registros del ERP) con sus parametros. Consultala antes de proponer.",
      parameters: {
        type: "object",
        properties: { module: { type: "string", description: "Filtro opcional por modulo, ej: runly.calendar." } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_action",
      description: "Prepara una accion para que el usuario la confirme en una tarjeta. NO la ejecuta. Usala solo cuando el usuario pida crear, cambiar o eliminar algo.",
      parameters: {
        type: "object",
        properties: {
          actionKey: { type: "string", description: "actionKey devuelto por list_actions." },
          args: { type: "object", description: "Parametros segun list_actions." },
        },
        required: ["actionKey", "args"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_proposal",
      description: "Cancela la propuesta pendiente de esta conversacion cuando el usuario ya no la quiere.",
      parameters: { type: "object", properties: {} },
    },
  },
];

export function buildActionToolRunners({ registry, proposalService }) {
  async function list_actions(args, ctx) {
    const out = await registry.listAvailable(ctx);
    if (out.error) return { error: out.error };
    const mod = String(args?.module ?? "").trim();
    const actions = out.actions.filter((a) => !mod || a.moduleKey === mod);
    if (!actions.length) return { note: "No hay acciones disponibles para ti en este momento." };
    return {
      acciones: actions.map((a) => ({
        actionKey: a.key,
        nombre: a.label,
        operacion: a.operation,
        descripcion: String(a.description ?? "").slice(0, DESCRIPTION_MAX),
        parametros: a.parameters,
      })),
    };
  }

  // Records the proposal id on the per-turn ctx so mirai-service links it to
  // the reply it persists.
  async function propose_action(args, ctx) {
    const out = await proposalService.propose(ctx, { actionKey: args?.actionKey, args: args?.args });
    if (out.proposalId) ctx.proposalId = out.proposalId;
    return out;
  }

  async function cancel_proposal(_args, ctx) {
    const out = await proposalService.cancelPending(ctx);
    ctx.proposalId = null;
    return out.cancelled ? { cancelled: out.cancelled } : { note: "No habia propuestas pendientes." };
  }

  return { list_actions, propose_action, cancel_proposal };
}
