// apps/api/src/routes/identity/identity-users-routes.js
//
// User directory: list, candidates picker, detail, companies-options,
// create-and-activate, bulk enable/disable, bulk delete, Excel/PDF export.
// Extracted from index.js on 2026-09-25 to keep index.js under the
// CLAUDE.md 1000-line limit. Mounted via mountWithAuth() (applied by the
// parent identity router) — route handlers here never call authMiddleware
// themselves.
import { Hono } from "hono";
import ExcelJS from "exceljs";
import { createUserSchema } from "@runly/validators";
import { formatLocalDateTime, toLocalIso } from "@runly/core";
import { publishActivityFromContext, getActivityContext } from "../../services/activity-publisher.js";
import { buildUserWelcomeEmail, resolveAppBaseUrl } from "../../services/email-templates.js";
import { createSmtpService } from "../../services/smtp-service.js";
import { createCompanyBrandService } from "../../services/company-brand-service.js";
import { createUserAccessService } from "../../services/user-access-service.js";
import {
  checkMembershipRoleScope,
  checkProtectedRoleAssignment,
} from "../../lib/identity-memberships.js";
import { buildAvatarUrlMapByFileIds } from "../../lib/avatar-url-map.js";
import {
  PROTECTED_IDENTITY_ROLE_KEYS,
  assertUserInCompany,
  buildCompanyLogoUrlMapByFileIds,
  buildIdentityUsersWhere,
  hasProtectedIdentityAdminRole,
  normalizeIdentityUsersQuery,
  parseIdentityUserIds,
  serializeIdentityUser,
  toIdentitySortOrder,
} from "./identity-shared.js";

