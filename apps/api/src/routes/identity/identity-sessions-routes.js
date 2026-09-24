import { Hono } from "hono";
import { get as cacheGet, set as cacheSet } from "../../lib/cache.js";

// Short cache so rapid repeated opens of the same user's detail screen (e.g.
// pagination back-and-forth) don't re-hit the Supabase Admin API on every
// render. Spec: docs/superpowers/specs/2026-09-23-identity-user-sessions-design.md
const SESSION_INFO_TTL_SECONDS = 60;

function mapSupabaseUser(user) {
  return {
    lastSignInAt: user.last_sign_in_at ?? null,
    createdAt: user.created_at ?? null,
    emailConfirmedAt: user.email_confirmed_at ?? null,
    phoneConfirmedAt: user.phone_confirmed_at ?? null,
    bannedUntil: user.banned_until ?? null,
    providers:
      user.app_metadata?.providers ??
      (user.app_metadata?.provider ? [user.app_metadata.provider] : []),
  };
}

export function createIdentitySessionsRouter({ prisma, supabaseAdmin, authMiddleware, requirePermission }) {
  const app = new Hono();

  app.get(
    "/identity/users/:id/session",
    authMiddleware,
    requirePermission("identity.users.sessions.read"),
    async (c) => {
      const id = c.req.param("id");
      const tenant = c.get("tenantContext");

      const visible = await prisma.userProfile.findFirst({
        where: { id, memberships: { some: { companyId: tenant.companyId } } },
        select: { id: true, authUserId: true },
      });
      if (!visible) return c.json({ error: "Usuario no encontrado." }, 404);

      if (!supabaseAdmin || !visible.authUserId) return c.json({ data: null });

      const cacheKey = `identity:session:${visible.authUserId}`;
      const cached = cacheGet(cacheKey);
      if (cached !== undefined) return c.json({ data: cached });

      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(visible.authUserId);
        if (error || !data?.user) {
          cacheSet(cacheKey, null, SESSION_INFO_TTL_SECONDS);
          return c.json({ data: null });
        }
        const mapped = mapSupabaseUser(data.user);
        cacheSet(cacheKey, mapped, SESSION_INFO_TTL_SECONDS);
        return c.json({ data: mapped });
      } catch {
        return c.json({ data: null });
      }
    },
  );

  return app;
}
