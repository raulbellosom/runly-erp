// apps/api/src/routes/contacts/contacts-mirai-queries.js
//
// Exact runly.contacts tools for MirAI (spec 2026-09-30-mirai-remaining-
// modules §3 contacts): search, detail and summary over the caller's
// company contacts. Aggregates are computed in SQL/Prisma, never left for
// the model to add up from a partial list.
import { createPublicLookup } from "../../services/ai/public-lookup.js";

const LIST_MAX = 30;
const TYPE_LABEL = { customer: "cliente", supplier: "proveedor", person: "persona", company: "empresa" };

function toSearchRow(row) {
  return {
    contactId: row.id,
    nombre: row.name,
    tipo: row.type,
    correo: row.email,
    telefono: row.phone,
    ciudad: row.city ?? null,
    etiquetas: row.tags ?? [],
    activo: row.enabled,
  };
}

export function createContactsMiraiQueries({ prisma, contactsService, publicLookup = createPublicLookup({ env: process.env }) }) {
  const contacts_search = {
    name: "contacts_search",
    permission: "contacts.contacts.read",
    definition: {
      description: "Busca contactos (clientes, proveedores, personas o empresas) por nombre, correo, telefono, RFC o etiqueta.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Texto libre: nombre, correo, telefono, RFC/ID fiscal o etiqueta." },
          type: { type: "string", enum: ["customer", "supplier", "person", "company"], description: "Filtra por tipo de contacto." },
          tag: { type: "string", description: "Filtra por una etiqueta exacta." },
          includeInactive: { type: "boolean", description: "Incluye contactos deshabilitados (por defecto solo activos)." },
        },
      },
    },
    async run(args, actx) {
      const result = await contactsService.list({
        companyId: actx.companyId,
        search: args?.search,
        type: args?.type,
        tag: args?.tag,
        enabled: !args?.includeInactive,
        page: 1,
        pageSize: LIST_MAX,
      });
      return { total: result.total, contactos: result.rows.slice(0, LIST_MAX).map(toSearchRow) };
    },
  };

  const contacts_detail = {
    name: "contacts_detail",
    permission: "contacts.contacts.read",
    definition: {
      description: "Obtiene el detalle de un contacto: datos generales, canales, direcciones y personas relacionadas (si es una empresa).",
      parameters: {
        type: "object",
        properties: { contactId: { type: "string" } },
        required: ["contactId"],
      },
    },
    async run(args, actx) {
      const contact = await contactsService.getProfile({ companyId: actx.companyId, id: String(args?.contactId ?? "") }).catch(() => null);
      if (!contact) return { error: "No encontre ese contacto, o no pertenece a esta empresa." };
      return {
        contactId: contact.id,
        nombre: contact.name,
        tipo: contact.type,
        razonSocial: contact.legalName ?? null,
        correo: contact.email,
        telefono: contact.phone,
        rfc: contact.taxId,
        sitioWeb: contact.website,
        giro: contact.industry,
        etiquetas: contact.tags ?? [],
        activo: contact.enabled,
        notas: contact.notesMarkdown ? contact.notesMarkdown.slice(0, 1000) : null,
        canales: (contact.channels ?? []).map((ch) => ({ tipo: ch.kind, valor: ch.value, principal: ch.isPrimary })),
        direcciones: (contact.addresses ?? []).map((a) => ({ ciudad: a.city, estado: a.state, principal: a.isDefault })),
        personasRelacionadas: (contact.persons ?? []).map((p) => ({ nombre: p.name, puesto: p.role, principal: p.isPrimary })),
      };
    },
  };

  const contacts_summary = {
    name: "contacts_summary",
    permission: "contacts.contacts.read",
    definition: {
      description: "Totales exactos de contactos, agrupados por tipo, etiqueta o mes de alta (ultimos 12 meses).",
      parameters: {
        type: "object",
        properties: { groupBy: { type: "string", enum: ["type", "tag", "month"], description: "Como agrupar (por defecto type)." } },
      },
    },
    async run(args, actx) {
      const groupBy = ["type", "tag", "month"].includes(args?.groupBy) ? args.groupBy : "type";
      if (groupBy === "type") {
        const { total, inactive, byType } = await contactsService.summary({ companyId: actx.companyId });
        return {
          total,
          inactivos: inactive,
          grupos: Object.entries(byType).map(([tipo, count]) => ({ grupo: TYPE_LABEL[tipo] ?? tipo, contactos: count })),
        };
      }
      if (groupBy === "tag") {
        const rows = await prisma.$queryRaw`
          SELECT tag AS grupo, COUNT(*)::int AS contactos
          FROM contact, unnest(tags) AS tag
          WHERE company_id = ${actx.companyId}::uuid AND enabled = true
          GROUP BY tag ORDER BY contactos DESC LIMIT 20`;
        return { total: rows.reduce((sum, r) => sum + r.contactos, 0), grupos: rows };
      }
      const rows = await prisma.$queryRaw`
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS grupo, COUNT(*)::int AS contactos
        FROM contact
        WHERE company_id = ${actx.companyId}::uuid AND created_at >= NOW() - INTERVAL '12 months'
        GROUP BY grupo ORDER BY grupo`;
      return { total: rows.reduce((sum, r) => sum + r.contactos, 0), grupos: rows };
    },
  };

  const contacts_public_company_info = {
    name: "contacts_public_company_info",
    permission: "contacts.contacts.read",
    definition: {
      description: "Busca en internet informacion publica (sitio web, giro) de un contacto tipo empresa o proveedor. Solo cuando el usuario lo pida explicitamente; nunca envia correos ni telefonos.",
      parameters: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"] },
    },
    async run(args, actx) {
      if (!publicLookup?.enabled) return { error: "La busqueda en internet no esta configurada." };
      const contact = await contactsService.getProfile({ companyId: actx.companyId, id: String(args?.contactId ?? "") }).catch(() => null);
      if (!contact) return { error: "No encontre ese contacto, o no pertenece a esta empresa." };
      if (!["company", "supplier", "customer"].includes(contact.type)) return { error: "Ese contacto no es una empresa." };
      actx.turn ??= {};
      actx.turn.contactsPublicLookupBudget ??= publicLookup.createTurnBudget();
      const city = contact.addresses?.find((a) => a.isDefault)?.city ?? contact.addresses?.[0]?.city ?? null;
      return publicLookup.lookup({ subject: { name: contact.name, website: contact.website, city }, budget: actx.turn.contactsPublicLookupBudget });
    },
  };

  return [contacts_search, contacts_detail, contacts_summary, contacts_public_company_info];
}
