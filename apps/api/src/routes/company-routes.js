// apps/api/src/routes/company-routes.js
//
// Company profile/address/branding + company-centric membership management,
// plus POST /companies (creating a brand-new tenant). Extracted from
// index.js on 2026-09-25 to keep that file under the CLAUDE.md 1000-line
// limit, following the same createXxxRouter + mountWithAuth pattern already
// used for ledger/pfm/fleet/catalog/pos/calendar/etc. Mounted via
// mountWithAuth(), which applies authMiddleware globally — route handlers
// here never call it themselves (same convention as calendar-routes.js).
import { Hono } from "hono";
import { createCompanyService, CompanyServiceError } from "../services/company-service.js";
import { createCompanyMemberSchema, updateMembershipSchema } from "@runly/validators";
import { publishActivityFromContext, getActivityContext } from "../services/activity-publisher.js";
import { toSlug, ensureSetupAdminRole } from "../lib/tenant-provisioning.js";

function companyMemberActorContext(c) {
  const tenant = c.get("tenantContext");
  const context = c.get("userContext");
  return {
    isSystemAdmin: tenant.isSystemAdmin,
    canManageRoles: Boolean(tenant.isAdmin || tenant.permissionSet?.has("identity.roles.update")),
    actingUserId: context?.profile?.id ?? null,
  };
}

