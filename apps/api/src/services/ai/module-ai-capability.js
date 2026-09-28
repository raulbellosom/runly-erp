// apps/api/src/services/ai/module-ai-capability.js
//
// `moduleContext.ai` for RME3 modules (spec:
// docs/superpowers/specs/2026-09-28-module-ai-public-lookup-design.md §4.3).
// Gives a module MirAI's tool loop plus the shared public lookup, restricted
// to the fields its manifest declares under `ai.publicLookup`.

import { PUBLIC_LOOKUP_PROMPT_RULE } from "./public-lookup.js";

export function createModuleAiCapability({ prisma, createMirai }) {
  let mirai = null;
  const getMirai = () => (mirai ??= createMirai());

  return function aiCapability(moduleKey, manifest) {
    const declarations = new Map((manifest?.ai?.publicLookup ?? []).map(entry => [entry.model, entry]));
    const lookupEnabled = () => declarations.size > 0 && Boolean(getMirai().publicLookup?.enabled);

    function toolDefinition(model, { name, description } = {}) {
      const entry = declarations.get(model);
      if (!entry || !lookupEnabled()) return null;
      const properties = { id: { type: "string", description: "Id del registro tomado del contexto." } };
      if (entry.topics?.length) properties.topic = { type: "string", enum: entry.topics };
      return { type: "function", function: {
        name: name ?? `${model}_public_lookup`,
        description: description ?? `Busca en internet información pública (${entry.publicFields.join(", ")}) de un registro de ${model}. Solo cuando el usuario lo pida explícitamente.`,
        parameters: { type: "object", additionalProperties: false, properties, required: ["id"] },
      } };
    }

    // `record` must already be resolved and authorized by the module. Only
    // the declared publicFields leave the server.
    async function run({ model, record, topic, budget, companyId = null, actorId = null }) {
      const entry = declarations.get(model);
      if (!entry) return { error: "Este registro no admite búsqueda pública." };
      if (!lookupEnabled()) return { error: "La búsqueda en internet no está configurada." };
      if (!record) return { error: "Registro no disponible en este contexto." };
      const subject = Object.fromEntries(entry.publicFields.map(field => [field, record[field]]));
      const safeTopic = entry.topics?.includes(topic) ? topic : entry.topics?.[0];
      const result = await getMirai().publicLookup.lookup({ subject, topic: safeTopic, budget });
      if (companyId) {
        await prisma.auditLog.create({ data: { companyId, actorId, moduleKey, action: `${moduleKey}.ai.public_lookup`,
          metadata: { model, recordId: record.id ?? null, query: result.query ?? null } } }).catch(() => {});
      }
      return result;
    }

    return {
      get enabled() { return getMirai().isConfigured(); },
      get publicLookupEnabled() { return lookupEnabled(); },
      promptRule: PUBLIC_LOOKUP_PROMPT_RULE,
      answerWithTools: args => getMirai().answerWithTools(args),
      publicLookup: {
        models: [...declarations.keys()],
        toolDefinition,
        createTurnBudget: () => getMirai().publicLookup.createTurnBudget(),
        run,
      },
    };
  };
}
