// apps/api/src/routes/identity/identity-roles-routes.js
//
// Permissions catalog + role CRUD + role members. Extracted from index.js
// on 2026-09-25 to keep index.js under the CLAUDE.md 1000-line limit,
// following the same createXxxRouter + mountWithAuth pattern already used
// across the codebase. Mounted via mountWithAuth() (applied by the parent
// identity router), which applies authMiddleware globally — route handlers
// here never call it themselves.
import { Hono } from "hono";
import {
  getPermissionPresentation,
  groupPermissionsForUi,
} from "../../permission-catalog.js";
import { publishActivityFromContext, getActivityContext } from "../../services/activity-publisher.js";
import { buildAvatarUrlMapByFileIds } from "../../lib/avatar-url-map.js";
import { ADMIN_ROLE_KEYS } from "./identity-shared.js";

// A role is editable/deletable/listable-in-detail by: (a) a system admin, for
// any role, or (b) a company-scoped caller, only for a role that belongs to
// THEIR OWN company. System roles (companyId === null, e.g.
// runly.admin/system.admin) are never touchable by a company-scoped caller,
// even one holding identity.roles.*/identity.permissions.* -- those
// permissions govern a company's own custom roles, not the platform's shared
// catalog. Returns null (→ 404 at the call site) rather than throwing, so
// existence is never confirmed/denied differently for an out-of-scope role.
async function loadCompanyEditableRole(id, tenant, prisma) {
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) return null;
  if (tenant?.isSystemAdmin) return role;
  if (role.companyId && role.companyId === tenant?.companyId) return role;
  return null;
}

