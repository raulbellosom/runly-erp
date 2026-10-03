// apps/api/src/routes/contacts/contacts-effects.js
//
// Side effects after a contact write (activity entry), shared by the HTTP
// routes (../contacts-routes.js) and MirAI actions (./mirai-actions.js).
// Extracted from contacts-routes.js (spec 2026-09-30-mirai-remaining-modules
// §Track B) so both call sites stay identical. `c` is a Hono context or
// actorContext() from ../calendar/calendar-event-effects.js when called
// outside an HTTP request.
import { publishActivityFromContext, getActivityContext } from "../../services/activity-publisher.js";
import { computeFieldChanges, compactChanges } from "../../services/activity-bridge.js";

export function createContactsEffects({ prisma }) {
  async function afterCreate(c, contact) {
    const { actorName } = getActivityContext(c);
    await publishActivityFromContext(prisma, c, {
      type: "contacts.contact.create",
      severity: "success",
      entityType: "Contact",
      entityId: contact.id,
      summary: `${actorName} creó el contacto "${contact.name ?? ""}"`.trim(),
    });
  }

  // `before`: the contact row prior to the write; with it the entry carries
  // the field-level diff shown by the audit trail.
  async function afterUpdate(c, contact, before = null) {
    const { actorName } = getActivityContext(c);
    const changes = before ? compactChanges(computeFieldChanges(before, contact)) : [];
    await publishActivityFromContext(prisma, c, {
      type: "contacts.contact.update",
      severity: "info",
      entityType: "Contact",
      entityId: contact.id,
      summary: `${actorName} actualizó el contacto "${contact.name ?? ""}"`.trim(),
      ...(changes.length ? { payload: { changes } } : {}),
    });
  }

  async function afterSetEnabled(c, contact) {
    const { actorName } = getActivityContext(c);
    await publishActivityFromContext(prisma, c, {
      type: contact.enabled ? "contacts.contact.enable" : "contacts.contact.disable",
      severity: contact.enabled ? "info" : "warning",
      entityType: "Contact",
      entityId: contact.id,
      summary: `${actorName} ${contact.enabled ? "habilitó" : "deshabilitó"} el contacto "${contact.name ?? ""}"`.trim(),
    });
  }

  async function afterDelete(c, contactId) {
    const { actorName } = getActivityContext(c);
    await publishActivityFromContext(prisma, c, {
      type: "contacts.contact.delete",
      severity: "warning",
      entityType: "Contact",
      entityId: contactId,
      summary: `${actorName} eliminó un contacto`,
    });
  }

  return { afterCreate, afterUpdate, afterSetEnabled, afterDelete };
}
