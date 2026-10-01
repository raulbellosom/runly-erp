// apps/api/src/routes/chat/mirai-record-links.js
//
// show_records: MirAI attaches up to 5 record cards (title, subtitle, link) to
// its reply. Each ref is resolved through Chat's entity-reference service, the
// same path a user's own shared reference takes: active-company membership,
// the per-type read permission and the record existing in that company. Refs
// that fail any check are dropped silently, so the model can never surface a
// record the user couldn't open. Stored as the reply's `metadata.entityRefs`
// (rendered by EntityReferenceCard in Chat and in the MirAI sidebar).
const MAX_REFS = 5;
export const RECORD_TYPES = ["contact", "file", "hr_employee", "project", "task", "calendar_event", "ledger_account", "vehicle", "inventory_item"];

export const SHOW_RECORDS_DEF = {
  type: "function",
  function: {
    name: "show_records",
    description: "Muestra al usuario tarjetas con enlace a los registros concretos de los que hablas (maximo 5), usando los ids que devolvieron las consultas. Tipos: contact, file, hr_employee, project, task, calendar_event, ledger_account, vehicle, inventory_item.",
    parameters: {
      type: "object",
      properties: {
        records: {
          type: "array",
          maxItems: MAX_REFS,
          items: {
            type: "object",
            properties: { type: { type: "string", enum: RECORD_TYPES }, id: { type: "string" } },
            required: ["type", "id"],
          },
        },
      },
      required: ["records"],
    },
  },
};

// resolveEntityRefs: ({ authUserId, companyId, entityRefs }) => resolved refs
export function createShowRecordsTool({ resolveEntityRefs }) {
  async function run(args, ctx) {
    const requested = (Array.isArray(args?.records) ? args.records : [])
      .filter((r) => RECORD_TYPES.includes(r?.type) && typeof r?.id === "string" && r.id.trim())
      .map((r) => ({ entityType: r.type, recordId: r.id.split("_")[0].trim() }));
    if (!requested.length) return { error: "Indica registros con type e id de las consultas." };
    const existing = ctx.recordLinks ?? [];
    const room = MAX_REFS - existing.length;
    if (room <= 0) return { error: `Ya hay ${MAX_REFS} tarjetas en esta respuesta.` };
    const seen = new Set(existing.map((r) => `${r.entityType}:${r.recordId}`));
    const fresh = requested.filter((r) => {
      const key = `${r.entityType}:${r.recordId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const added = fresh.length
      ? await resolveEntityRefs({ authUserId: ctx.actorAuthUserId, companyId: ctx.companyId, entityRefs: fresh.slice(0, room) })
      : [];
    ctx.recordLinks = [...existing, ...added];
    if (!added.length) return { note: "Ninguno de esos registros esta disponible para este usuario; no menciones enlaces." };
    return { mostrados: added.map((r) => r.title), omitidos: requested.length - added.length };
  }
  return { def: SHOW_RECORDS_DEF, run };
}
