// runly.contacts descriptor for the transcript-proposal-registry — the pilot
// module of docs/superpowers/specs/2026-09-25-transcript-module-proposals-design.md.
// See that file's §10/§18/§19 for the data model, permission, and tenancy
// rules this implements.
import { createContactsService } from "../../../services/contacts-service.js";
import { createCompanyModuleService } from "../../../services/company-module-service.js";
import { resolveCompanyPermissions, hasCompanyPermission } from "../../../lib/company-scoped-permissions.js";

const MODULE_KEY = "runly.contacts";
const VALID_TYPES = new Set(["customer", "supplier", "person", "company"]);

const PROMPT_FRAGMENT = [
  "Ademas, si se menciono a una persona o empresa NUEVA con la que hay que dar seguimiento",
  "(nombre identificable, idealmente con correo, telefono o el nombre de su empresa),",
  'agregala a "proposedContacts": [{"name": string, "suggestedType": "customer"|"supplier"|"person"|"company", "email": string opcional, "phone": string opcional, "company": string opcional}].',
  "suggestedType es tu mejor sugerencia, no una certeza — el usuario la confirma despues.",
  "No agregues a alguien que ya es un participante conocido de la llamada, solo personas/empresas NUEVAS mencionadas en la conversacion.",
  'Si nadie nuevo fue mencionado, devuelve un arreglo vacio en "proposedContacts".',
].join(" ");

async function isAvailable({ prisma, companyId }) {
  const module = await prisma.runlyModule.findUnique({
    where: { key: MODULE_KEY },
    select: { id: true, status: true, enabled: true },
  });
  if (!module || module.status !== "INSTALLED" || !module.enabled) return false;
  const companyModuleService = createCompanyModuleService({ prisma });
  return companyModuleService.isModuleEnabledForCompany({ companyId, moduleId: module.id });
}

function normalize(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((c) => ({
      name: String(c?.name ?? "").trim(),
      suggestedType: VALID_TYPES.has(c?.suggestedType) ? c.suggestedType : "person",
      email: c?.email ? String(c.email).trim() : null,
      phone: c?.phone ? String(c.phone).trim() : null,
      company: c?.company ? String(c.company).trim() : null,
    }))
    // Same "no name, no proposal" filter normalizeDraft already applies to
    // actionItems — a nameless contact is not something to show as a proposal.
    .filter((c) => c.name.length >= 2);
}

// Best-effort fuzzy match by exact (case-insensitive) name against this
// company's own contacts — never cross-company (contactsService.picker is
// already companyId-scoped). A lookup failure degrades to "no match found"
// (propose "create" instead of "update") rather than aborting the whole
// analysis over one contact's lookup.
async function matchExisting({ prisma, companyId, proposals }) {
  const contactsService = createContactsService({ prisma });
  const results = [];
  for (const proposal of proposals) {
    let matchedContactId = null;
    try {
      const hits = await contactsService.picker({ authUserId: null, companyId, query: proposal.name, limit: 5 });
      const exact = hits.find((h) => h.name?.trim().toLowerCase() === proposal.name.toLowerCase());
      matchedContactId = exact?.id ?? null;
    } catch {
      matchedContactId = null;
    }
    results.push({ ...proposal, matchedContactId });
  }
  return results;
}

// Mirrors assertProjectAccess's role in call-transcript-analysis-service.js:
// the permission this checks is NOT gated at the route level (the route only
// requires chat.calls.transcript.analyze, the general "can use this
// feature" gate) — this is the specific, company-scoped RBAC permission the
// real contacts routes already require (contacts-routes.js), re-checked here
// because commitProposals calls contactsService directly, bypassing that
// route entirely.
async function assertWriteAccess({ prisma, profileId, companyId, proposal, decision }) {
  const action = proposal?.matchedContactId ? "update" : "create";
  const scoped = await resolveCompanyPermissions({ prisma, profileId, companyId });
  if (!hasCompanyPermission(scoped, `contacts.contacts.${action}`)) {
    throw new Error("No tienes permiso para crear/actualizar contactos en esta empresa.");
  }
  if (!VALID_TYPES.has(String(decision?.type ?? ""))) {
    throw new Error("Elige un tipo de contacto valido antes de confirmar.");
  }
}

async function commit({ prisma, profileId, companyId, proposal, decision }) {
  const contactsService = createContactsService({ prisma });
  const type = decision.type;
  if (proposal.matchedContactId) {
    // update() itself re-derives companyId ownership via
    // assertContactOwnership — never trusts matchedContactId blindly, spec §19.
    const updated = await contactsService.update({
      authUserId: profileId,
      companyId,
      id: proposal.matchedContactId,
      payload: {
        type,
        ...(proposal.email ? { email: proposal.email } : {}),
        ...(proposal.phone ? { phone: proposal.phone } : {}),
      },
    });
    return { id: updated.id };
  }
  const created = await contactsService.create({
    authUserId: profileId,
    companyId,
    payload: {
      type,
      name: proposal.name,
      ...(proposal.company ? { legalName: proposal.company } : {}),
      ...(proposal.email ? { email: proposal.email } : {}),
      ...(proposal.phone ? { phone: proposal.phone } : {}),
    },
  });
  return { id: created.id };
}

export const contactsProposalModule = {
  moduleKey: MODULE_KEY,
  jsonKey: "proposedContacts",
  promptFragment: PROMPT_FRAGMENT,
  isAvailable,
  normalize,
  matchExisting,
  assertWriteAccess,
  commit,
};