export function createCompanyRouter({ prisma, supabaseAdmin, requirePermission, cacheDel }) {
  const app = new Hono();
  const companyService = createCompanyService({ prisma, supabaseAdmin });

  // ── Companies: create a new tenant ──────────────────────────────────────────
  // Distinct from /company/profile|address|branding below (which always
  // operate on the REQUESTER'S active company). Gated to any admin of their
  // currently-active company (tenant.isAdmin — runly.admin or system.admin),
  // not system.admin alone: in the common case of a single-company instance,
  // the owner's account is an runly.admin for that one company, never
  // system.admin (that role is seeded separately and often held by nobody in
  // practice) — restricting this to system.admin would make "create a second
  // company" unreachable for the exact person who needs it. Creating a new
  // company never grants access to any OTHER existing company's data, so this
  // is not a cross-tenant privilege — just "can this admin spin up an
  // additional workspace they'll immediately own." Reuses the existing
  // company.profile.create permission (already seeded, already granted to
  // runly.admin/system.admin via the isAdmin-gets-everything path) rather than
  // inventing a new permission key just for this.
  app.post(
    "/companies",
    requirePermission("company.profile.create"),
    async (c) => {
      const tenant = c.get("tenantContext");
      if (!tenant.isAdmin) {
        return c.json(
          { error: "Solo un administrador puede crear nuevas empresas." },
          403,
        );
      }
      try {
        const body = await c.req.json().catch(() => ({}));
        const name = String(body.name ?? "").trim();
        if (!name) {
          return c.json({ error: "El nombre de la empresa es obligatorio." }, 422);
        }

        const baseSlug = toSlug(name) || "empresa";
        let slug = baseSlug;
        let suffix = 1;
        // eslint-disable-next-line no-await-in-loop -- sequential by design: each check depends on the previous candidate being taken
        while (await prisma.company.findUnique({ where: { slug }, select: { id: true } })) {
          suffix += 1;
          slug = `${baseSlug}-${suffix}`;
        }

        const userId = c.get("userId");
        const company = await prisma.$transaction(async (tx) => {
          const adminRole = await ensureSetupAdminRole(tx);
          const created = await tx.company.create({
            data: {
              name,
              slug,
              legalName: String(body.legalName ?? "").trim() || null,
              rfc: String(body.rfc ?? "").trim() || null,
              contactEmail: String(body.contactEmail ?? "").trim() || null,
              phone: String(body.phone ?? "").trim() || null,
              website: String(body.website ?? "").trim() || null,
              country: String(body.country ?? "").trim() || null,
              state: String(body.state ?? "").trim() || null,
              city: String(body.city ?? "").trim() || null,
              street: String(body.street ?? "").trim() || null,
              postalCode: String(body.postalCode ?? "").trim() || null,
            },
          });
          // The creator becomes this company's first admin immediately — no
          // separate invitation step needed to start using it. Uses their
          // EXISTING profile/login; unlike /setup/initialize (which bootstraps
          // the instance's very first company + a brand-new Supabase Auth
          // user), this never touches Supabase Auth at all.
          await tx.membership.create({
            data: { companyId: created.id, userId, roleId: adminRole.id },
          });
          await tx.brandingConfig.create({
            data: {
              companyId: created.id,
              primaryColor: /^#[0-9a-fA-F]{6}$/.test(String(body.primaryColor ?? ""))
                ? body.primaryColor
                : "#0A7BFF",
            },
          });
          return created;
        });

        // Take effect immediately: the creator's memberships list (and hence
        // the CompanySwitcher) must show the new company without waiting for
        // the user-context cache TTL to expire.
        cacheDel(`user_ctx:${c.get("authUserId")}`);

        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "company.create",
          severity: "success",
          entityType: "Company",
          entityId: company.id,
          summary: `${actorName} creó la empresa "${company.name}"`,
        });

        return c.json({ data: company }, 201);
      } catch (err) {
        if (err?.code === "P2002") {
          return c.json({ error: "Ya existe una empresa con datos únicos duplicados." }, 409);
        }
        console.error("[companies/create]", err);
        return c.json({ error: "No se pudo crear la empresa." }, 500);
      }
    },
  );

  // ── Company: Profile ─────────────────────────────────────────────────────────

  app.get(
    "/company/profile",
    requirePermission("company.profile.read"),
    async (c) => {
      try {
        const data = await companyService.getProfile(c.get("companyId"));
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json(
          { error: "No se pudo cargar el perfil de la empresa." },
          500,
        );
      }
    },
  );

  app.put(
    "/company/profile",
    requirePermission("company.profile.update"),
    async (c) => {
      try {
        const body = await c.req.json();
        const name = String(body.name ?? "").trim();
        if (!name)
          return c.json(
            { error: "El nombre de la empresa es obligatorio." },
            400,
          );
        const data = await companyService.updateProfile({
          name,
          legalName: String(body.legalName ?? "").trim(),
          rfc: String(body.rfc ?? "").trim(),
          companyType: String(body.companyType ?? "").trim(),
          companyTypeName: String(body.companyTypeName ?? "").trim(),
          industryKey: String(body.industryKey ?? "").trim(),
          industryName: String(body.industryName ?? "").trim(),
          companySize: String(body.companySize ?? "").trim(),
          contactEmail: String(body.contactEmail ?? "").trim(),
          phone: String(body.phone ?? "").trim(),
          website: String(body.website ?? "").trim(),
        }, c.get("companyId"));
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "company.profile.update",
          severity: "info",
          entityType: "Company",
          summary: `${actorName} actualizó el perfil de la empresa`,
        });
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json(
          { error: "No se pudo actualizar el perfil de la empresa." },
          500,
        );
      }
    },
  );

  // ── Company: Address ─────────────────────────────────────────────────────────

  app.get(
    "/company/address",
    requirePermission("company.address.read"),
    async (c) => {
      try {
        const data = await companyService.getAddress(c.get("companyId"));
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json(
          { error: "No se pudo cargar la direccion de la empresa." },
          500,
        );
      }
    },
  );

  app.put(
    "/company/address",
    requirePermission("company.address.update"),
    async (c) => {
      try {
        const body = await c.req.json();
        const data = await companyService.updateAddress({
          country: String(body.country ?? "").trim(),
          state: String(body.state ?? "").trim(),
          city: String(body.city ?? "").trim(),
          colony: String(body.colony ?? "").trim(),
          street: String(body.street ?? "").trim(),
          extNumber: String(body.extNumber ?? "").trim(),
          intNumber: String(body.intNumber ?? "").trim(),
          postalCode: String(body.postalCode ?? "").trim(),
        }, c.get("companyId"));
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "company.address.update",
          severity: "info",
          entityType: "Company",
          summary: `${actorName} actualizó la dirección de la empresa`,
        });
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json(
          { error: "No se pudo actualizar la direccion de la empresa." },
          500,
        );
      }
    },
  );

  // ── Company: Branding ────────────────────────────────────────────────────────

  app.get(
    "/company/branding",
    requirePermission("company.branding.read"),
    async (c) => {
      try {
        const data = await companyService.getBranding(c.get("companyId"));
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json(
          { error: "No se pudo cargar la configuracion de marca." },
          500,
        );
      }
    },
  );

  app.put(
    "/company/branding",
    requirePermission("company.branding.update"),
    async (c) => {
      try {
        const companyId = c.get("companyId");
        const body = await c.req.json();
        const primaryColor = String(body.primaryColor ?? "").trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor)) {
          return c.json({ error: "primaryColor valido es obligatorio." }, 400);
        }
        const logoFileIdRaw = body.logoFileId;
        const logoFileId =
          logoFileIdRaw === null ||
          logoFileIdRaw === undefined ||
          logoFileIdRaw === ""
            ? null
            : String(logoFileIdRaw).trim();
        const data = await companyService.updateBranding(
          { primaryColor, logoFileId },
          companyId,
        );
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "company.branding.update",
          severity: "info",
          entityType: "Company",
          entityId: companyId,
          summary: `${actorName} actualizó la marca de la empresa`,
        });
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json(
          { error: "No se pudo guardar la configuracion de marca." },
          500,
        );
      }
    },
  );

  // ── Company: Members ─────────────────────────────────────────────────────────
  // Company-centric membership management (the counterpart to
  // /identity/users/:id/memberships*, which manages one user's companies from
  // the other direction). See docs/superpowers/specs/2026-09-20-company-members-design.md.

  app.get(
    "/company/members",
    requirePermission("company.members.read"),
    async (c) => {
      try {
        const data = await companyService.listMembers(c.get("companyId"));
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json({ error: "No se pudieron cargar los miembros de la empresa." }, 500);
      }
    },
  );

  app.get(
    "/company/members/roles",
    requirePermission("company.members.read"),
    async (c) => {
      try {
        const data = await companyService.listMemberRoles(c.get("companyId"));
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json({ error: "No se pudieron cargar los roles." }, 500);
      }
    },
  );

  app.get(
    "/company/members/candidates",
    requirePermission("company.members.manage"),
    async (c) => {
      try {
        const q = c.req.query("q");
        const data = await companyService.searchMemberCandidates(q, c.get("companyId"));
        return c.json({ data });
      } catch (err) {
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json({ error: "No se pudo realizar la busqueda." }, 500);
      }
    },
  );

  app.post(
    "/company/members",
    requirePermission("company.members.manage"),
    async (c) => {
      try {
        const body = await c.req.json();
        const fields = createCompanyMemberSchema.parse(body);
        const data = await companyService.addMember(
          { userId: fields.userId, roleId: fields.roleId, actorContext: companyMemberActorContext(c) },
          c.get("companyId"),
        );
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "company.member.create",
          severity: "success",
          entityType: "Membership",
          entityId: data.membershipId,
          summary: `${actorName} agrego a ${data.displayName || "un usuario"} a la empresa`,
        });
        return c.json({ data });
      } catch (err) {
        if (err?.name === "ZodError") {
          return c.json({ error: err.errors[0]?.message ?? "Datos inválidos." }, 400);
        }
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json({ error: "No se pudo agregar el miembro." }, 500);
      }
    },
  );

  app.patch(
    "/company/members/:membershipId",
    requirePermission("company.members.manage"),
    async (c) => {
      try {
        const membershipId = c.req.param("membershipId");
        const body = await c.req.json();
        const fields = updateMembershipSchema.parse(body);
        const data = await companyService.updateMember(
          membershipId,
          fields,
          c.get("companyId"),
          companyMemberActorContext(c),
        );
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: fields.enabled === false
            ? "company.member.disable"
            : fields.enabled === true
              ? "company.member.enable"
              : "company.member.update",
          severity: "info",
          entityType: "Membership",
          entityId: membershipId,
          summary: `${actorName} actualizo la membresia de ${data.displayName || "un usuario"}`,
        });
        return c.json({ data });
      } catch (err) {
        if (err?.name === "ZodError") {
          return c.json({ error: err.errors[0]?.message ?? "Datos inválidos." }, 400);
        }
        if (err instanceof CompanyServiceError)
          return c.json({ error: err.message }, err.status);
        return c.json({ error: "No se pudo actualizar la membresia." }, 500);
      }
    },
  );

  return app;
}