export function createIdentityRolesRouter({ prisma, supabaseAdmin, requirePermission, cacheDelByPrefix }) {
  const app = new Hono();

  app.get(
    "/identity/permissions",
    requirePermission("identity.permissions.read"),
    async (c) => {
      try {
        const includeInactive = c.req.query("includeInactive") === "true";
        const permissions = await prisma.permission.findMany({
          where: includeInactive ? {} : { active: true },
          orderBy: [{ moduleId: "asc" }, { key: "asc" }],
        });
        const grouped = groupPermissionsForUi(permissions);
        return c.json({
          data: {
            permissions: permissions.map((permission) => {
              const presentation = getPermissionPresentation(permission.key);
              return {
                ...permission,
                name: presentation.name,
                description: presentation.description,
                groupKey: presentation.groupKey,
                groupLabel: presentation.groupLabel,
                sortOrder: presentation.sortOrder,
                isSystem: true,
              };
            }),
            groups: grouped,
          },
        });
      } catch {
        return c.json({ error: "No se pudieron cargar los permisos." }, 500);
      }
    },
  );

  app.get(
    "/identity/roles",
    requirePermission("identity.roles.read"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        // Holders of identity.users.update can already view/edit ANY company's
        // memberships (see docs/superpowers/specs/2026-09-15-identity-module-redesign-design.md
        // §Non-goal 4) — the role picker they use for that (MembershipsSection)
        // needs roles from every company, not just their own active one, or
        // reassigning a membership in another company shows no usable roles.
        const canManageAnyCompany = tenant.isSystemAdmin || tenant.permissionSet?.has("identity.users.update");
        const roles = await prisma.role.findMany({
          // system.admin is a reserved platform role. It's visible to admins
          // (company or system) so they know it exists and can assign it —
          // hidden from everyone else so it never shows up as an assignable
          // option in a non-admin's role picker.
          where: {
            ...(tenant.isAdmin ? {} : { key: { not: "system.admin" } }),
            ...(canManageAnyCompany ? {} : { OR: [{ companyId: null }, { companyId: tenant.companyId }] }),
          },
          include: {
            permissions: {
              select: {
                permission: {
                  select: { id: true, key: true, name: true, moduleId: true },
                },
              },
            },
            _count: { select: { memberships: { where: { enabled: true } } } },
          },
          orderBy: { name: "asc" },
        });
        return c.json({
          data: roles.map((role) => ({
            ...role,
            permissionKeys: role.permissions.map((p) => p.permission.key),
            memberCount: role._count.memberships,
          })),
        });
      } catch {
        return c.json({ error: "No se pudieron cargar los roles." }, 500);
      }
    },
  );

  app.post(
    "/identity/roles",
    requirePermission("identity.roles.create"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        if (!tenant.companyId) {
          return c.json({ error: "Selecciona una empresa activa para crear un rol." }, 400);
        }
        const body = await c.req.json();
        const key = String(body.key ?? "").trim();
        if (ADMIN_ROLE_KEYS.has(key.toLowerCase())) return c.json({ error: "Identificador de rol reservado." }, 403);
        const name = String(body.name ?? "").trim();
        const description = String(body.description ?? "").trim() || null;
        if (!key || !name)
          return c.json({ error: "key y name son obligatorios." }, 400);
        const role = await prisma.role.create({
          data: { key, name, description, system: false, enabled: true, companyId: tenant.companyId },
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.role.create",
          severity: "success",
          entityType: "Role",
          entityId: role.id,
          summary: `${actorName} creó el rol "${role.name}"`,
        });
        return c.json({ data: role }, 201);
      } catch {
        return c.json({ error: "No se pudo crear el rol." }, 500);
      }
    },
  );

  app.put(
    "/identity/roles/:id",
    requirePermission("identity.roles.update"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        const id = c.req.param("id");
        const existing = await loadCompanyEditableRole(id, tenant, prisma);
        if (!existing) return c.json({ error: "Rol no encontrado." }, 404);
        const body = await c.req.json();
        const name = String(body.name ?? "").trim();
        const description = String(body.description ?? "").trim() || null;
        if (!name) return c.json({ error: "name es obligatorio." }, 400);
        const role = await prisma.role.update({
          where: { id },
          data: { name, description },
        });
        cacheDelByPrefix("user_ctx:");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.role.update",
          severity: "info",
          entityType: "Role",
          entityId: id,
          summary: `${actorName} actualizó el rol "${role.name}"`,
        });
        return c.json({ data: role });
      } catch {
        return c.json({ error: "No se pudo actualizar el rol." }, 500);
      }
    },
  );

  app.patch(
    "/identity/roles/:id/enabled",
    requirePermission("identity.roles.update"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        const id = c.req.param("id");
        const existing = await loadCompanyEditableRole(id, tenant, prisma);
        if (!existing) return c.json({ error: "Rol no encontrado." }, 404);
        const body = await c.req.json();
        const enabled = Boolean(body.enabled);
        const role = await prisma.role.update({
          where: { id },
          data: { enabled },
        });
        // Disabled roles are dropped from the effective permission set — bust caches.
        cacheDelByPrefix("user_ctx:");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: role.enabled ? "identity.role.enable" : "identity.role.disable",
          severity: role.enabled ? "info" : "warning",
          entityType: "Role",
          entityId: id,
          summary: `${actorName} ${role.enabled ? "habilitó" : "deshabilitó"} el rol "${role.name}"`,
        });
        return c.json({ data: role });
      } catch {
        return c.json({ error: "No se pudo actualizar el estado del rol." }, 500);
      }
    },
  );

  app.delete(
    "/identity/roles/:id",
    requirePermission("identity.roles.delete"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        const id = c.req.param("id");
        const role = await loadCompanyEditableRole(id, tenant, prisma);
        if (!role) return c.json({ error: "Rol no encontrado." }, 404);
        if (role.system || ADMIN_ROLE_KEYS.has(role.key)) {
          return c.json(
            { error: "No se puede eliminar un rol del sistema." },
            403,
          );
        }
        await prisma.role.delete({ where: { id } });
        cacheDelByPrefix("user_ctx:");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.role.delete",
          severity: "critical",
          entityType: "Role",
          entityId: id,
          summary: `${actorName} eliminó el rol "${role.key}"`,
        });
        return c.json({ ok: true });
      } catch {
        return c.json({ error: "No se pudo eliminar el rol." }, 500);
      }
    },
  );

  app.patch(
    "/identity/roles/:id/permissions",
    requirePermission("identity.permissions.update"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        const id = c.req.param("id");
        const existing = await loadCompanyEditableRole(id, tenant, prisma);
        if (!existing) return c.json({ error: "Rol no encontrado." }, 404);
        const body = await c.req.json();
        const permissionKeys = Array.isArray(body.permissionKeys)
          ? body.permissionKeys
          : [];
        const permissions = await prisma.permission.findMany({
          where: { key: { in: permissionKeys }, active: true },
          select: { id: true },
        });
        await prisma.$transaction([
          prisma.rolePermission.deleteMany({ where: { roleId: id } }),
          ...(permissions.length
            ? [
                prisma.rolePermission.createMany({
                  data: permissions.map((permission) => ({
                    roleId: id,
                    permissionId: permission.id,
                  })),
                }),
              ]
            : []),
        ]);
        // A role's permission set feeds every member's cached user context
        // (permissions + navigation). Bust all user contexts so the change is
        // visible on the members' next request instead of after the 5-min TTL.
        cacheDelByPrefix("user_ctx:");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.role.permissions.update",
          severity: "info",
          entityType: "Role",
          entityId: id,
          summary: `${actorName} actualizó los permisos del rol (${permissions.length})`,
        });
        return c.json({
          data: { roleId: id, permissionCount: permissions.length },
        });
      } catch {
        return c.json(
          { error: "No se pudieron actualizar los permisos del rol." },
          500,
        );
      }
    },
  );

  app.get(
    "/identity/roles/:id/members",
    requirePermission("identity.roles.read"),
    async (c) => {
      try {
        const id = c.req.param("id");
        const tenant = c.get("tenantContext");

        // Same visibility rule as GET /identity/roles (read-only — company-wide
        // and system-wide roles are both listable, unlike the edit-only
        // loadCompanyEditableRole helper the mutation routes use, which would
        // wrongly 404 a system-wide role for a non-system-admin here). Without
        // this, a caller could probe an arbitrary roleId from another company
        // and learn which of ITS users hold it, via the userProfile filter
        // below alone.
        const role = await prisma.role.findUnique({
          where: { id },
          select: { id: true, companyId: true },
        });
        const roleVisible =
          role &&
          (tenant.isSystemAdmin || role.companyId === null || role.companyId === tenant.companyId);
        if (!roleVisible) {
          return c.json({ error: "Rol no encontrado." }, 404);
        }

        const where = {
          roleId: id,
          enabled: true,
          companyId: tenant.companyId,
        };
        const memberships = await prisma.membership.findMany({
          where,
          distinct: ["userId"],
          include: {
            user: { select: { id: true, displayName: true, email: true, avatarFileId: true } },
            company: { select: { name: true } },
          },
          orderBy: { user: { displayName: "asc" } },
        });

        const avatarFileIds = memberships
          .map((m) => m.user?.avatarFileId)
          .filter(Boolean);
        const avatarUrlMap = await buildAvatarUrlMapByFileIds(avatarFileIds, "thumb", { prisma, supabaseAdmin });

        const data = [];
        for (const m of memberships) {
          const user = m.user;
          if (!user) continue;
          data.push({
            id: user.id,
            displayName: user.displayName,
            email: user.email,
            avatarUrl: user.avatarFileId ? (avatarUrlMap.get(user.avatarFileId) ?? null) : null,
            companyName: m.company?.name ?? null,
          });
        }

        return c.json({ data });
      } catch {
        return c.json({ error: "No se pudieron cargar los usuarios del rol." }, 500);
      }
    },
  );

  return app;
}
