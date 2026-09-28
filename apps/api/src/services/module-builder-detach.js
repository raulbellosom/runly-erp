// A ZIP upload that changes a Builder-managed module's code turns its Builder
// project into "modo avanzado" (detached): a later Builder publish would
// regenerate the package from the stored definition and wipe hand-written
// code (components/, custom views, API changes). Re-uploading an unchanged
// package (outcome NO_CHANGES, e.g. the Builder's own ZIP) keeps the link.
// See docs/superpowers/specs/2026-09-28-rme3-builder-advanced-mode-design.md.
export async function detachBuilderProjectAfterUpload(prisma, { moduleKey, outcome, actorId = null }) {
  if (outcome === "NO_CHANGES" || typeof prisma?.moduleBuilderProject?.updateMany !== "function") return false;
  const { count } = await prisma.moduleBuilderProject.updateMany({
    where: { moduleKey, detachedAt: null },
    data: { detachedAt: new Date(), ...(actorId ? { updatedById: actorId } : {}) },
  });
  return count > 0;
}
