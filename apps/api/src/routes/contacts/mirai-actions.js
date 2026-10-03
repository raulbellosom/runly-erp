// apps/api/src/routes/contacts/mirai-actions.js
//
// runly.contacts actions MirAI can propose (spec 2026-09-30-mirai-remaining-
// modules §Track B). prepare() validates and resolves a contact name -> id
// without writing; execute() goes through contacts-service.js +
// contacts-effects.js, exactly like the HTTP routes in ../contacts-routes.js.
//
// Map (routes/contacts-routes.js -> services/contacts-service.js):
//   POST   /contacts            -> contactsService.create()   perm contacts.contacts.create -> effects.afterCreate
//   PUT    /contacts/:id        -> contactsService.update()   perm contacts.contacts.update -> effects.afterUpdate
//   DELETE /contacts/:id        -> contactsService.delete()   perm contacts.contacts.delete -> effects.afterDelete (hard delete)
// MirAI's delete action soft-deletes instead (CLAUDE.md "Soft-delete pattern:
// use enabled: false instead of hard-deleting records"), reusing the
// PATCH /contacts/:id/enabled path (contactsService.setEnabled ->
// effects.afterSetEnabled) gated by the stricter contacts.contacts.delete
// permission, since that matches the user's "elimina este contacto" intent.
import { z } from "zod";
import { actorContext } from "../calendar/calendar-event-effects.js";

const TYPES = ["customer", "supplier", "person", "company"];
const optText = (max) => z.string().trim().max(max).nullable().optional();

const createArgs = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(TYPES).optional(),
  email: optText(200),
  phone: optText(40),
  taxId: optText(20),
  website: optText(200),
  industry: optText(120),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
const updateArgs = z.object({
  contactId: z.string().min(1).optional(),
  contactName: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  email: optText(200),
  phone: optText(40),
  website: optText(200),
  industry: optText(120),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
});
const deleteArgs = z.object({
  contactId: z.string().min(1).optional(),
  contactName: z.string().trim().min(1).max(200).optional(),
});

