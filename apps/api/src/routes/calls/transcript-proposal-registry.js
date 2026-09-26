// Generic orchestrator for module-registered transcript proposal types — see
// docs/superpowers/specs/2026-09-25-transcript-module-proposals-design.md.
//
// A module (e.g. contacts, and later finance/inventory per the spec's Future
// Enhancements) participates by exporting a descriptor with this shape:
//   {
//     moduleKey: string,                          // e.g. "runly.contacts"
//     jsonKey: string,                             // the key Groq's JSON uses, e.g. "proposedContacts"
//     promptFragment: string,                      // appended to the system prompt when available
//     isAvailable({ prisma, companyId }): Promise<boolean>,
//     normalize(rawArray): array,                  // validate/shape Groq's raw output
//     matchExisting({ prisma, companyId, proposals }): Promise<array>, // attaches match info
//     assertWriteAccess({ prisma, profileId, companyId, proposal, decision }): Promise<void>, // throws on denial
//     commit({ prisma, profileId, companyId, proposal, decision }): Promise<{ id: string }>,
//   }
//
// call-transcript-analysis-service.js never imports a specific module's
// service directly — it only knows the registry and the generic descriptor
// shape, so adding a module never touches that file beyond the registration
// list below.
import { contactsProposalModule } from "./transcript-proposal-modules/contacts-proposal-module.js";

const REGISTERED_MODULES = [contactsProposalModule];

// Resolves which registered descriptors are actually usable for this specific
// company right now — spec §19 point 1. A module whose own isAvailable()
// check fails (not installed, or disabled for this company) is silently
// excluded from both the Groq prompt and the response, never surfaced as
// "unavailable" to the caller — same principle as a company without
// runly.ledger never even knowing this capability exists for it.
export async function resolveAvailableProposalModules({ prisma, companyId }) {
  const checks = await Promise.all(
    REGISTERED_MODULES.map(async (mod) => {
      try {
        return (await mod.isAvailable({ prisma, companyId })) ? mod : null;
      } catch {
        return null; // a broken availability check must not break analysis for everyone else
      }
    }),
  );
  return checks.filter(Boolean);
}

export function getProposalModule(moduleKey) {
  return REGISTERED_MODULES.find((m) => m.moduleKey === moduleKey) ?? null;
}

// analyzeTranscript side: builds the extra system-prompt text and pulls each
// available module's raw array out of Groq's JSON response, normalizing and
// match-detecting it into the shape persisted to
// CallTranscriptAnalysis.moduleProposals.
export function buildModulePromptAdditions(availableModules) {
  return availableModules.map((m) => m.promptFragment).join(" ");
}

export async function extractModuleProposals({ prisma, companyId, obj, availableModules }) {
  const result = {};
  for (const mod of availableModules) {
    const raw = Array.isArray(obj?.[mod.jsonKey]) ? obj[mod.jsonKey] : [];
    const normalized = mod.normalize(raw);
    if (!normalized.length) continue;
    const matched = await mod.matchExisting({ prisma, companyId, proposals: normalized });
    result[mod.moduleKey] = { proposed: matched, committedIds: [] };
  }
  return result;
}

// commitProposals side: dispatches each accepted module proposal to its own
// descriptor's assertWriteAccess + commit, exactly mirroring how
// acceptedActionItems/acceptedEvents are already handled inline in
// call-transcript-analysis-service.js — one bad/unauthorized item never
// aborts the rest of the commit.
export async function commitModuleProposals({
  prisma, profileId, companyId, moduleProposals, acceptedModuleProposals,
}) {
  const createdModuleRecords = []; // { moduleKey, index, recordId }
  const skippedModuleProposals = []; // { moduleKey, index, reason }
  const committedIdsByModule = {}; // moduleKey -> uuid[]

  for (const item of acceptedModuleProposals ?? []) {
    const mod = getProposalModule(item.moduleKey);
    const bucket = moduleProposals?.[item.moduleKey];
    const proposal = bucket?.proposed?.[item.index];
    if (!mod || !proposal) {
      skippedModuleProposals.push({ moduleKey: item.moduleKey, index: item.index, reason: "No existe una propuesta con ese indice." });
      continue;
    }
    try {
      await mod.assertWriteAccess({ prisma, profileId, companyId, proposal, decision: item.decision });
      const record = await mod.commit({ prisma, profileId, companyId, proposal, decision: item.decision });
      createdModuleRecords.push({ moduleKey: item.moduleKey, index: item.index, recordId: record.id });
      (committedIdsByModule[item.moduleKey] ??= []).push(record.id);
    } catch (err) {
      skippedModuleProposals.push({ moduleKey: item.moduleKey, index: item.index, reason: err?.message ?? String(err) });
    }
  }

  return { createdModuleRecords, skippedModuleProposals, committedIdsByModule };
}
