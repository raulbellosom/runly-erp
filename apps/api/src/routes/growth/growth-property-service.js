import { encryptPassword } from "../../services/smtp-service.js";

export class GrowthPropertyServiceError extends Error {
  constructor(message, status = 400, code = "growth_property_error") {
    super(message);
    this.name = "GrowthPropertyServiceError";
    this.status = status;
    this.code = code;
  }
}

function normalizeDomain(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

// Mirrors website-service.js's encryptedSecret() — turnstileSecretKey is
// stored encrypted, decrypted only at Turnstile-verify time (see
// createTurnstileVerifier in storefront-capture-routes.js).
function encryptedSecret(value) {
  if (value === null || value === "") return null;
  return encryptPassword(value);
}

function sortByCreatedAt(list) {
  return [...list].sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
}

export function createGrowthPropertyService({ prisma, now = () => new Date() }) {
  async function mirrorWebsiteSite({ companyId, site }) {
    return prisma.growthProperty.upsert({
      where: { companyId_websiteSiteId: { companyId, websiteSiteId: site.id } },
      update: {
        name: site.name,
        domain: site.domain,
        analyticsMode: site.analyticsMode,
        turnstileSiteKey: site.turnstileSiteKey ?? null,
        turnstileSecretKey: site.turnstileSecretKey ?? null,
      },
      create: {
        companyId,
        kind: "website_module",
        websiteSiteId: site.id,
        name: site.name,
        domain: site.domain,
        status: "active",
        analyticsMode: site.analyticsMode ?? "standard",
        turnstileSiteKey: site.turnstileSiteKey ?? null,
        turnstileSecretKey: site.turnstileSecretKey ?? null,
        verifiedAt: now(),
      },
    });
  }

  async function listProperties({ companyId }) {
    const [properties, websiteSites] = await Promise.all([
      prisma.growthProperty.findMany({ where: { companyId, enabled: true } }),
      prisma.websiteSite.findMany({ where: { companyId, enabled: true } }),
    ]);

    const mirroredSiteIds = new Set(
      properties.filter((p) => p.websiteSiteId).map((p) => p.websiteSiteId),
    );
    const missing = websiteSites.filter((site) => !mirroredSiteIds.has(site.id));
    if (missing.length === 0) return sortByCreatedAt(properties);

    const created = await Promise.all(missing.map((site) => mirrorWebsiteSite({ companyId, site })));
    return sortByCreatedAt([...properties, ...created]);
  }

  async function resolveProperty({ companyId, propertyId }) {
    if (!propertyId) {
      const list = await listProperties({ companyId });
      return list[0] ?? null;
    }
    const existing = await prisma.growthProperty.findFirst({
      where: { companyId, id: propertyId, enabled: true },
    });
    if (existing) return existing;

    const site = await prisma.websiteSite.findFirst({
      where: { companyId, id: propertyId, enabled: true },
    });
    if (site) return mirrorWebsiteSite({ companyId, site });

    return null;
  }

  async function assertProperty({ companyId, propertyId }) {
    if (!propertyId) return null;
    const property = await resolveProperty({ companyId, propertyId });
    if (!property) {
      throw new GrowthPropertyServiceError("Sitio no encontrado.", 404, "property_not_found");
    }
    return property;
  }

  async function createExternalProperty({ companyId, name, domain }) {
    const normalizedDomain = normalizeDomain(domain);
    if (normalizedDomain) {
      const existing = await prisma.growthProperty.findFirst({
        where: { companyId, domain: normalizedDomain, enabled: true },
      });
      if (existing) {
        throw new GrowthPropertyServiceError(
          "Ya existe un sitio conectado con ese dominio.",
          409,
          "property_domain_conflict",
        );
      }
    }
    return prisma.growthProperty.create({
      data: {
        companyId,
        kind: "external_sdk",
        name: String(name).trim(),
        domain: normalizedDomain,
        status: "pending_verification",
        analyticsMode: "standard",
      },
    });
  }

  async function updateProperty({ companyId, propertyId, patch }) {
    const property = await prisma.growthProperty.findFirst({
      where: { companyId, id: propertyId },
    });
    if (!property) {
      throw new GrowthPropertyServiceError("Sitio no encontrado.", 404, "property_not_found");
    }
    const data = {};
    if (patch.name !== undefined) data.name = String(patch.name).trim();
    if (patch.domain !== undefined) data.domain = normalizeDomain(patch.domain);
    if (patch.enabled !== undefined) data.enabled = Boolean(patch.enabled);
    if (patch.turnstileSiteKey !== undefined) {
      data.turnstileSiteKey = String(patch.turnstileSiteKey ?? "").trim() || null;
    }
    if (patch.turnstileSecretKey !== undefined) {
      data.turnstileSecretKey = encryptedSecret(patch.turnstileSecretKey);
    }
    return prisma.growthProperty.update({ where: { id: propertyId }, data });
  }

  async function verifyProperty({ companyId, propertyId }) {
    const property = await prisma.growthProperty.findFirst({
      where: { companyId, id: propertyId },
    });
    if (!property) {
      throw new GrowthPropertyServiceError("Sitio no encontrado.", 404, "property_not_found");
    }
    if (property.status === "active") {
      return { property, verified: true };
    }
    const hasEvent = await prisma.growthEvent.findFirst({
      where: { companyId, siteId: propertyId },
      select: { id: true },
    });
    if (!hasEvent) {
      return { property, verified: false };
    }
    const updated = await prisma.growthProperty.update({
      where: { id: propertyId },
      data: { status: "active", verifiedAt: now() },
    });
    return { property: updated, verified: true };
  }

  return {
    listProperties,
    resolveProperty,
    assertProperty,
    createExternalProperty,
    updateProperty,
    verifyProperty,
  };
}
