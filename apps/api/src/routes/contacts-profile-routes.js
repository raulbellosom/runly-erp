// apps/api/src/routes/contacts-profile-routes.js
//
// Contact 360 endpoints: profile (with channels/addresses/persons), activity,
// duplicates, tag suggestions and avatar. Registered by contacts-routes.js
// BEFORE its "/contacts/:id" handlers so the static paths (tags, duplicates)
// are never captured as an :id.
// Spec: docs/superpowers/specs/2026-09-27-contacts-360-redesign-design.md
import { ContactsServiceError } from "../services/contacts-service.js";
import { createContactActivityService } from "../services/contacts/contact-activity-service.js";
import { publishActivityFromContext, getActivityContext } from "../services/activity-publisher.js";

function handleError(c, err, fallback) {
  if (err instanceof ContactsServiceError) return c.json({ error: err.message }, err.status);
  if (err?.name === "ZodError") {
    const issue = (err.issues ?? err.errors)?.[0];
    return c.json({ error: issue?.message ?? "Datos de contacto inválidos." }, 400);
  }
  console.error("[contacts-profile]", err?.message);
  return c.json({ error: fallback }, 500);
}

export function registerContactsProfileRoutes(app, { prisma, requirePermission, contactsService }) {
  const activityService = createContactActivityService({ prisma });
  const scope = (c) => ({ authUserId: c.get("authUserId"), companyId: c.get("companyId") });

  app.get("/contacts/tags", requirePermission("contacts.contacts.read"), async (c) => {
    try {
      const data = await contactsService.listTags({ ...scope(c), query: c.req.query("q") ?? "" });
      return c.json({ data });
    } catch (err) {
      return handleError(c, err, "No se pudieron cargar las etiquetas.");
    }
  });

  app.get("/contacts/summary", requirePermission("contacts.contacts.read"), async (c) => {
    try {
      return c.json({ data: await contactsService.summary(scope(c)) });
    } catch (err) {
      return handleError(c, err, "No se pudo cargar el resumen de contactos.");
    }
  });

  app.get("/contacts/duplicates", requirePermission("contacts.contacts.read"), async (c) => {
    try {
      const data = await contactsService.findDuplicates({
        ...scope(c),
        taxId: c.req.query("taxId"),
        email: c.req.query("email"),
        phone: c.req.query("phone"),
        excludeId: c.req.query("excludeId") || undefined,
      });
      return c.json({ data });
    } catch (err) {
      return handleError(c, err, "No se pudieron buscar duplicados.");
    }
  });

  app.get("/contacts/:id/profile", requirePermission("contacts.contacts.read"), async (c) => {
    try {
      const data = await contactsService.getProfile({ ...scope(c), id: c.req.param("id") });
      return c.json({ data });
    } catch (err) {
      return handleError(c, err, "No se pudo cargar el contacto.");
    }
  });

  app.get("/contacts/:id/activity", requirePermission("contacts.contacts.read"), async (c) => {
    try {
      const { companyId } = scope(c);
      const contact = await contactsService.getById({ ...scope(c), id: c.req.param("id") });
      const userContext = c.get("userContext") ?? {};
      const data = await activityService.getActivity({
        companyId,
        contactId: contact.id,
        isAdmin: Boolean(userContext.isAdmin),
        permissionSet: userContext.permissionSet,
        module: c.req.query("module") || undefined,
        limit: c.req.query("limit"),
      });
      return c.json({ data });
    } catch (err) {
      return handleError(c, err, "No se pudo cargar la actividad.");
    }
  });

  app.get("/contacts/:id/avatar/signed-url", requirePermission("contacts.contacts.read"), async (c) => {
    try {
      const data = await contactsService.getAvatarSignedUrl({ ...scope(c), id: c.req.param("id"), variant: c.req.query("variant") });
      return c.json({ data });
    } catch (err) {
      return handleError(c, err, "No se pudo cargar la foto.");
    }
  });

  app.post("/contacts/:id/avatar",requirePermission("contacts.contacts.update"), async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body.avatar ?? body.file;
      if (!file || typeof file === "string") return c.json({ error: "Selecciona una imagen." }, 400);
      const id = c.req.param("id");
      const data = await contactsService.setAvatar({ ...scope(c), id, file });
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: "contacts.contact.avatar_changed",
        entityType: "Contact",
        entityId: id,
        summary: `${actorName} actualizó la foto del contacto`,
      });
      return c.json({ data });
    } catch (err) {
      return handleError(c, err, "No se pudo actualizar la foto.");
    }
  });

  app.delete("/contacts/:id/avatar", requirePermission("contacts.contacts.update"), async (c) => {
    try {
      const data = await contactsService.removeAvatar({ ...scope(c), id: c.req.param("id") });
      return c.json({ data });
    } catch (err) {
      return handleError(c, err, "No se pudo quitar la foto.");
    }
  });
}
