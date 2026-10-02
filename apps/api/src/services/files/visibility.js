// Read visibility for the generic runly.files entry points (list, detail,
// signed URLs, bulk download). Spec:
// docs/superpowers/specs/2026-10-01-files-access-model-design.md
//
// A non-admin user can read a file when they uploaded it, hold an ACCEPTED
// share, it is a runly.files document shared with the whole company, or it is
// a module attachment whose originating record the owning module lets them
// read. Module-internal attachment routes keep using files/access.js: they
// already authorize the record before listing its files.

export const FILES_ORIGIN_MODULES = ["runly.files", "atlas.files"];

export function isFilesOrigin(file) {
  return (
    file?.entityType === "AtlasFile" &&
    (file.moduleKey == null || FILES_ORIGIN_MODULES.includes(file.moduleKey))
  );
}

const filesOriginWhere = {
  entityType: "AtlasFile",
  OR: [{ moduleKey: null }, { moduleKey: { in: FILES_ORIGIN_MODULES } }],
};

const company = { kind: "company" };
const owner = { kind: "owner" };
const permission = (key) => ({ kind: "permission", key });

// Canvas: the caller owns the board or collaborates on it (any role).
const boardMemberWhere = (profileId) => ({
  OR: [{ ownerId: profileId }, { collaborators: { some: { userId: profileId } } }],
});
// Projects: the caller owns the project or is a member.
const projectMemberWhere = (profileId) => ({
  OR: [{ ownerId: profileId }, { members: { some: { userId: profileId } } }],
});

// Keyed by FileAsset.entityType. Entity types missing here are readable only
// by their uploader, accepted shares and admins (deny by default).
export const FILE_ACCESS_RULES = {
  AtlasFile: { kind: "files" },
  BrandingConfig: company,
  Company: company,
  UserProfile: company,
  HrEmployee: permission("hr.employee.read"),
  Contact: permission("contacts.contacts.read"),
  FleetVehicle: permission("fleet.vehicles.read"),
  FleetDriver: permission("fleet.drivers.read"),
  FleetMaintenance: permission("fleet.vehicles.read"),
  FleetReport: permission("fleet.reports.read"),
  InvItem: permission("inventory.item.read"),
  GrowthLead: permission("growth.leads.read"),
  GeneratedDocument: permission("documents.generated.read"),
  purchase_order: permission("purchases.order.read"),
  purchase_invoice: permission("purchases.invoice.read"),
  purchase_receipt: permission("purchases.receipt.read"),
  purchase_quote: permission("purchases.quote.read"),
  purchase_request: permission("purchases.request.read"),
  PfmReceipt: owner,
  Task: {
    kind: "records",
    permission: "projects.task.read",
    ids: (prisma, { companyId, profileId }) =>
      prisma.task.findMany({
        where: { project: { companyId, ...projectMemberWhere(profileId) } },
        select: { id: true },
      }),
    can: (prisma, { companyId, profileId }, id) =>
      prisma.task.findFirst({
        where: { id, project: { companyId, ...projectMemberWhere(profileId) } },
        select: { id: true },
      }),
  },
  CanvasBoard: {
    kind: "records",
    ids: (prisma, { companyId, profileId }) =>
      prisma.canvasBoard.findMany({
        where: { companyId, ...boardMemberWhere(profileId) },
        select: { id: true },
      }),
    can: (prisma, { companyId, profileId }, id) =>
      prisma.canvasBoard.findFirst({
        where: { id, companyId, ...boardMemberWhere(profileId) },
        select: { id: true },
      }),
  },
  CanvasHotspot: {
    kind: "records",
    ids: (prisma, { companyId, profileId }) =>
      prisma.canvasHotspot.findMany({
        where: { companyId, board: boardMemberWhere(profileId) },
        select: { id: true },
      }),
    can: (prisma, { companyId, profileId }, id) =>
      prisma.canvasHotspot.findFirst({
        where: { id, companyId, board: boardMemberWhere(profileId) },
        select: { id: true },
      }),
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasPermission(context, key) {
  return Boolean(key && context.permissions?.has?.(key));
}

export function describeFile(file) {
  const filesOrigin = isFilesOrigin(file);
  return {
    origin: filesOrigin
      ? null
      : {
          moduleKey: file.moduleKey ?? null,
          entityType: file.entityType ?? null,
          sourceEntityId: file.metadata?.sourceEntityId ?? null,
        },
    access: !filesOrigin ? "module" : file.accessScope === "COMPANY" ? "company" : "private",
  };
}

export function createFileVisibility({ prisma }) {
  // Prisma `where` fragment with every file the caller may read.
  async function listWhere(context) {
    if (context.admin) return {};
    const { profileId, companyId } = context;
    const OR = [
      { uploadedById: profileId },
      { shares: { some: { userId: profileId, status: "ACCEPTED" } } },
      { ...filesOriginWhere, accessScope: "COMPANY" },
    ];
    const openTypes = [];
    const recordFileIds = [];
    for (const [entityType, rule] of Object.entries(FILE_ACCESS_RULES)) {
      if (rule.kind === "company") openTypes.push(entityType);
      else if (rule.kind === "permission" && hasPermission(context, rule.key)) openTypes.push(entityType);
      else if (rule.kind === "records") {
        if (rule.permission && !hasPermission(context, rule.permission)) continue;
        const sourceIds = (await rule.ids(prisma, context)).map((row) => row.id);
        if (!sourceIds.length) continue;
        const rows = await prisma.$queryRaw`
          SELECT id FROM file_asset
           WHERE entity_id = ${companyId}::uuid
             AND entity_type = ${entityType}
             AND access_scope = 'COMPANY'
             AND metadata->>'sourceEntityId' = ANY(${sourceIds}::text[])`;
        for (const row of rows) recordFileIds.push(row.id);
      }
    }
    // Module attachments only through their module rule; a RESTRICTED one is
    // reachable solely via uploader/share above.
    if (openTypes.length) OR.push({ entityType: { in: openTypes }, accessScope: "COMPANY" });
    if (recordFileIds.length) OR.push({ id: { in: recordFileIds } });
    return { OR };
  }

  async function canRead(file, context) {
    if (context.admin) return true;
    if (file.uploadedById && file.uploadedById === context.profileId) return true;
    const share = await prisma.fileAssetShare.findUnique({
      where: { fileId_userId: { fileId: file.id, userId: context.profileId } },
    });
    if (share?.status === "ACCEPTED") return true;
    if (file.accessScope === "RESTRICTED") return false;
    if (isFilesOrigin(file)) return true;
    const rule = FILE_ACCESS_RULES[file.entityType];
    if (!rule) return false;
    if (rule.kind === "company") return true;
    if (rule.kind === "permission") return hasPermission(context, rule.key);
    if (rule.kind === "records") {
      if (rule.permission && !hasPermission(context, rule.permission)) return false;
      const sourceId = file.metadata?.sourceEntityId;
      if (!UUID.test(String(sourceId ?? ""))) return false;
      return Boolean(await rule.can(prisma, context, sourceId));
    }
    return false;
  }

  return { listWhere, canRead };
}