export function createContactsMiraiActions({ contactsService, effects }) {
  // Resolves { contactId } directly, or { contactName } via a company-scoped
  // search (exact match wins; several partial matches -> list the names so
  // the model can ask which one, same pattern as calendar's pickCalendar()).
  async function resolveContact(actx, { contactId, contactName }) {
    if (contactId) {
      const contact = await contactsService.getById({ companyId: actx.companyId, id: contactId }).catch(() => null);
      return contact ? { contact } : { error: "No encontre ese contacto, o no pertenece a esta empresa. Usa contacts_search para obtener su contactId." };
    }
    if (!contactName) return { error: "Indica el contactId (de contacts_search) o el nombre del contacto." };
    const { rows } = await contactsService.list({ companyId: actx.companyId, search: contactName, page: 1, pageSize: 10 });
    const q = contactName.toLowerCase();
    const exact = rows.filter((r) => r.name.toLowerCase() === q);
    const matches = exact.length ? exact : rows;
    if (matches.length === 1) {
      const contact = await contactsService.getById({ companyId: actx.companyId, id: matches[0].id }).catch(() => null);
      return contact ? { contact } : { error: "No encontre ese contacto." };
    }
    if (!matches.length) return { error: `No encontre ningun contacto llamado "${contactName}".` };
    return { error: `Hay varios contactos que coinciden con "${contactName}": ${matches.map((r) => r.name).join(", ")}.` };
  }

  const create = {
    key: "contacts.contact.create",
    moduleKey: "runly.contacts",
    operation: "create",
    label: "Crear contacto",
    permission: "contacts.contacts.create",
    description: "Crea un contacto (cliente, proveedor, persona o empresa).",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        type: { type: "string", enum: TYPES },
        email: { type: "string" },
        phone: { type: "string" },
        taxId: { type: "string" },
        website: { type: "string" },
        industry: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["name"],
    },
    async prepare(args) {
      const parsed = createArgs.safeParse(args);
      if (!parsed.success) return { error: "Falta el nombre del contacto." };
      const a = parsed.data;
      const type = a.type ?? "customer";
      return {
        input: {
          name: a.name, type, email: a.email ?? null, phone: a.phone ?? null, taxId: a.taxId ?? null,
          website: a.website ?? null, industry: a.industry ?? null, tags: a.tags ?? [],
        },
        preview: {
          title: "Crear contacto",
          fields: [
            { label: "Nombre", value: a.name },
            { label: "Tipo", value: type },
            a.email ? { label: "Correo", value: a.email } : null,
            a.phone ? { label: "Telefono", value: a.phone } : null,
            a.tags?.length ? { label: "Etiquetas", value: a.tags.join(", ") } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const contact = await contactsService.create({ companyId: actx.companyId, payload: input });
      await effects.afterCreate(actorContext({ companyId: actx.companyId, profile: actx.actorProfile }), contact);
      return { id: contact.id, summary: `Contacto creado: ${contact.name}`, link: `/app/m/runly.contacts/contacts/${contact.id}` };
    },
  };

  const update = {
    key: "contacts.contact.update",
    moduleKey: "runly.contacts",
    operation: "update",
    label: "Editar contacto",
    permission: "contacts.contacts.update",
    description: "Cambia los datos de un contacto existente. Usa el contactId de contacts_search o el nombre; envia solo los campos que cambian.",
    parameters: {
      type: "object",
      properties: {
        contactId: { type: "string" },
        contactName: { type: "string", description: "Nombre del contacto, si no tienes su contactId." },
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        website: { type: "string" },
        industry: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
    },
    async prepare(args, actx) {
      const parsed = updateArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el contacto a editar y los campos a cambiar." };
      const a = parsed.data;
      const found = await resolveContact(actx, a);
      if (found.error) return { error: found.error };
      const contact = found.contact;
      const data = {};
      const fields = [{ label: "Contacto", value: contact.name }];
      const maybe = (key, label) => {
        if (a[key] !== undefined && (a[key] ?? null) !== (contact[key] ?? null)) {
          data[key] = a[key] ?? null;
          fields.push({ label, before: contact[key] ?? "(vacio)", value: a[key] ?? "(vacio)" });
        }
      };
      maybe("name", "Nombre");
      maybe("email", "Correo");
      maybe("phone", "Telefono");
      maybe("website", "Sitio web");
      maybe("industry", "Giro");
      if (a.tags !== undefined && JSON.stringify([...a.tags].sort()) !== JSON.stringify([...(contact.tags ?? [])].sort())) {
        data.tags = a.tags;
        fields.push({ label: "Etiquetas", before: (contact.tags ?? []).join(", ") || "(ninguna)", value: a.tags.join(", ") || "(ninguna)" });
      }
      if (!Object.keys(data).length) return { error: "No indicaste ningun cambio respecto al contacto actual." };
      return { input: { contactId: contact.id, data }, preview: { title: "Editar contacto", fields }, targetId: contact.id };
    },
    async execute(input, actx) {
      const before = await contactsService.getById({ companyId: actx.companyId, id: input.contactId }).catch(() => null);
      const contact = await contactsService.update({ companyId: actx.companyId, id: input.contactId, payload: input.data });
      await effects.afterUpdate(actorContext({ companyId: actx.companyId, profile: actx.actorProfile }), contact, before);
      return { id: contact.id, summary: `Contacto actualizado: ${contact.name}`, link: `/app/m/runly.contacts/contacts/${contact.id}` };
    },
  };

  const remove = {
    key: "contacts.contact.delete",
    moduleKey: "runly.contacts",
    operation: "delete",
    label: "Eliminar contacto",
    permission: "contacts.contacts.delete",
    description: "Elimina (deshabilita) un contacto existente. Usa el contactId de contacts_search o el nombre.",
    parameters: { type: "object", properties: { contactId: { type: "string" }, contactName: { type: "string" } } },
    async prepare(args, actx) {
      const parsed = deleteArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el contacto a eliminar." };
      const found = await resolveContact(actx, parsed.data);
      if (found.error) return { error: found.error };
      return {
        input: { contactId: found.contact.id },
        targetId: found.contact.id,
        preview: { title: "Eliminar contacto", fields: [{ label: "Contacto", value: found.contact.name }, { label: "Tipo", value: found.contact.type }] },
      };
    },
    async execute(input, actx) {
      const contact = await contactsService.setEnabled({ companyId: actx.companyId, id: input.contactId, enabled: false });
      await effects.afterSetEnabled(actorContext({ companyId: actx.companyId, profile: actx.actorProfile }), contact);
      return { id: contact.id, summary: `Contacto eliminado: ${contact.name}` };
    },
  };

  return [create, update, remove];
}
