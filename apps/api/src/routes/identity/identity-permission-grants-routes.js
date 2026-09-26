// apps/api/src/routes/identity/identity-permission-grants-routes.js
//
// Per-user permission grants (ALLOW-only, additive). Effective permissions =
// role permissions ∪ these grants. Never subtracts. Spec:
// docs/superpowers/specs/2026-09-08-per-user-permission-grants.md. Extracted
// from index.js on 2026-09-25 to keep index.js under the CLAUDE.md
// 1000-line limit. Unlike the other identity route files, these two routes
// don't go through requirePermission()/mountWithAuth's authMiddleware in the
// same shape — they call getUserContext/resolveTenantContext directly
// (same as the pre-extraction index.js did), because canManageUserGrants()
// is a custom two-permission check, not a single permission key.
import { Hono } from "hono";
import {
  filterGrantableKeys,
  findEscalatingKeys,
  diffGrantKeys,
} from "../../lib/permission-grants.js";
import { publishActivityFromContext, getActivityContext } from "../../services/activity-publisher.js";
import { assertUserInCompany } from "./identity-shared.js";

function canManageUserGrants(context) {
  if (!context) return false;
  if (context.isAdmin) return true;
  return Boolean(
    context.permissionSet?.has("identity.permissions.update") &&
    context.permissionSet?.has("identity.users.update"),
  );
}

// Resolves the target user's membership in ONE specific company (the actor's
// server-resolved active company — never derived from the target's own "most
// admin-like" membership, which could be a DIFFERENT company than the one the
// actor is currently acting in) and the set of permission keys the target
// already inherits from their role in that company.
async function loadUserGrantContext(userId, companyId, prisma) {
  const target = await prisma.userProfile.findUnique({
    where: { id: userId },
    include: {
      memberships: {
        where: { enabled: true, companyId },
        include: {
          role: {
            include: {
              permissions: {
                where: { permission: { active: true } },
                include: { permission: { select: { key: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (!target) return null;
  const activeMs = target.memberships.filter((m) => m.role?.enabled);
  const roleKeys = new Set();
  for (const m of activeMs) {
    for (const rp of m.role?.permissions ?? []) {
      if (rp.permission?.key) roleKeys.add(rp.permission.key);
    }
  }
  return { target, companyId, roleKeys };
}

export function createIdentityPermissionGrantsRouter({ prisma, getUserContext, resolveTenantContext, cacheDel }) {
  const app = new Hono();

  app.get("/identity/users/:id/permission-grants", async (c) => {
    try {
      const context = await getUserContext(c);
      const resolved = await resolveTenantContext(c, context, { strict: true });
      if (!resolved.ok) return resolved.response;
      const { tenant } = resolved;
      if (!canManageUserGrants(tenant)) {
        return c.json({ error: "No autorizado." }, 403);
      }
      const id = c.req.param("id");
      if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }
      const grantCtx = await loadUserGrantContext(id, tenant.companyId, prisma);
      if (!grantCtx) return c.json({ error: "Usuario no encontrado." }, 404);

      const grants = await prisma.userPermissionGrant.findMany({
        where: { userId: id, companyId: tenant.companyId },
        include: { permission: { select: { key: true, active: true } } },
      });
      const grantedKeys = grants
        .map((g) => g.permission?.key)
        .filter(Boolean)
        .sort();

      return c.json({
        data: { grantedKeys, roleKeys: [...grantCtx.roleKeys].sort() },
      });
    } catch (err) {
      console.error("[identity] get permission-grants", err?.message ?? err);
      return c.json({ error: "No se pudieron cargar los permisos." }, 500);
    }
  });

  app.put("/identity/users/:id/permission-grants", async (c) => {
    try {
      const context = await getUserContext(c);
      const resolved = await resolveTenantContext(c, context, { strict: true });
      if (!resolved.ok) return resolved.response;
      const { tenant } = resolved;
      if (!canManageUserGrants(tenant)) {
        return c.json({ error: "No autorizado." }, 403);
      }
      const id = c.req.param("id");
      const body = await c.req.json().catch(() => ({}));
      const requested = Array.isArray(body?.permissionKeys)
        ? [...new Set(body.permissionKeys.filter((k) => typeof k === "string" && k))]
        : null;
      if (!requested) {
        return c.json({ error: "permissionKeys debe ser un arreglo." }, 422);
      }

      if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
        return c.json({ error: "Usuario no encontrado." }, 404);
      }
      const grantCtx = await loadUserGrantContext(id, tenant.companyId, prisma);
      if (!grantCtx) return c.json({ error: "Usuario no encontrado." }, 404);

      // Only active permissions can be granted.
      const activePerms = await prisma.permission.findMany({
        where: { key: { in: requested }, active: true },
        select: { id: true, key: true },
      });
      const targetKeys = filterGrantableKeys({
        requestedKeys: requested,
        activeKeys: activePerms.map((p) => p.key),
        roleKeys: grantCtx.roleKeys,
      });

      // Privilege-escalation guard: a non-admin manager can only hand out
      // permissions they themselves already hold IN THIS SAME ACTIVE COMPANY.
      // Admins are unrestricted.
      const escalating = findEscalatingKeys({
        targetKeys,
        actorHeldKeys: tenant.permissionSet ?? new Set(),
        actorIsAdmin: tenant.isAdmin,
      });
      if (escalating.length) {
        return c.json(
          {
            error:
              "Solo puedes conceder permisos que tu propia cuenta ya tiene: " +
              escalating.join(", "),
          },
          403,
        );
      }

      const permByKey = new Map(activePerms.map((p) => [p.key, p.id]));
      const existing = await prisma.userPermissionGrant.findMany({
        where: { userId: id, companyId: grantCtx.companyId },
        include: { permission: { select: { key: true } } },
      });
      const existingKeys = existing.map((g) => g.permission?.key).filter(Boolean);
      const nextKeys = new Set(targetKeys);
      const { added, removed } = diffGrantKeys({ existingKeys, nextKeys });

      if (added.length || removed.length) {
        await prisma.$transaction([
          prisma.userPermissionGrant.deleteMany({
            where: { userId: id, companyId: grantCtx.companyId },
          }),
          prisma.userPermissionGrant.createMany({
            data: targetKeys.map((k) => ({
              userId: id,
              companyId: grantCtx.companyId,
              permissionId: permByKey.get(k),
              grantedById: context.profile?.id ?? null,
            })),
            skipDuplicates: true,
          }),
        ]);

        // Take effect immediately rather than after the user-context TTL.
        cacheDel(`user_ctx:${grantCtx.target.authUserId}`);

        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.user.permission_grants.update",
          severity: "warning",
          entityType: "UserProfile",
          entityId: id,
          summary:
            `${actorName} actualizó los permisos individuales de ${grantCtx.target.email ?? id}` +
            (added.length ? ` (+${added.join(", ")})` : "") +
            (removed.length ? ` (-${removed.join(", ")})` : ""),
        });
      }

      return c.json({ data: { grantedKeys: [...nextKeys].sort() } });
    } catch (err) {
      console.error("[identity] put permission-grants", err?.message ?? err);
      return c.json({ error: "No se pudieron guardar los permisos." }, 500);
    }
  });

  return app;
}
