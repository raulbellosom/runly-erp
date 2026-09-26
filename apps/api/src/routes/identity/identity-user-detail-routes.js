// apps/api/src/routes/identity/identity-user-detail-routes.js
//
// Single-user mutations: memberships (assign/reassign a company + role),
// avatar upload, delete, admin-set password, send-password-reset, and the
// general PATCH /identity/users/:id (personal fields + membership role
// reassignment). Extracted from index.js on 2026-09-25 to keep index.js
// under the CLAUDE.md 1000-line limit. This file carries the
// privilege-escalation guards described inline below — moved verbatim, not
// rewritten, from the pre-extraction index.js. Mounted via mountWithAuth()
// (applied by the parent identity router) — route handlers here never call
// authMiddleware themselves.
import { Hono } from "hono";
import { createMembershipSchema, updateMembershipSchema } from "@runly/validators";
import { publishActivityFromContext, getActivityContext } from "../../services/activity-publisher.js";
import { createSmtpService } from "../../services/smtp-service.js";
import {
  checkMembershipRoleScope,
  checkProtectedRoleAssignment,
  checkSelfLockout,
  findExistingMembership,
} from "../../lib/identity-memberships.js";
import { uploadIdentityAvatar } from "../../lib/upload-identity-avatar.js";
import { getSignedUrlByFileId } from "../../lib/signed-url-by-file-id.js";
import { sendPasswordResetEmail } from "../../lib/send-password-reset-email.js";
import { isForgotPasswordRateLimited } from "../../lib/forgot-password-rate-limit.js";
import { createCompanyBrandService } from "../../services/company-brand-service.js";
import {
  PROTECTED_IDENTITY_ROLE_KEYS,
  assertUserInCompany,
  hasProtectedIdentityAdminRole,
} from "./identity-shared.js";