export function createIdentityUsersRouter({ prisma, supabaseAdmin, requirePermission, cacheDelByPrefix }) {
  const app = new Hono();
  const companyBrandService = createCompanyBrandService({ prisma, supabaseAdmin });

  // Same check, batched: returns only the subset of `ids` that belong to
  // companyId. Used by the bulk endpoints instead of erroring one at a time.
  async function filterUserIdsInCompany(ids, companyId) {
    if (!ids.length || !companyId) return [];
    const rows = await prisma.userProfile.findMany({
      where: { id: { in: ids }, memberships: { some: { companyId } } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  app.get(
    "/identity/users",
    requirePermission("identity.users.read"),
    async (c) => {
      try {
        const normalizedQuery = normalizeIdentityUsersQuery(c.req.query());
        const tenant = c.get("tenantContext");
        const where = buildIdentityUsersWhere({ ...normalizedQuery, companyId: tenant.companyId });
        const orderBy = toIdentitySortOrder(
          normalizedQuery.sortBy,
          normalizedQuery.sortDir,
        );
        const skip = (normalizedQuery.page - 1) * normalizedQuery.pageSize;

        const [users, total] = await prisma.$transaction([
          prisma.userProfile.findMany({
            where,
            include: {
              memberships: {
                include: {
                  role: true,
                  company: true,
                },
                where: { companyId: tenant.companyId },
              },
            },
            orderBy,
            skip,
            take: normalizedQuery.pageSize,
          }),
          prisma.userProfile.count({ where }),
        ]);

        const avatarFileIds = users
          .map((user) => user.avatarFileId)
          .filter(Boolean);
        const avatarUrlMap = await buildAvatarUrlMapByFileIds(avatarFileIds, "thumb", { prisma, supabaseAdmin });

        return c.json({
          data: users.map((user) => serializeIdentityUser(user, avatarUrlMap)),
          pagination: {
            page: normalizedQuery.page,
            pageSize: normalizedQuery.pageSize,
            total,
          },
        });
      } catch {
        return c.json({ error: "No se pudieron cargar los usuarios." }, 500);
      }
    },
  );

  app.get("/identity/users/candidates", requirePermission("profile.self.read"), async (c) => {
    try {
      const data = await createUserAccessService({ prisma }).listCandidates({
        companyId: c.get("tenantContext").companyId,
        actorId: c.get("userContext").profile.id,
        search: c.req.query("search"), limit: c.req.query("pageSize"),
        permission: ({ chat: 'chat.conversations.read', notes: 'notes.notes.read', projects: 'projects.project.read', calendar: 'calendar.calendars.read', growth: 'growth.leads.read', inventory: 'inventory.item.read' })[c.req.query('action')] ?? null,
        projectId: c.req.query('projectId') ?? null,
      });
      const avatars = await buildAvatarUrlMapByFileIds(data.map((u) => u.avatarFileId).filter(Boolean), "thumb", { prisma, supabaseAdmin });
      return c.json({ data: data.map(({ avatarFileId, ...user }) => ({ ...user, avatarUrl: avatars.get(avatarFileId) ?? null })) });
    } catch (err) {
      return c.json({ error: "Recurso no encontrado o no disponible." }, err.status ?? 500);
    }
  });

  app.get(
    "/identity/users/:id",
    requirePermission("identity.users.read"),
    async (c) => {
      try {
        const id = c.req.param("id");
        const tenant = c.get("tenantContext");
        if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
          return c.json({ error: "Usuario no encontrado." }, 404);
        }
        // Intentionally includes disabled memberships too, unlike the list
        // route above (which filters to enabled-only) — membershipsTotal below
        // depends on seeing the full set. Also intentionally NOT scoped to
        // tenant.companyId: per spec non-goal 4, a holder of
        // identity.users.update can already see and manage a user's access to
        // ANY company in the instance via this payload, not just the admin's
        // active one.
        const user = await prisma.userProfile.findUnique({
          where: { id },
          include: {
            memberships: {
              include: { role: true, company: { include: { brandingConfig: true } } },
              orderBy: { createdAt: "asc" },
            },
          },
        });
        if (!user) return c.json({ error: "Usuario no encontrado." }, 404);

        const avatarFileIds = user.avatarFileId ? [user.avatarFileId] : [];
        const logoFileIds = user.memberships
          .map((m) => m.company?.brandingConfig?.logoFileId)
          .filter(Boolean);
        const [avatarUrlMap, companyLogoUrlMap] = await Promise.all([
          buildAvatarUrlMapByFileIds(avatarFileIds, "thumb", { prisma, supabaseAdmin }),
          buildCompanyLogoUrlMapByFileIds(logoFileIds, { prisma, supabaseAdmin }),
        ]);
        const serialized = serializeIdentityUser(user, avatarUrlMap, tenant.isSystemAdmin, companyLogoUrlMap);

        return c.json({
          data: { ...serialized, membershipsTotal: serialized.memberships.length },
        });
      } catch {
        return c.json({ error: "No se pudo cargar el usuario." }, 500);
      }
    },
  );

  app.get(
    "/identity/companies-options",
    requirePermission("identity.users.update"),
    async (c) => {
      try {
        const companies = await prisma.company.findMany({
          where: { enabled: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        });
        return c.json({ data: companies });
      } catch {
        return c.json({ error: "No se pudieron cargar las empresas." }, 500);
      }
    },
  );

  // Direct create-and-activate: the admin provisions the login and grants
  // company access in one step, no accept step for the invited person. Email
  // notification is opt-in (fields.notifyByEmail) — the admin decides whether
  // to share the credentials by email or hand them over directly.
  app.post('/identity/users', requirePermission('identity.users.create'), async (c) => {
    try {
      const fields = createUserSchema.parse(await c.req.json());
      const tenant = c.get('tenantContext');
      const companyId = tenant.companyId;
      if (!companyId) return c.json({ error: 'Selecciona una empresa activa para crear un usuario.' }, 400);
      const email = fields.email.trim().toLowerCase();

      if (fields.roleId) {
        const targetRole = await prisma.role.findFirst({ where: { id: fields.roleId, enabled: true }, select: { key: true, companyId: true } });
        if (!targetRole) return c.json({ error: 'Rol no encontrado.' }, 404);
        const scopeCheck = checkMembershipRoleScope({ roleCompanyId: targetRole.companyId, membershipCompanyId: companyId });
        if (!scopeCheck.ok) return c.json({ error: scopeCheck.error }, scopeCheck.status);
        const protectedCheck = checkProtectedRoleAssignment({
          roleKey: targetRole.key,
          protectedKeys: PROTECTED_IDENTITY_ROLE_KEYS,
          isSystemAdmin: tenant.isSystemAdmin,
          isAdmin: tenant.isAdmin,
          actorCanManageRoles: Boolean(tenant.isAdmin || tenant.permissionSet?.has('identity.roles.update')),
        });
        if (!protectedCheck.ok) return c.json({ error: protectedCheck.error }, protectedCheck.status);
      }

      // Provision a login for a new identity. An existing identity (email
      // already registered elsewhere) keeps its password and personal profile —
      // this just grants it access to this company.
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({ email, password: fields.password, email_confirm: true });
      if (authError && !["email_exists", "user_already_exists"].includes(authError.code)) throw new Error("Provisioning unavailable");

      let profile;
      if (authData?.user?.id) {
        try {
          profile = await prisma.userProfile.create({ data: { authUserId: authData.user.id, firstName: fields.firstName, lastName: fields.lastName,
            displayName: `${fields.firstName} ${fields.lastName}`.trim(), email } });
        } catch (err) {
          await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
          throw err;
        }
      } else {
        profile = await prisma.userProfile.findUnique({ where: { email } });
      }
      if (!profile) throw new Error("No se pudo localizar la identidad del usuario.");

      const existingMembership = await prisma.membership.findUnique({ where: { companyId_userId: { companyId, userId: profile.id } } });
      const membership = existingMembership
        ? await prisma.membership.update({ where: { id: existingMembership.id }, data: { enabled: true, roleId: fields.roleId ?? existingMembership.roleId } })
        : await prisma.membership.create({ data: { companyId, userId: profile.id, roleId: fields.roleId ?? null } });

      cacheDelByPrefix('user_ctx:');
      const { actorName } = getActivityContext(c);
      await publishActivityFromContext(prisma, c, {
        type: 'identity.user.create',
        severity: 'success',
        entityType: 'UserProfile',
        entityId: profile.id,
        summary: `${actorName} creó y activó al usuario ${profile.displayName}`,
      });

      if (fields.notifyByEmail) {
        const baseUrl = resolveAppBaseUrl(process.env);
        if (baseUrl) {
          const loginUrl = `${baseUrl}/app/login`;
          const brand = await companyBrandService.getBrandForCompany(companyId);
          const mail = buildUserWelcomeEmail({ loginUrl, email, brand });
          await createSmtpService({ prisma, companyId }).sendEmail({
            to: email,
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
            fromName: companyBrandService.fromNameFor(brand),
          }).catch(() => {});
        }
      }

      return c.json({ data: { userId: profile.id, membershipId: membership.id, email, enabled: true } }, 201);
    } catch (err) {
      if (err?.name === 'ZodError') return c.json({ error: err.errors[0]?.message ?? 'Datos inválidos.' }, 400);
      return c.json({ error: 'No se pudo crear el usuario con los datos proporcionados.' }, err.status ?? 400);
    }
  });

  app.patch(
    "/identity/users/bulk/enabled",
    requirePermission("identity.users.update"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        const body = await c.req.json();
        const ids = parseIdentityUserIds(body?.ids);
        const enabled = body?.enabled;
        if (!ids.length) {
          return c.json(
            { error: "Debes enviar al menos un usuario valido." },
            400,
          );
        }
        if (typeof enabled !== "boolean") {
          return c.json({ error: "El campo enabled es obligatorio." }, 400);
        }
        const validIds = await filterUserIdsInCompany(ids, tenant.companyId);
        if (validIds.length !== ids.length) {
          return c.json({ error: "Uno o mas usuarios no pertenecen a tu empresa." }, 403);
        }
        if (!enabled && validIds.includes(c.get("userContext").profile.id)) return c.json({ error: "No puedes revocar tu propio acceso." }, 400);
        const result = await prisma.membership.updateMany({
          where: { companyId: tenant.companyId, userId: { in: validIds } },
          data: { enabled },
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: enabled
            ? "identity.user.bulk_enable"
            : "identity.user.bulk_disable",
          severity: enabled ? "info" : "warning",
          entityType: "UserProfile",
          summary: `${actorName} ${enabled ? "habilitó" : "deshabilitó"} ${result.count} usuario(s)`,
        });
        return c.json({ data: { count: result.count, enabled } });
      } catch {
        return c.json(
          { error: "No se pudo actualizar el estado de los usuarios." },
          500,
        );
      }
    },
  );

  app.delete(
    "/identity/users/bulk",
    requirePermission("identity.users.delete"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        const body = await c.req.json();
        const ids = parseIdentityUserIds(body?.ids);
        if (!ids.length) {
          return c.json(
            { error: "Debes enviar al menos un usuario valido." },
            400,
          );
        }

        const context = c.get("userContext");
        if (ids.includes(context?.profile?.id)) {
          return c.json({ error: "No puedes eliminar tu propia cuenta." }, 400);
        }

        const validIds = await filterUserIdsInCompany(ids, tenant.companyId);
        if (validIds.length !== ids.length) {
          return c.json({ error: "Uno o mas usuarios no pertenecen a tu empresa." }, 403);
        }

        const users = await prisma.userProfile.findMany({
          where: { id: { in: validIds } },
          select: {
            id: true,
            authUserId: true,
            memberships: {
              where: { companyId: tenant.companyId },
              select: {
                enabled: true,
                role: { select: { key: true } },
              },
            },
          },
        });
        if (!users.length) {
          return c.json({ data: { count: 0 } });
        }
        if (users.some(hasProtectedIdentityAdminRole)) {
          return c.json(
            {
              error:
                "No se pueden eliminar usuarios con rol Runly Admin o System Admin.",
            },
            400,
          );
        }

        const deleted = await prisma.membership.updateMany({
          where: { companyId: tenant.companyId, userId: { in: validIds } },
          data: { enabled: false },
        });
        cacheDelByPrefix("user_ctx:");

        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.user.bulk_delete",
          severity: "critical",
          entityType: "UserProfile",
          summary: `${actorName} eliminó ${deleted.count} usuario(s)`,
        });

        return c.json({ data: { count: deleted.count } });
      } catch {
        return c.json({ error: "No se pudieron eliminar los usuarios." }, 500);
      }
    },
  );

  app.post(
    "/identity/users/export/excel",
    requirePermission("identity.users.read"),
    async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}));
        const ids = parseIdentityUserIds(body?.ids);
        const normalizedQuery = normalizeIdentityUsersQuery(c.req.query());
        const tenant = c.get("tenantContext");
        const where = buildIdentityUsersWhere({ ...normalizedQuery, companyId: tenant.companyId });
        if (ids.length) where.id = { in: ids };

        const users = await prisma.userProfile.findMany({
          where,
          include: {
            memberships: {
              include: { role: true, company: true },
              where: { companyId: tenant.companyId },
            },
          },
          orderBy: toIdentitySortOrder(
            normalizedQuery.sortBy,
            normalizedQuery.sortDir,
          ),
        });

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Usuarios");
        sheet.columns = [
          { header: "ID", key: "id", width: 40 },
          { header: "Nombre", key: "firstName", width: 20 },
          { header: "Apellidos", key: "lastName", width: 24 },
          { header: "Nombre completo", key: "displayName", width: 30 },
          { header: "Correo", key: "email", width: 32 },
          { header: "Rol", key: "roleName", width: 24 },
          { header: "Empresa", key: "companyName", width: 28 },
          { header: "Estado", key: "enabled", width: 12 },
          { header: "Creado", key: "createdAt", width: 20 },
        ];
        sheet.getRow(1).font = { bold: true };

        for (const user of users) {
          const membership = user.memberships?.[0] ?? null;
          sheet.addRow({
            id: user.id,
            firstName: user.firstName ?? "",
            lastName: user.lastName ?? "",
            displayName: user.displayName ?? "",
            email: user.email ?? "",
            roleName: membership?.role?.name ?? "",
            companyName: membership?.company?.name ?? "",
            enabled: user.enabled && membership?.enabled ? "Activo" : "Inactivo",
            createdAt: user.createdAt
              ? formatLocalDateTime(user.createdAt)
              : "",
          });
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const filename = `usuarios-${toLocalIso()}.xlsx`;
        c.header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        c.header("X-Atlas-Export-Count", String(users.length));
        return c.body(buffer);
      } catch {
        return c.json({ error: "No se pudo generar el archivo Excel." }, 500);
      }
    },
  );

  app.post(
    "/identity/users/export/pdf",
    requirePermission("identity.users.read"),
    async (c) => {
      try {
        const body = await c.req.json().catch(() => ({}));
        const ids = parseIdentityUserIds(body?.ids);
        const normalizedQuery = normalizeIdentityUsersQuery(c.req.query());
        const tenant = c.get("tenantContext");
        const where = buildIdentityUsersWhere({ ...normalizedQuery, companyId: tenant.companyId });
        if (ids.length) where.id = { in: ids };

        const users = await prisma.userProfile.findMany({
          where,
          include: {
            memberships: {
              include: { role: true, company: true },
              where: { companyId: tenant.companyId },
            },
          },
          orderBy: toIdentitySortOrder(normalizedQuery.sortBy, normalizedQuery.sortDir),
        });

        const companyId = tenant.companyId;

        const { resolvePdfDocumentCtor, resolveCompanyBranding, drawPdfHeader, drawPdfFooter, formatDateEs, toSafeText } =
          await import("../../services/pdf-branding-service.js");
        const PDFDocument = await resolvePdfDocumentCtor();
        const branding = await resolveCompanyBranding({ prisma, companyId });

        const doc = new PDFDocument({ margin: 40, size: "A4", bufferPages: true });
        const chunks = [];
        doc.on("data", (c) => chunks.push(c));

        const HEADER_H = 90;
        const FOOTER_H = 36;
        const pageW = doc.page.width;
        const pageH = doc.page.height;
        const bodyTop = 40 + HEADER_H + 10;
        const bodyBottom = pageH - 40 - FOOTER_H - 10;

        function drawTableHeader(y) {
          doc.rect(40, y, pageW - 80, 20).fill(branding.primaryColor || "#2563eb");
          doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold");
          doc.text("Nombre completo", 48, y + 6, { width: 130 });
          doc.text("Correo", 184, y + 6, { width: 130 });
          doc.text("Rol", 320, y + 6, { width: 90 });
          doc.text("Estado", 416, y + 6, { width: 55 });
          doc.text("Ingreso", 476, y + 6, { width: 80 });
          doc.fillColor("#000000").font("Helvetica");
          return y + 20;
        }

        let page = 0;
        let y = bodyTop;

        drawPdfHeader(doc, branding, { title: "Directorio de usuarios", subtitle: `${users.length} registro${users.length !== 1 ? "s" : ""}`, folio: `RPT-USR-${new Date().getFullYear()}` });
        y = drawTableHeader(y);

        for (let i = 0; i < users.length; i++) {
          const u = users[i];
          const m = u.memberships?.[0] ?? null;
          const rowH = 18;

          if (y + rowH > bodyBottom) {
            drawPdfFooter(doc, branding, { pageNum: ++page });
            doc.addPage();
            drawPdfHeader(doc, branding, { title: "Directorio de usuarios", subtitle: `${users.length} registro${users.length !== 1 ? "s" : ""}`, folio: `RPT-USR-${new Date().getFullYear()}` });
            y = bodyTop;
            y = drawTableHeader(y);
          }

          const bg = i % 2 === 0 ? "#ffffff" : "#f8f9fb";
          doc.rect(40, y, pageW - 80, rowH).fill(bg);
          doc.fillColor("#1a1a1a").fontSize(8).font("Helvetica");
          doc.text(toSafeText(u.displayName || `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()), 48, y + 5, { width: 130, ellipsis: true });
          doc.text(toSafeText(u.email ?? ""), 184, y + 5, { width: 130, ellipsis: true });
          doc.text(toSafeText(m?.role?.name ?? "—"), 320, y + 5, { width: 90, ellipsis: true });
          doc.text(u.enabled ? "Activo" : "Inactivo", 416, y + 5, { width: 55 });
          doc.text(u.createdAt ? formatDateEs(u.createdAt) : "—", 476, y + 5, { width: 80 });
          y += rowH;
        }

        drawPdfFooter(doc, branding, { pageNum: ++page });
        doc.end();

        const buffer = await new Promise((resolve, reject) => {
          doc.on("end", () => resolve(Buffer.concat(chunks)));
          doc.on("error", reject);
        });

        const filename = `usuarios-${toLocalIso()}.pdf`;
        c.header("Content-Type", "application/pdf");
        c.header("Content-Disposition", `attachment; filename="${filename}"`);
        c.header("X-Atlas-Export-Count", String(users.length));
        return c.body(buffer);
      } catch (err) {
        console.error("[identity/export/pdf]", err);
        return c.json({ error: "No se pudo generar el PDF." }, 500);
      }
    },
  );

  return app;
}
