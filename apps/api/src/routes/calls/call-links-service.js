import crypto from "node:crypto";
import { buildCallInviteEmail, resolveAppBaseUrl } from "../../services/email-templates.js";
import { createCompanyBrandService } from "../../services/company-brand-service.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I L O U
const CODE_LEN = 8;

export class CallLinkError extends Error {
  constructor(message, status = 400, reason = null) {
    super(message);
    this.name = "CallLinkError";
    this.status = status;
    this.reason = reason;
  }
}

export function generateCallCode() {
  const bytes = crypto.randomBytes(CODE_LEN);
  let out = "";
  for (let i = 0; i < CODE_LEN; i += 1) out += CROCKFORD[bytes[i] % CROCKFORD.length];
  return out;
}

export function createCallLinksService({ prisma, smtpService, callService, supabaseAdmin = null, env = process.env, now = () => new Date() }) {
  // Public SPA origin — read from the environment (PUBLIC_APP_URL / APP_URL /
  // RUNLY_APP_URL / WEB_APP_URL, then a dev fallback). Never hardcoded.
  const publicAppUrl = String(resolveAppBaseUrl(env) ?? "").replace(/\/+$/, "");
  const brandService = createCompanyBrandService({ prisma, supabaseAdmin });

  function joinUrl(token, inviteToken) {
    const base = `${publicAppUrl}/p/call/${token}`;
    return inviteToken ? `${base}?i=${inviteToken}` : base;
  }

  function toLinkDto(link) {
    return {
      token: link.token,
      code: link.code,
      url: joinUrl(link.token),
      requireLobby: link.requireLobby,
      maxUses: link.maxUses ?? null,
      useCount: link.useCount ?? 0,
      expiresAt: link.expiresAt ?? null,
    };
  }

  async function assertMember(conversationId, profileId) {
    const rows = await prisma.$queryRaw`
      SELECT m.id FROM chat_conversation_members m
      JOIN chat_conversations c ON c.id = m.conversation_id
      WHERE m.conversation_id = ${conversationId} AND m.user_id = ${profileId}
        AND m.left_at IS NULL AND c.deleted_at IS NULL
      LIMIT 1
    `;
    if (!rows.length) throw new CallLinkError("Conversación no encontrada.", 404);
  }

  // The manage gate: initiator of the live call OR channel.manage. We do not
  // require a live call to manage the link, so fall back to channel.manage
  // only when there is no live call.
  async function assertCanManage({ conversationId, profileId }) {
    await assertMember(conversationId, profileId);
    const liveRows = await prisma.$queryRaw`
      SELECT initiated_by_user_id AS "initiatedByUserId"
      FROM "call" WHERE conversation_id = ${conversationId}
        AND status IN ('RINGING','ACTIVE') LIMIT 1
    `;
    const initiatedByUserId = liveRows[0]?.initiatedByUserId ?? null;
    await callService.assertCanManageCall({
      conversationId,
      initiatedByUserId,
      profileId,
      action: "gestionar el enlace de invitados",
    });
  }

  async function getLink({ conversationId, profileId }) {
    await assertMember(conversationId, profileId);
    const link = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    return link ? toLinkDto(link) : null;
  }

  async function getOrCreateLink({ conversationId, profileId }) {
    await assertCanManage({ conversationId, profileId });
    const existing = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    if (existing) return toLinkDto(existing);

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const created = await prisma.callLink.create({
          data: {
            conversationId,
            token: crypto.randomBytes(32).toString("hex"),
            code: generateCallCode(),
            requireLobby: true,
            createdByUserId: profileId,
          },
        });
        return toLinkDto(created);
      } catch (error) {
        lastErr = error;
      }
    }
    throw lastErr ?? new CallLinkError("No se pudo crear el enlace.", 500);
  }

  async function updateLink({ conversationId, profileId, patch }) {
    await assertCanManage({ conversationId, profileId });
    const link = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    if (!link) throw new CallLinkError("No hay un enlace activo.", 404);
    const data = {};
    if (patch.requireLobby !== undefined) data.requireLobby = patch.requireLobby;
    if (patch.maxUses !== undefined) data.maxUses = patch.maxUses;
    if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
    const updated = await prisma.callLink.update({ where: { id: link.id }, data });
    return toLinkDto(updated);
  }

  async function revokeLink({ conversationId, profileId, guestService = null }) {
    await assertCanManage({ conversationId, profileId });
    const link = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    if (!link) return { revoked: false };
    await prisma.callLink.update({ where: { id: link.id }, data: { revokedAt: now() } });
    if (guestService?.kickGuestsForLink) {
      await guestService.kickGuestsForLink({ linkId: link.id }).catch(() => {});
    }
    return { revoked: true };
  }

  async function resolveLinkForJoin({ token = null, code = null }) {
    let link = null;
    if (token) {
      link = await prisma.callLink.findUnique({ where: { token } });
    } else if (code) {
      link = await prisma.callLink.findFirst({ where: { code: code.trim().toUpperCase() } });
    }
    if (!link) throw new CallLinkError("Enlace no válido.", 404, token ? "bad_token" : "bad_code");
    if (link.revokedAt) throw new CallLinkError("Este enlace fue revocado.", 410, "revoked");
    if (link.expiresAt && new Date(link.expiresAt).getTime() < now().getTime()) {
      throw new CallLinkError("Este enlace expiró.", 410, "expired");
    }
    if (link.maxUses != null && (link.useCount ?? 0) >= link.maxUses) {
      throw new CallLinkError("Este enlace alcanzó su límite de usos.", 410, "max_uses");
    }
    return link;
  }

  async function resolveInvite({ inviteToken, linkId }) {
    if (!inviteToken) return null;
    const invite = await prisma.callInvite.findUnique({ where: { token: inviteToken } });
    if (!invite || invite.linkId !== linkId) {
      throw new CallLinkError("Invitación no válida.", 404, "bad_invite");
    }
    return invite;
  }

  async function sendInvites({ conversationId, profileId, emails, scheduledAt = null, scheduledEndAt = null }) {
    await assertCanManage({ conversationId, profileId });
    const link = await prisma.callLink.findFirst({ where: { conversationId, revokedAt: null } });
    if (!link) throw new CallLinkError("Genera un enlace antes de invitar.", 409);

    const normalized = [...new Set(emails.map((e) => e.toLowerCase().trim()).filter(Boolean))];

    // The relevant company is the CALL'S OWN company (via its conversation),
    // never re-derived from the inviter's memberships — a multi-company
    // inviter's "most recently created membership" is not necessarily the
    // company this call actually belongs to. See
    // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md §5.
    const companyRows = await prisma.$queryRaw`
      SELECT up.id AS "userId", lower(up.email) AS email
      FROM user_profile up
      JOIN membership mem ON mem.user_id = up.id AND mem.enabled = true
      WHERE mem.company_id = (
        SELECT company_id FROM chat_conversations WHERE id = ${conversationId} LIMIT 1
      )
      AND lower(up.email) = ANY(${normalized}::text[])
    `;
    const matchedByEmail = new Map(companyRows.map((r) => [r.email, r.userId]));
    const matchedUsers = [...matchedByEmail.entries()].map(([email, userId]) => ({ email, userId }));

    // Platform users get pulled straight into the meeting (member + live-call
    // participant) plus the in-app / web_push "incoming call" alert — no guest
    // email. Best-effort: a failure here never blocks the external invites.
    // Skipped entirely for a scheduled meeting: that alert says "te invitaron
    // a una videollamada" with no date, which is wrong for something that
    // hasn't started — a matched user falls through to the dated email invite
    // below instead, same as an unmatched address.
    let notifiedUsers = [];
    if (matchedUsers.length && callService?.inviteMembersToLiveCall && !scheduledAt) {
      try {
        const res = await callService.inviteMembersToLiveCall({
          conversationId,
          inviterProfileId: profileId,
          users: matchedUsers,
        });
        const notifiedIds = new Set(res?.notified ?? []);
        notifiedUsers = matchedUsers.filter((u) => notifiedIds.has(u.userId));
      } catch (err) {
        console.warn("[runly.calls] No se pudo avisar a los usuarios con cuenta:", err?.message ?? err);
      }
    }

    const invited = [];
    const pendingManual = [];
    // First delivery failure message, surfaced to the UI so the host knows the
    // difference between "SMTP not set up" and "SMTP set up but rejecting".
    let sendError = null;

    const [smtpConversation] = await prisma.$queryRaw`
      SELECT title, company_id AS "companyId" FROM chat_conversations WHERE id = ${conversationId} LIMIT 1
    `;
    const smtpCompanyId = smtpConversation?.companyId;

    // Tell apart "no SMTP configured" from "SMTP configured but unusable"
    // (e.g. the stored password can't be decrypted). getStatus() is optional on
    // the injected service — fall back to the boolean isConfigured().
    let smtpOk = false;
    let smtpFallbackReason = "smtp_not_configured";
    if (smtpService && smtpCompanyId) {
      try {
        if (typeof smtpService.getStatus === "function") {
          const status = await smtpService.getStatus(smtpCompanyId);
          smtpOk = Boolean(status?.configured);
          if (!smtpOk && status?.reason && status.reason !== "not_configured") {
            smtpFallbackReason = "smtp_error";
            if (status.message) sendError = status.message;
          }
        } else {
          smtpOk = await smtpService.isConfigured(smtpCompanyId).catch(() => false);
        }
      } catch {
        smtpOk = false;
      }
    }

    // For a friendlier email ("Raul te invitó en «#general»") and the inviting
    // company's branding. Best-effort — a lookup failure just falls back to
    // the generic Runly wording, it never blocks sending the invite.
    let inviterName = null;
    let conversationTitle = null;
    let brand = null;
    try {
      const [inviterRow] = await prisma.$queryRaw`
        SELECT display_name AS "displayName" FROM user_profile WHERE id = ${profileId} LIMIT 1
      `;
      inviterName = inviterRow?.displayName ?? null;
      conversationTitle = smtpConversation?.title ?? null;
      brand = await brandService.getBrandForCompany(smtpCompanyId ?? null);
    } catch { /* fall back to the generic wording */ }

    for (const email of normalized) {
      if (matchedByEmail.has(email) && !scheduledAt) continue;
      const inviteToken = crypto.randomBytes(24).toString("hex");
      const invite = await prisma.callInvite.create({
        data: {
          linkId: link.id,
          email,
          emailNormalized: email,
          token: inviteToken,
          invitedByUserId: profileId,
          sentAt: smtpOk ? now() : null,
        },
      });
      const url = joinUrl(link.token, inviteToken);
      if (smtpOk) {
        try {
          const mail = buildCallInviteEmail({ joinUrl: url, inviterName, conversationTitle, scheduledAt, scheduledEndAt, brand, env });
          await smtpService.sendEmail({
            companyId: smtpCompanyId,
            to: email,
            subject: mail.subject,
            fromName: brandService.fromNameFor(brand),
            text: mail.text,
            html: mail.html,
          });
          invited.push({ email, inviteId: invite.id });
        } catch (err) {
          const detail = err?.message ?? String(err);
          console.warn("[runly.calls] invite email failed:", email, detail);
          if (!sendError) sendError = detail;
          await prisma.callInvite.update({ where: { id: invite.id }, data: { sentAt: null } }).catch(() => {});
          pendingManual.push({ email, inviteId: invite.id, url, reason: "send_failed", detail });
        }
      } else {
        pendingManual.push({ email, inviteId: invite.id, url, reason: smtpFallbackReason });
      }
    }

    return { matchedUsers, notifiedUsers, invited, pendingManual, smtpConfigured: smtpOk, sendError };
  }

  return {
    getLink,
    getOrCreateLink,
    updateLink,
    revokeLink,
    resolveLinkForJoin,
    resolveInvite,
    sendInvites,
    joinUrl,
    toLinkDto,
  };
}