export function createIdentityUserDetailRouter({ prisma, supabaseAdmin, requirePermission, cacheDel, cacheDelByPrefix, storageBucketName }) {
  const app = new Hono();
  const companyBrandService = createCompanyBrandService({ prisma, supabaseAdmin });

  app.patch(
    "/identity/users/:id/memberships/:membershipId",
    requirePermission("identity.users.update"),
    async (c) => {
      try {
        const id = c.req.param("id");
        const membershipId = c.req.param("membershipId");
        const tenant = c.get("tenantContext");
        const context = c.get("userContext");
        if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
          return c.json({ error: "Usuario no encontrado." }, 404);
        }

        const body = await c.req.json();
        const fields = updateMembershipSchema.parse(body);

        const membership = await prisma.membership.findUnique({
          where: { id: membershipId },
          include: { role: { select: { key: true } } },
        });
        if (!membership || membership.userId !== id) {
          return c.json({ error: "La membresia no corresponde a este usuario." }, 400);
        }

        if (fields.roleId !== undefined && fields.roleId !== null) {
          const targetRole = await prisma.role.findUnique({
            where: { id: fields.roleId },
            select: { key: true, companyId: true },
          });
          if (!targetRole) return c.json({ error: "Rol no encontrado." }, 404);

          const scopeCheck = checkMembershipRoleScope({
            roleCompanyId: targetRole.companyId,
            membershipCompanyId: membership.companyId,
          });
          if (!scopeCheck.ok) return c.json({ error: scopeCheck.error }, scopeCheck.status);

          const protectedCheck = checkProtectedRoleAssignment({
            roleKey: targetRole.key,
            protectedKeys: PROTECTED_IDENTITY_ROLE_KEYS,
            isSystemAdmin: tenant.isSystemAdmin,
            isAdmin: tenant.isAdmin,
            actorCanManageRoles: Boolean(
              tenant.isAdmin || tenant.permissionSet?.has("identity.roles.update"),
            ),
          });
          if (!protectedCheck.ok) return c.json({ error: protectedCheck.error }, protectedCheck.status);
        }

        if (fields.enabled === false) {
          const enabledMemberships = await prisma.membership.findMany({
            where: { userId: id, enabled: true },
            select: { id: true },
          });
          const lockoutCheck = checkSelfLockout({
            isActingOnSelf: id === context?.profile?.id,
            enabledMembershipIds: enabledMemberships.map((m) => m.id),
            membershipId,
            disabling: true,
          });
          if (!lockoutCheck.ok) return c.json({ error: lockoutCheck.error }, lockoutCheck.status);
        }

        const before = { roleId: membership.roleId, enabled: membership.enabled };
        const updated = await prisma.membership.update({
          where: { id: membershipId },
          data: {
            ...(fields.roleId !== undefined ? { roleId: fields.roleId } : {}),
            ...(fields.enabled !== undefined ? { enabled: fields.enabled } : {}),
          },
          include: { role: true, company: true },
        });

        cacheDelByPrefix("user_ctx:");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.membership.update",
          severity: "info",
          entityType: "Membership",
          entityId: membershipId,
          summary: `${actorName} actualizo la membresia de ${updated.company?.name ?? "una empresa"}`,
        });

        return c.json({
          data: {
            id: updated.id,
            companyId: updated.companyId,
            companyName: updated.company?.name ?? null,
            roleId: updated.roleId,
            roleKey: updated.role?.key ?? null,
            roleName: updated.role?.name ?? null,
            enabled: updated.enabled,
          },
          before,
        });
      } catch (err) {
        if (err?.name === "ZodError") {
          return c.json({ error: err.errors[0]?.message ?? "Datos inválidos." }, 400);
        }
        return c.json({ error: "No se pudo actualizar la membresia." }, 500);
      }
    },
  );

  app.post(
    "/identity/users/:id/memberships",
    requirePermission("identity.users.update"),
    async (c) => {
      try {
        const id = c.req.param("id");
        const tenant = c.get("tenantContext");
        if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
          return c.json({ error: "Usuario no encontrado." }, 404);
        }

        const body = await c.req.json();
        const fields = createMembershipSchema.parse(body);

        const company = await prisma.company.findUnique({
          where: { id: fields.companyId },
          select: { id: true },
        });
        if (!company) return c.json({ error: "Empresa no encontrada." }, 404);

        let targetRole = null;
        if (fields.roleId !== undefined && fields.roleId !== null) {
          targetRole = await prisma.role.findUnique({
            where: { id: fields.roleId },
            select: { key: true, companyId: true },
          });
          if (!targetRole) return c.json({ error: "Rol no encontrado." }, 404);

          const scopeCheck = checkMembershipRoleScope({
            roleCompanyId: targetRole.companyId,
            membershipCompanyId: fields.companyId,
          });
          if (!scopeCheck.ok) return c.json({ error: scopeCheck.error }, scopeCheck.status);

          const protectedCheck = checkProtectedRoleAssignment({
            roleKey: targetRole.key,
            protectedKeys: PROTECTED_IDENTITY_ROLE_KEYS,
            isSystemAdmin: tenant.isSystemAdmin,
            isAdmin: tenant.isAdmin,
            actorCanManageRoles: Boolean(
              tenant.isAdmin || tenant.permissionSet?.has("identity.roles.update"),
            ),
          });
          if (!protectedCheck.ok) return c.json({ error: protectedCheck.error }, protectedCheck.status);
        }

        const existingMemberships = await prisma.membership.findMany({
          where: { userId: id, companyId: fields.companyId },
        });
        const existing = findExistingMembership({
          memberships: existingMemberships,
          companyId: fields.companyId,
        });

        if (existing?.enabled) {
          return c.json({ error: "El usuario ya tiene acceso a esta empresa." }, 400);
        }

        const membership = existing
          ? await prisma.membership.update({
              where: { id: existing.id },
              data: {
                enabled: true,
                roleId: fields.roleId !== undefined ? fields.roleId : existing.roleId,
              },
              include: { role: true, company: true },
            })
          : await prisma.membership.create({
              data: { userId: id, companyId: fields.companyId, roleId: fields.roleId ?? null },
              include: { role: true, company: true },
            });

        cacheDelByPrefix("user_ctx:");
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.membership.create",
          severity: "success",
          entityType: "Membership",
          entityId: membership.id,
          summary: `${actorName} asigno a ${membership.company?.name ?? "una empresa"} al usuario`,
        });

        return c.json(
          {
            data: {
              id: membership.id,
              companyId: membership.companyId,
              companyName: membership.company?.name ?? null,
              roleId: membership.roleId,
              roleKey: membership.role?.key ?? null,
              roleName: membership.role?.name ?? null,
              enabled: membership.enabled,
            },
          },
          existing ? 200 : 201,
        );
      } catch (err) {
        if (err?.name === "ZodError") {
          return c.json({ error: err.errors[0]?.message ?? "Datos inválidos." }, 400);
        }
        return c.json({ error: "No se pudo asignar la empresa." }, 500);
      }
    },
  );

  app.post(
    "/identity/users/:id/avatar",
    requirePermission("identity.users.update"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        const id = c.req.param("id");
        if (!tenant.isSystemAdmin && id !== c.get("userContext").profile.id) return c.json({ error: "El avatar solo puede modificarlo su titular." }, 403);
        const target = await prisma.userProfile.findFirst({
          where: { id, memberships: { some: { enabled: true, companyId: tenant.companyId } } },
          select: { id: true, authUserId: true },
        });
        if (!target) return c.json({ error: "Usuario no encontrado." }, 404);

        const body = await c.req.parseBody();
        const file = body.avatar;
        if (!(file instanceof File) || file.size <= 0) {
          return c.json({ error: "Selecciona una imagen valida." }, 400);
        }
        if (file.size > 10 * 1024 * 1024) {
          return c.json({ error: "La imagen no puede superar 10 MB." }, 400);
        }
        if (!file.type.startsWith("image/")) {
          return c.json({ error: "Solo se permiten imagenes." }, 400);
        }

        const asset = await uploadIdentityAvatar({ profileId: target.id, file, prisma, supabaseAdmin, bucket: storageBucketName });
        cacheDel(`user_ctx:${target.authUserId}`);
        const avatarUrl = await getSignedUrlByFileId(asset.id, "card", { prisma, supabaseAdmin });
        return c.json({ data: { avatarUrl, avatarFileId: asset.id } });
      } catch {
        return c.json(
          { error: "No se pudo actualizar el avatar del usuario." },
          500,
        );
      }
    },
  );

  app.get(
    "/identity/users/:id/avatar/signed-url",
    requirePermission("identity.users.read"),
    async (c) => {
      try {
        const tenant = c.get("tenantContext");
        const id = c.req.param("id");
        const target = await prisma.userProfile.findFirst({
          where: { id, memberships: { some: { enabled: true, companyId: tenant.companyId } } },
          select: { avatarFileId: true },
        });
        if (!target) return c.json({ error: "Usuario no encontrado." }, 404);
        const variant = c.req.query("variant") || "full";
        const signedUrl = await getSignedUrlByFileId(target.avatarFileId, variant, { prisma, supabaseAdmin });
        return c.json({ data: { signedUrl } });
      } catch {
        return c.json(
          { error: "No se pudo generar el enlace del avatar." },
          500,
        );
      }
    },
  );

  app.delete(
    "/identity/users/:id",
    requirePermission("identity.users.delete"),
    async (c) => {
      try {
        const id = c.req.param("id");
        const context = c.get("userContext");
        const tenant = c.get("tenantContext");

        if (id === context.profile.id) {
          return c.json({ error: "No puedes eliminar tu propia cuenta." }, 400);
        }
        if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
          return c.json({ error: "Usuario no encontrado." }, 404);
        }

        const targetUser = await prisma.userProfile.findUnique({
          where: { id },
          include: {
            memberships: {
              where: { companyId: tenant.companyId },
              include: { role: { select: { key: true } } },
            },
          },
        });
        if (!targetUser) {
          return c.json({ error: "Usuario no encontrado." }, 404);
        }
        if (hasProtectedIdentityAdminRole(targetUser)) {
          return c.json(
            {
              error:
                "No se puede eliminar un usuario con rol Runly Admin o System Admin.",
            },
            400,
          );
        }

        await prisma.membership.updateMany({ where: { companyId: tenant.companyId, userId: id }, data: { enabled: false } });
        cacheDelByPrefix("user_ctx:");

        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.user.delete",
          severity: "critical",
          entityType: "UserProfile",
          entityId: id,
          summary: `${actorName} eliminó al usuario ${targetUser.email ?? id}`,
        });

        return c.json({ ok: true });
      } catch {
        return c.json({ error: "No se pudo eliminar el usuario." }, 500);
      }
    },
  );

  // Sysadmin-only: set another user's password directly, no email round-trip.
  // Kept separate from identity.users.update's PATCH so a regular company
  // admin (who also holds that permission) can't set passwords for users
  // outside their reach — only a true system admin gets this shortcut; anyone
  // else must use POST .../send-password-reset below.
  app.patch(
    "/identity/users/:id/password",
    requirePermission("identity.users.update"),
    async (c) => {
      try {
        const id = c.req.param("id");
        const tenant = c.get("tenantContext");
        if (!tenant.isSystemAdmin) {
          return c.json(
            { error: "Solo un administrador del sistema puede cambiar la contraseña de otro usuario." },
            403,
          );
        }
        if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
          return c.json({ error: "Usuario no encontrado." }, 404);
        }
        const body = await c.req.json();
        const newPassword = String(body?.password ?? "");
        if (newPassword.length < 8) {
          return c.json({ error: "La contraseña debe tener al menos 8 caracteres." }, 400);
        }

        const targetUser = await prisma.userProfile.findUnique({
          where: { id },
          select: { authUserId: true, email: true },
        });
        if (!targetUser) return c.json({ error: "Usuario no encontrado." }, 404);

        const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
          targetUser.authUserId,
          { password: newPassword },
        );
        if (updateError) {
          return c.json({ error: "No se pudo actualizar la contraseña." }, 500);
        }

        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.user.password_changed_by_admin",
          severity: "critical",
          entityType: "UserProfile",
          entityId: id,
          summary: `${actorName} cambió la contraseña de ${targetUser.email ?? id}`,
        });

        return c.json({ data: { ok: true } });
      } catch {
        return c.json({ error: "No se pudo actualizar la contraseña." }, 500);
      }
    },
  );

  // Any holder of identity.users.update (not just sysadmin) can send a target
  // user a branded reset-password email — same mechanism as the public
  // forgot-password flow, just triggered on someone else's behalf.
  app.post(
    "/identity/users/:id/send-password-reset",
    requirePermission("identity.users.update"),
    async (c) => {
      try {
        const id = c.req.param("id");
        const tenant = c.get("tenantContext");
        if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
          return c.json({ error: "Usuario no encontrado." }, 404);
        }
        const targetUser = await prisma.userProfile.findUnique({
          where: { id },
          select: { email: true },
        });
        if (!targetUser?.email) return c.json({ error: "Usuario no encontrado." }, 404);

        if (isForgotPasswordRateLimited(targetUser.email.toLowerCase())) {
          return c.json(
            { error: "Ya se envió un enlace recientemente. Espera unos minutos." },
            429,
          );
        }

        // This action is admin-initiated against a user the admin already
        // picked — unlike the public forgot-password endpoint, there's no
        // enumeration risk in telling the truth here, so surface a real error
        // instead of a swallowed generic success when SMTP isn't usable.
        const smtpStatus = await createSmtpService({ prisma }).getStatus();
        if (!smtpStatus.configured) {
          return c.json(
            {
              error:
                smtpStatus.message ||
                "El SMTP no está configurado. Ve a Ajustes → SMTP o define SMTP_HOST/SMTP_USER en el servidor.",
            },
            400,
          );
        }

        await sendPasswordResetEmail(targetUser.email, { requestedByAdmin: true, prisma, supabaseAdmin, companyBrandService });

        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.user.password_reset_sent",
          severity: "info",
          entityType: "UserProfile",
          entityId: id,
          summary: `${actorName} envió un enlace de restablecimiento de contraseña a ${targetUser.email}`,
        });

        return c.json({ data: { ok: true } });
      } catch {
        return c.json({ error: "No se pudo enviar el enlace de restablecimiento." }, 500);
      }
    },
  );

  app.patch(
    "/identity/users/:id",
    requirePermission("identity.users.update"),
    async (c) => {
      try {
        const id = c.req.param("id");
        const tenant = c.get("tenantContext");
        if (!(await assertUserInCompany(id, tenant.companyId, { prisma }))) {
          return c.json({ error: "Usuario no encontrado." }, 404);
        }
        const body = await c.req.json();
        if (!tenant.isAdmin) {
          const keys = Object.keys(body);
          if (keys.some((key) => key !== "enabled")) return c.json({ error: "El perfil personal solo puede modificarlo su titular o un administrador." }, 403);
          if (typeof body.enabled !== "boolean") return c.json({ error: "Datos invalidos." }, 400);
          if (!body.enabled && id === c.get("userContext").profile.id) return c.json({ error: "No puedes revocar tu propio acceso." }, 400);
          await prisma.membership.updateMany({ where: { companyId: tenant.companyId, userId: id }, data: { enabled: body.enabled } });
          cacheDelByPrefix("user_ctx:");
          return c.json({ data: { id, enabled: body.enabled } });
        }
        const patch = {};

        // Disabling an Atlas Admin / System Admin here would achieve the same
        // lockout the protected-role guard on DELETE already exists to prevent
        // — this PATCH route had no equivalent check.
        if (body.enabled === false) {
          const targetForDisable = await prisma.userProfile.findUnique({
            where: { id },
            include: {
              memberships: {
                where: { companyId: tenant.companyId },
                include: { role: { select: { key: true } } },
              },
            },
          });
          if (targetForDisable && hasProtectedIdentityAdminRole(targetForDisable)) {
            return c.json(
              {
                error:
                  "No se puede deshabilitar un usuario con rol Runly Admin o System Admin.",
              },
              400,
            );
          }
        }

        if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
        if (typeof body.firstName === "string")
          patch.firstName = body.firstName.trim();
        if (typeof body.lastName === "string")
          patch.lastName = body.lastName.trim();
        // Extended personal fields
        if (typeof body.phone === "string")
          patch.phone = body.phone.trim() || null;
        if (body.phone === null) patch.phone = null;
        if (typeof body.bio === "string") patch.bio = body.bio.trim() || null;
        if (body.bio === null) patch.bio = null;
        if (typeof body.gender === "string")
          patch.gender = body.gender.trim() || null;
        if (body.gender === null) patch.gender = null;
        if (typeof body.birthDate === "string") {
          const d = body.birthDate ? new Date(body.birthDate) : null;
          patch.birthDate = d && !Number.isNaN(d.getTime()) ? d : null;
        }
        if (body.birthDate === null) patch.birthDate = null;

        // Address fields
        if (typeof body.country === "string")
          patch.country = body.country.trim() || null;
        if (body.country === null) patch.country = null;
        if (typeof body.state === "string")
          patch.state = body.state.trim() || null;
        if (body.state === null) patch.state = null;
        if (typeof body.city === "string") patch.city = body.city.trim() || null;
        if (body.city === null) patch.city = null;
        if (typeof body.colony === "string")
          patch.colony = body.colony.trim() || null;
        if (body.colony === null) patch.colony = null;
        if (typeof body.street === "string")
          patch.street = body.street.trim() || null;
        if (body.street === null) patch.street = null;
        if (typeof body.extNumber === "string")
          patch.extNumber = body.extNumber.trim() || null;
        if (body.extNumber === null) patch.extNumber = null;
        if (typeof body.intNumber === "string")
          patch.intNumber = body.intNumber.trim() || null;
        if (body.intNumber === null) patch.intNumber = null;
        if (typeof body.postalCode === "string")
          patch.postalCode = body.postalCode.trim() || null;
        if (body.postalCode === null) patch.postalCode = null;

        const user = await prisma.userProfile.update({
          where: { id },
          data: patch,
        });

        if (patch.firstName !== undefined || patch.lastName !== undefined) {
          const newDisplay =
            `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
          if (newDisplay !== user.displayName) {
            await prisma.userProfile.update({
              where: { id },
              data: { displayName: newDisplay },
            });
            user.displayName = newDisplay;
          }
        }

        // Email update — requires both DB and Supabase auth update
        if (typeof body.email === "string" && body.email.trim()) {
          const newEmail = body.email.trim().toLowerCase();
          const { error: authEmailError } =
            await supabaseAdmin.auth.admin.updateUserById(user.authUserId, {
              email: newEmail,
            });
          if (authEmailError) {
            return c.json(
              { error: "No se pudo actualizar el correo del usuario." },
              500,
            );
          }
          try {
            await prisma.userProfile.update({
              where: { id },
              data: { email: newEmail },
            });
            user.email = newEmail;
          } catch {
            await supabaseAdmin.auth.admin.updateUserById(user.authUserId, {
              email: user.email,
            });
            return c.json(
              { error: "No se pudo sincronizar el correo. Intenta de nuevo." },
              500,
            );
          }
        }

        // Membership / role update.
        // Two guards a caller holding only identity.users.update (not
        // identity.roles.*) must not be able to bypass:
        //  1. membershipId must actually belong to the user in the URL — this
        //     previously trusted the client-supplied id pair as-is, so any
        //     membershipId (e.g. the caller's own) could be reassigned here.
        //  2. the target role must not be a protected admin role — without
        //     this, identity.users.update alone was a full privilege-escalation
        //     path to Atlas Admin / System Admin, bypassing identity.roles.*
        //     entirely.
        if (body.membershipId && body.roleId) {
          const membership = await prisma.membership.findUnique({
            where: { id: body.membershipId },
            select: { userId: true, companyId: true },
          });
          if (!membership || membership.userId !== id || membership.companyId !== tenant.companyId) {
            return c.json(
              { error: "La membresia no corresponde a este usuario." },
              400,
            );
          }
          const targetRole = await prisma.role.findUnique({
            where: { id: body.roleId },
            select: { key: true },
          });
          const targetIsProtectedRole =
            targetRole &&
            PROTECTED_IDENTITY_ROLE_KEYS.has(String(targetRole.key ?? "").trim().toLowerCase());
          if (targetIsProtectedRole) {
            const context = c.get("userContext");
            const canManageRoles =
              tenant.isAdmin || tenant.permissionSet?.has("identity.roles.update");
            if (!canManageRoles) {
              return c.json(
                {
                  error:
                    "Asignar el rol Runly Admin o System Admin requiere permisos de gestion de roles.",
                },
                403,
              );
            }
          }
          await prisma.membership.update({
            where: { id: body.membershipId },
            data: { roleId: body.roleId },
          });
        }

        // Bust user context cache so the next GET /user/me reflects changes
        cacheDel(`user_ctx:${user.authUserId}`);

        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "identity.user.update",
          severity: "info",
          entityType: "UserProfile",
          entityId: id,
          summary: `${actorName} actualizó al usuario ${user.email ?? id}`,
        });

        return c.json({ data: user });
      } catch {
        return c.json({ error: "No se pudo actualizar el usuario." }, 500);
      }
    },
  );

  return app;
}
