import {
  COMPANY_ADMIN_ROLE_KEYS,
  SYSTEM_ADMIN_ROLE_KEYS,
} from "../lib/tenant-context.js";

const DEFAULT_INACTIVITY_HOURS = 48;

// Passive health check: a property that's already "active" gets flagged
// "inactive" (and its managers notified, once, on that transition) if it
// hasn't sent a single analytics event in `inactivityHours`. This only
// detects "traffic stopped" — it doesn't ping the site directly, so a
// genuinely quiet-but-reachable site looks the same as a down one.
export function createGrowthPropertyHealthWorker({
  prisma,
  notificationService = null,
  now = () => new Date(),
  inactivityHours = Number(
    process.env.RUNLY_GROWTH_INACTIVITY_HOURS ?? DEFAULT_INACTIVITY_HOURS,
  ),
}) {
  async function resolveManagerUserIds(companyId) {
    const memberships = await prisma.membership.findMany({
      where: { companyId, enabled: true, company: { enabled: true } },
      include: {
        role: {
          include: {
            permissions: { include: { permission: { select: { key: true } } } },
          },
        },
      },
    });
    const userIds = memberships
      .filter((membership) => membership.role?.enabled !== false)
      .filter((membership) => {
        const roleKey = membership.role?.key;
        if (COMPANY_ADMIN_ROLE_KEYS.has(roleKey) || SYSTEM_ADMIN_ROLE_KEYS.has(roleKey)) {
          return true;
        }
        return (membership.role?.permissions ?? []).some(
          (rolePermission) => rolePermission.permission?.key === "growth.properties.manage",
        );
      })
      .map((membership) => membership.userId);
    return [...new Set(userIds)];
  }

  async function lastEventAt(siteId) {
    const lastEvent = await prisma.growthEvent.findFirst({
      where: { siteId },
      orderBy: { serverReceivedAt: "desc" },
      select: { serverReceivedAt: true },
    });
    return lastEvent?.serverReceivedAt ?? null;
  }

  async function notifyInactive(property) {
    if (!notificationService?.publish) return;
    const userIds = await resolveManagerUserIds(property.companyId);
    if (!userIds.length) return;
    try {
      await notificationService.publish({
        companyId: property.companyId,
        actorId: null,
        input: {
          eventType: "growth.property.inactive",
          title: "Sitio sin actividad reciente",
          body: `${property.name}${property.domain ? ` (${property.domain})` : ""} no ha recibido eventos en mas de ${inactivityHours}h.`,
          link: "/app/m/runly.growth/sites",
          recipients: { userIds },
          channels: ["in_app", "email"],
          priority: "medium",
          sourceType: "GrowthProperty",
          sourceId: property.id,
          metadata: { propertyId: property.id },
        },
      });
    } catch (error) {
      console.error("[growth.property.inactive]", error?.message ?? error);
    }
  }

  async function runOnce() {
    const threshold = new Date(now().getTime() - inactivityHours * 60 * 60 * 1000);

    const activeProperties = await prisma.growthProperty.findMany({
      where: { status: "active", enabled: true },
    });
    let flaggedInactive = 0;
    for (const property of activeProperties) {
      const lastSeen =
        (await lastEventAt(property.id)) ?? property.verifiedAt ?? property.createdAt;
      if (!lastSeen || lastSeen < threshold) {
        await prisma.growthProperty.update({
          where: { id: property.id },
          data: { status: "inactive" },
        });
        flaggedInactive += 1;
        await notifyInactive(property);
      }
    }

    const inactiveProperties = await prisma.growthProperty.findMany({
      where: { status: "inactive", enabled: true },
    });
    let recovered = 0;
    for (const property of inactiveProperties) {
      const lastSeen = await lastEventAt(property.id);
      if (lastSeen && lastSeen >= threshold) {
        await prisma.growthProperty.update({
          where: { id: property.id },
          data: { status: "active" },
        });
        recovered += 1;
      }
    }

    return {
      checked: activeProperties.length + inactiveProperties.length,
      flaggedInactive,
      recovered,
    };
  }

  return { runOnce };
}
