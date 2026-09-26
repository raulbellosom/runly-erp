// apps/api/src/lib/tenant-provisioning.js
//
// Small helpers shared between /setup/initialize (apps/api/src/index.js)
// and POST /companies (apps/api/src/routes/company-routes.js) — both
// provision a brand-new Company row and need a unique slug plus the
// system-wide "runly.admin" role. Extracted from index.js on 2026-09-25 so
// neither route file needs to import the other.

export function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function ensureSetupAdminRole(db) {
  // Role.key is no longer globally unique (Role is now company-scoped, see
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §9.3).
  // Prisma rejects `null` inside a compound-unique where (companyId_key), so
  // this system role (companyId IS NULL) is upserted by hand via findFirst.
  const existing = await db.role.findFirst({
    where: { companyId: null, key: "runly.admin" },
  });
  const data = {
    enabled: true,
    system: true,
    name: "Runly Admin",
    description: "Acceso total del sistema",
  };
  if (existing) {
    return db.role.update({ where: { id: existing.id }, data });
  }
  return db.role.create({ data: { key: "runly.admin", ...data } });
}
