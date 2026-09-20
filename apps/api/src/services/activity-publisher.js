// apps/api/src/services/activity-publisher.js
// Helper para publicar actividad desde rutas core sin refactorizar las factories de cada
// service. Resuelve companyId/actorId desde el `userContext` que el middleware ya inyecta.
//
// Uso:
//   import { publishActivityFromContext } from "../services/activity-publisher.js";
//   await publishActivityFromContext(prisma, c, {
//     type: "calendar.event.create",
//     summary: `${actorName} creó el evento "${title}"`,
//     severity: "success",
//     entityType: "CalendarEvent",
//     entityId: event.id,
//   });
//
// Nunca lanza: cualquier error se loguea y se ignora, para no romper la mutación principal.

import { createActivityService } from "./activity-service.js";

let cachedService = null;
let cachedPrisma = null;

function getService(prisma) {
  if (cachedService && cachedPrisma === prisma) return cachedService;
  cachedPrisma = prisma;
  cachedService = createActivityService({ prisma });
  return cachedService;
}

function resolveContext(c) {
  const ctx = c?.get?.("userContext") ?? null;
  const companyId =
    c?.get?.("companyId") ?? null;
  const actorId = ctx?.profile?.id ?? null;
  const actorProfile = ctx?.profile ?? null;
  return { companyId, actorId, actorProfile };
}

export function getActorDisplayName(profile) {
  if (!profile) return "Sistema";
  return (
    profile.displayName ||
    [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() ||
    profile.email ||
    "Sistema"
  );
}

export async function publishActivityFromContext(prisma, c, input) {
  try {
    const { companyId, actorId } = resolveContext(c);
    if (!companyId) return null;
    const service = getService(prisma);
    const publishInput = {
      companyId,
      actorId,
      type: input.type,
      summary: input.summary,
      severity: input.severity ?? "info",
      source: "explicit",
    };
    if (input.entityType) publishInput.entityType = input.entityType;
    if (input.entityId) publishInput.entityId = input.entityId;
    if (input.link) publishInput.link = input.link;
    if (input.payload && typeof input.payload === "object") {
      publishInput.payload = input.payload;
    }
    return await service.publish(publishInput);
  } catch (err) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[activity-publisher] publish failed:", err?.message ?? err);
    }
    return null;
  }
}

// Helper conveniente para rutas que sólo quieren el actor + contexto.
export function getActivityContext(c) {
  const { companyId, actorId, actorProfile } = resolveContext(c);
  return {
    companyId,
    actorId,
    actorName: getActorDisplayName(actorProfile),
  };
}
