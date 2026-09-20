import { signedUrlWithVariant } from "../lib/image-variants.js";

// A week outlives any reasonable delay before someone opens a transactional
// email — unlike the 1-hour TTL image-variants.js defaults to for in-app
// signed URLs, which would leave a header logo broken in an email read even
// slightly late (matches EMAIL_LOGO_SIGNED_TTL_SECONDS in
// notification-delivery-worker.js, the other place this same problem exists).
const EMAIL_LOGO_SIGNED_URL_SECONDS = 7 * 24 * 60 * 60;

// Shared "which company brand should this transactional email wear" lookup —
// used by every outbound email that can be sent on behalf of a specific
// company (password reset, call invites, chat guest session expiry). Returns
// `{ name, logoUrl, primaryColor }`, or null when there's nothing usable to
// brand with (no BrandingConfig row, or one with neither a logo nor a color)
// — callers must treat null as "fall back to plain Runly branding."
export function createCompanyBrandService({ prisma, supabaseAdmin }) {
  async function getBrandForCompany(companyId) {
    if (!companyId) return null;
    try {
      const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { name: true, brandingConfig: true },
      });
      const branding = company?.brandingConfig;
      if (!branding || (!branding.logoFileId && !branding.primaryColor)) return null;

      let logoUrl = null;
      if (branding.logoFileId && supabaseAdmin) {
        const fileAsset = await prisma.fileAsset.findUnique({
          where: { id: branding.logoFileId },
          select: { bucket: true, objectKey: true },
        });
        if (fileAsset) {
          logoUrl = await signedUrlWithVariant(
            supabaseAdmin,
            fileAsset.bucket,
            fileAsset.objectKey,
            "card",
            EMAIL_LOGO_SIGNED_URL_SECONDS,
          );
        }
      }

      return { name: company?.name ?? null, logoUrl, primaryColor: branding.primaryColor ?? null };
    } catch {
      return null;
    }
  }

  // Identity-only flows have no selected company. Brand only an unambiguous
  // membership; multi-company identities receive neutral Runly branding.
  async function getBrandForEmail(email) {
    const normalized = String(email ?? "").trim().toLowerCase();
    if (!normalized) return null;
    try {
      const user = await prisma.userProfile.findUnique({
        where: { email: normalized },
        select: {
          memberships: {
            where: { enabled: true, company: { enabled: true }, role: { enabled: true } },
            orderBy: { createdAt: "asc" },
            take: 2,
            select: { companyId: true },
          },
        },
      });
      const companyId = user?.memberships?.length === 1 ? user.memberships[0].companyId : null;
      return companyId ? getBrandForCompany(companyId) : null;
    } catch {
      return null;
    }
  }

  // "<Company> vía Runly ERP" for the SMTP display name — the from-EMAIL
  // always stays whatever's configured in Ajustes -> SMTP (smtp-service.js
  // never lets a caller override it), so branding the display name never
  // breaks SPF/DKIM/DMARC alignment for that domain.
  function fromNameFor(brand) {
    return brand?.name ? `${brand.name} vía Runly ERP` : undefined;
  }

  return { getBrandForCompany, getBrandForEmail, fromNameFor };
}
