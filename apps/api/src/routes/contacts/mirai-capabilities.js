// apps/api/src/routes/contacts/mirai-capabilities.js
//
// runly.contacts capability for MirAI (spec 2026-09-30-mirai-remaining-
// modules §Track B). Builds its own contacts service + effects the same way
// routes/contacts-routes.js does, independent of the HTTP router.
import { createContactsService } from "../../services/contacts-service.js";
import { createContactsEffects } from "./contacts-effects.js";
import { createContactsMiraiQueries } from "./contacts-mirai-queries.js";
import { createContactsMiraiActions } from "./mirai-actions.js";

const TYPE_LABEL = { customer: "cliente", supplier: "proveedor", person: "persona", company: "empresa" };

export function createContactsMiraiCapabilities({ prisma }) {
  const contactsService = createContactsService({ prisma });
  const effects = createContactsEffects({ prisma });

  return {
    moduleKey: "runly.contacts",
    label: "Contactos",
    summary: "Clientes, proveedores, personas y empresas: busqueda, detalle y totales; crear, editar y eliminar contactos.",
    tools: createContactsMiraiQueries({ prisma, contactsService }),
    actions: createContactsMiraiActions({ contactsService, effects }),
    publicLookup: [{ model: "contact", publicFields: ["name", "website", "city"] }],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType !== "contact" || !pageContext.recordId) return null;
      const contact = await contactsService.getById({ companyId: actx.companyId, id: String(pageContext.recordId) }).catch(() => null);
      if (!contact) return null;
      return `El usuario esta viendo el contacto "${contact.name}" (contactId ${contact.id}), tipo ${TYPE_LABEL[contact.type] ?? contact.type}.`;
    },
  };
}
