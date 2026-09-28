// Cross-module activity for a contact ("Actividad" tab + KPI strip).
//
// Each provider belongs to a module and contributes only when that module is
// INSTALLED + enabled and the viewer holds its read permission. A failing
// provider is logged and skipped so one module never breaks the contact page.

// Attachments uploaded through /files/upload are stored with entityId =
// companyId and the contact id in metadata.sourceEntityId (files-service).
function contactFilesWhere({ companyId, contactId }) {
  return {
    entityId: companyId,
    entityType: "Contact",
    moduleKey: "runly.contacts",
    enabled: true,
    metadata: { path: ["sourceEntityId"], equals: contactId },
  };
}

const PROVIDERS = [
  {
    key: "growth.leads",
    moduleKey: "runly.growth",
    label: "Leads",
    permission: "growth.leads.read",
    async count(prisma, { companyId, contactId }) {
      return prisma.growthLead.count({ where: { companyId, contactId } });
    },
    async list(prisma, { companyId, contactId, limit }) {
      const rows = await prisma.growthLead.findMany({
        where: { companyId, contactId },
        orderBy: { updatedAt: "desc" },
        take: limit,
        select: { id: true, name: true, status: true, source: true, updatedAt: true },
      });
      return rows.map((row) => ({
        id: `lead:${row.id}`,
        kind: "lead",
        title: `Lead ${row.name ?? ""}`.trim(),
        meta: [row.status, row.source].filter(Boolean).join(" · "),
        occurredAt: row.updatedAt,
        url: `/app/m/runly.growth/leads/${row.id}`,
      }));
    },
  },
  {
    key: "dispatch.tickets",
    moduleKey: "custom.dispatch",
    label: "Vales",
    permission: "dispatch.ticket.read",
    async available(prisma) {
      const [row] = await prisma.$queryRaw`SELECT to_regclass('public.dispatch_ticket') IS NOT NULL AS ok`;
      return Boolean(row?.ok);
    },
    async count(prisma, { companyId, contactId }) {
      const [row] = await prisma.$queryRaw`
        SELECT COUNT(*)::int AS total FROM dispatch_ticket
        WHERE company_id = ${companyId}::uuid AND customer_contact_id = ${contactId}::uuid`;
      return row?.total ?? 0;
    },
    async list(prisma, { companyId, contactId, limit }) {
      const rows = await prisma.$queryRaw`
        SELECT id, folio, status, material_name, updated_at FROM dispatch_ticket
        WHERE company_id = ${companyId}::uuid AND customer_contact_id = ${contactId}::uuid
        ORDER BY updated_at DESC LIMIT ${limit}`;
      return rows.map((row) => ({
        id: `ticket:${row.id}`,
        kind: "ticket",
        title: `Vale ${row.folio}`,
        meta: [row.status, row.material_name].filter(Boolean).join(" · "),
        occurredAt: row.updated_at,
        url: `/app/m/custom.dispatch/vales/${row.id}`,
      }));
    },
  },
  {
    key: "files",
    moduleKey: "runly.files",
    label: "Archivos",
    permission: "files.assets.read",
    async count(prisma, ctx) {
      return prisma.fileAsset.count({ where: contactFilesWhere(ctx) });
    },
    async list(prisma, ctx) {
      const rows = await prisma.fileAsset.findMany({
        where: contactFilesWhere(ctx),
        orderBy: { createdAt: "desc" },
        take: ctx.limit,
        select: { id: true, originalName: true, mimeType: true, createdAt: true },
      });
      return rows.map((row) => ({
        id: `file:${row.id}`,
        kind: "file",
        title: `Archivo ${row.originalName}`,
        meta: row.mimeType ?? "",
        occurredAt: row.createdAt,
        url: null,
      }));
    },
  },
];

export function createContactActivityService({ prisma, providers = PROVIDERS, logger = console }) {
  async function activeProviders({ isAdmin, permissionSet }) {
    const modules = await prisma.runlyModule.findMany({
      where: { key: { in: providers.map((p) => p.moduleKey) }, status: "INSTALLED", enabled: true },
      select: { key: true },
    });
    const installed = new Set(modules.map((m) => m.key));
    const allowed = providers.filter(
      (p) => installed.has(p.moduleKey) && (isAdmin || permissionSet?.has?.(p.permission)),
    );
    const checks = await Promise.all(
      allowed.map((p) => (p.available ? p.available(prisma).catch(() => false) : true)),
    );
    return allowed.filter((_, index) => checks[index]);
  }

  return {
    async getActivity({ companyId, contactId, isAdmin, permissionSet, module, limit = 50 }) {
      const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
      const ctx = { companyId, contactId, limit: take };
      const providersToRun = (await activeProviders({ isAdmin, permissionSet }))
        .filter((p) => !module || p.moduleKey === module || p.key === module);

      const results = await Promise.allSettled(
        providersToRun.map(async (p) => {
          const [count, items] = await Promise.all([p.count(prisma, ctx), p.list(prisma, ctx)]);
          return { provider: p, count, items };
        }),
      );

      const summary = [];
      const items = [];
      results.forEach((result, index) => {
        const provider = providersToRun[index];
        if (result.status === "rejected") {
          logger.warn?.(`[contact-activity] provider ${provider.key} failed:`, result.reason?.message);
          return;
        }
        summary.push({ key: provider.key, module: provider.moduleKey, label: provider.label, count: result.value.count });
        for (const item of result.value.items) items.push({ ...item, module: provider.moduleKey });
      });

      items.sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
      return {
        summary,
        lastActivityAt: items[0]?.occurredAt ?? null,
        items: items.slice(0, take),
      };
    },
  };
}
