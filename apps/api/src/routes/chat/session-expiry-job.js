import crypto from "node:crypto";
import { createSmtpService } from "../../services/smtp-service.js";
import { buildChatGuestExpiryEmail } from "../../services/email-templates.js";
import { createCompanyBrandService } from "../../services/company-brand-service.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ------------------------------------------------------------------
// Send expiry notification email to a guest — branded email/text-alternative
// discipline is shared with every other transactional email via
// buildChatGuestExpiryEmail (see services/email-templates.js).
// ------------------------------------------------------------------
async function sendExpiryEmail(smtp, brandService, { guestEmail, guestName, companyId, resumeUrl }) {
  const brand = await brandService.getBrandForCompany(companyId);
  const mail = buildChatGuestExpiryEmail({ resumeUrl, guestName, brand });
  await smtp.sendEmail({
    companyId,
    to: guestEmail,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    fromName: brandService.fromNameFor(brand),
  });
}

// ------------------------------------------------------------------
// Main expiry job
// ------------------------------------------------------------------
export async function expireStaleGuestSessions(prisma, { supabaseAdmin = null } = {}) {
  // 1. Find sessions about to be closed that have an email — send resume link first
  const expiringWithEmail = await prisma.$queryRaw`
    SELECT cgs.id, cgs.email, cgs.name,
           ws.company_id,
           ws.domain
    FROM chat_guest_sessions cgs
    LEFT JOIN chat_conversations cc ON cc.created_by_guest_id = cgs.id
    LEFT JOIN website_site ws ON ws.id = cc.website_id
    WHERE (cgs.idle_expires_at < NOW() OR cgs.absolute_expires_at < NOW())
      AND cgs.closed_at IS NULL
      AND cgs.email IS NOT NULL
      AND cgs.expiry_email_sent IS NOT DISTINCT FROM false
    LIMIT 50
  `;
  // website_site.domain holds the public URL; site_url does not exist

  if (expiringWithEmail.length > 0) {
    const smtp = createSmtpService({ prisma });
    const brandService = createCompanyBrandService({ prisma, supabaseAdmin });

    for (const row of expiringWithEmail) {
      try {
        // Generate a single-use resume token (24h window)
        const resumeToken = crypto.randomBytes(32).toString("hex");
        const resumeHash = hashToken(resumeToken);

        await prisma.$executeRaw`
          UPDATE chat_guest_sessions
          SET resume_token_hash = ${resumeHash},
              idle_expires_at = NOW() + INTERVAL '24 hours',
              absolute_expires_at = GREATEST(absolute_expires_at, NOW() + INTERVAL '24 hours'),
              expiry_email_sent = true
          WHERE id = ${row.id}
        `;

        if (row.company_id && row.domain && await smtp.isConfigured(row.company_id)) {
          const siteUrl = `https://${row.domain.replace(/^https?:\/\//, "")}`;
          const resumeUrl = `${siteUrl.replace(/\/$/, "")}?chat_resume=${resumeToken}`;
          await sendExpiryEmail(smtp, brandService, {
            guestEmail: row.email,
            guestName: row.name,
            companyId: row.company_id,
            resumeUrl,
          });
        }
      } catch {
        // Non-fatal per session
      }
    }
  }

  // 2. Close stale conversations
  const closedConversations = await prisma.$executeRaw`
    UPDATE chat_conversations
    SET status = 'closed', updated_at = NOW()
    WHERE type = 'external_support'
      AND status IN ('open', 'pending')
      AND deleted_at IS NULL
      AND created_by_guest_id IN (
        SELECT id FROM chat_guest_sessions
        WHERE (idle_expires_at < NOW() OR absolute_expires_at < NOW())
          AND closed_at IS NULL
      )
  `;

  // 3. Close stale sessions
  const closedSessions = await prisma.$executeRaw`
    UPDATE chat_guest_sessions
    SET closed_at = NOW()
    WHERE (idle_expires_at < NOW() OR absolute_expires_at < NOW())
      AND closed_at IS NULL
  `;

  return { closedConversations, closedSessions };
}
