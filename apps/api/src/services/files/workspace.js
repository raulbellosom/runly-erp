import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { OFFICE_FORMATS } from "@runly/core";
import { signedUrlsWithVariant } from "../../lib/image-variants.js";
import { createFileAccess, FileAccessError } from "./access.js";

export function createFilesWorkspace({
  prisma,
  supabaseAdmin,
  filesService,
  env = process.env,
}) {
  const access = createFileAccess({ prisma });
  const userSelect = { id: true, displayName: true, email: true, avatarFileId: true };

  // Resolves each user's avatar file to a short-lived signed URL and returns a
  // trimmed payload ({ id, displayName, email, avatarUrl }). Batched by bucket.
  async function attachAvatarUrls(users) {
    const list = users.filter(Boolean);
    const fileIds = [...new Set(list.map((u) => u.avatarFileId).filter(Boolean))];
    const urlByFileId = new Map();
    if (fileIds.length) {
      const assets = await prisma.fileAsset.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, bucket: true, objectKey: true },
      });
      const byBucket = new Map();
      for (const a of assets) {
        if (!byBucket.has(a.bucket)) byBucket.set(a.bucket, []);
        byBucket.get(a.bucket).push(a);
      }
      await Promise.all(
        [...byBucket.entries()].map(async ([bucket, group]) => {
          const urls = await signedUrlsWithVariant(
            supabaseAdmin,
            bucket,
            group.map((a) => a.objectKey),
            "thumb",
          );
          group.forEach((a, i) => urlByFileId.set(a.id, urls[i] ?? null));
        }),
      );
    }
    return list.map((u) => ({
      id: u.id,
      displayName: u.displayName,
      email: u.email,
      avatarUrl: u.avatarFileId ? (urlByFileId.get(u.avatarFileId) ?? null) : null,
    }));
  }
  function shareUrl(fileId) {
    try {
      const base = new URL(env.RUNLY_OFFICE_HOST_ORIGIN || env.RUNLY_APP_URL);
      if (
        !["http:", "https:"].includes(base.protocol) ||
        base.username ||
        base.password
      )
        return null;
      return new URL(
        `/app/m/runly.files/files/${encodeURIComponent(fileId)}`,
        base.origin,
      ).href;
    } catch {
      return null;
    }
  }
  function can(context, key) {
    return context.admin || context.permissions.has(key);
  }
  function requireCapability(context, key) {
    if (!can(context, key))
      throw new FileAccessError("No tienes permiso para realizar esta acción.");
  }
  async function contextFor(authUserId, activeContext) {
    const context = await filesService.getUserCompanyContext(authUserId, activeContext);
    requireCapability(context, "files.assets.read");
    return context;
  }
  async function manageable(context, fileId, db = prisma) {
    const file = await db.fileAsset.findFirst({
      where: { id: fileId, entityId: context.companyId, enabled: true },
      include: {
        invItemFiles: true,
        calendarFiles: true,
        hrProfileEmployees: true,
        generatedDocuments: true,
      },
    });
    if (!file) throw new FileAccessError("Documento no encontrado.", 404);
    if (
      file.entityType !== "AtlasFile" ||
      !["runly.files", "atlas.files"].includes(file.moduleKey) ||
      file.bucket !== "runly-files" ||
      file.visibility === "PUBLIC" ||
      file.invItemFiles.length ||
      file.calendarFiles.length ||
      file.hrProfileEmployees.length ||
      file.generatedDocuments.length ||
      (file.metadata?.sourceEntityId &&
        file.metadata.sourceEntityId !== context.companyId)
    ) {
      throw new FileAccessError(
        "Este archivo conserva el acceso de su módulo de origen.",
      );
    }
    await access.assertAccess(file, context, "manage", db);
    return file;
  }
  async function audit(db, context, fileId, action, metadata = {}) {
    await db.auditLog.create({
      data: {
        actorId: context.profileId,
        moduleKey: "runly.files",
        entityType: "FileAsset",
        entityId: fileId,
        action,
        metadata,
      },
    });
  }
  async function create({ authUserId, activeContext, name, format, requestKey }) {
    const context = await contextFor(authUserId, activeContext);
    requireCapability(context, "files.assets.create");
    requireCapability(context, "files.assets.update");
    if (
      !Object.hasOwn(OFFICE_FORMATS, format) ||
      OFFICE_FORMATS[format].kind !== "ooxml" ||
      typeof name !== "string" ||
      !name.trim() ||
      name.length > 180 ||
      /[\x00-\x1f\\/]/.test(name) ||
      !/^[a-zA-Z0-9_-]{20,100}$/.test(requestKey ?? "")
    )
      throw new FileAccessError("Nombre o tipo de documento inválido.", 400);
    const originalName = name.trim().toLowerCase().endsWith(`.${format}`)
      ? name.trim()
      : `${name.trim()}.${format}`;
    const existing = await prisma.fileAsset.findUnique({
      where: {
        uploadedById_creationKey: {
          uploadedById: context.profileId,
          creationKey: requestKey,
        },
      },
    });
    function checkReplay(file) {
      if (
        !file.enabled ||
        file.entityId !== context.companyId ||
        file.originalName !== originalName ||
        file.mimeType !== OFFICE_FORMATS[format].mimeType
      )
        throw new FileAccessError(
          "Esta solicitud ya creó otro documento. Vuelve a iniciar la creación.",
          409,
        );
      return file;
    }
    if (existing) return checkReplay(existing);
    const bytes = await readFile(
      new URL(`./templates/blank.${format}`, import.meta.url),
    );
    const objectKey = `workspace/${context.companyId}/${randomBytes(24).toString("hex")}.${format}`;
    const { error } = await supabaseAdmin.storage
      .from("runly-files")
      .upload(objectKey, bytes, {
        contentType: OFFICE_FORMATS[format].mimeType,
        upsert: false,
      });
    if (error)
      throw new FileAccessError(
        "No se pudo crear el documento. Puedes reintentar.",
        503,
      );
    try {
      return await prisma.$transaction(async (db) => {
        const file = await db.fileAsset.create({
          data: {
            bucket: "runly-files",
            objectKey,
            originalName,
            mimeType: OFFICE_FORMATS[format].mimeType,
            sizeBytes: bytes.length,
            checksum: createHash("sha256").update(bytes).digest("hex"),
            moduleKey: "runly.files",
            entityType: "AtlasFile",
            entityId: context.companyId,
            uploadedById: context.profileId,
            accessScope: "RESTRICTED",
            creationKey: requestKey,
            visibility: "PRIVATE",
          },
        });
        await audit(db, context, file.id, "files.document.created", { format });
        return file;
      });
    } catch (error) {
      if (error.code === "P2002") {
        // A definite uniqueness failure cannot have committed this candidate.
        await supabaseAdmin.storage
          .from("runly-files")
          .remove([objectKey])
          .catch(() => {});
        const winner = await prisma.fileAsset.findUnique({
          where: {
            uploadedById_creationKey: {
              uploadedById: context.profileId,
              creationKey: requestKey,
            },
          },
        });
        if (winner) return checkReplay(winner);
      }
      // Preserve ambiguous commits; reconciliation can remove unreferenced objects.
      throw error;
    }
  }
  async function sharing({ authUserId, activeContext, fileId }) {
    const context = await contextFor(authUserId, activeContext);
    const file = await filesService.getById({ authUserId, activeContext, id: fileId });
    let canManage = false;
    try {
      await manageable(context, fileId);
      canManage = true;
    } catch (e) {
      if (!(e instanceof FileAccessError)) throw e;
    }
    const shares = canManage
      ? await prisma.fileAssetShare.findMany({
          where: { fileId },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const ids = [
      ...new Set(
        [file.uploadedById, ...shares.map((s) => s.userId)].filter(Boolean),
      ),
    ];
    const rawUsers = await prisma.userProfile.findMany({
      where: { id: { in: ids } },
      select: userSelect,
    });
    const users = await attachAvatarUrls(rawUsers);
    return {
      scope: file.accessScope,
      shareUrl: shareUrl(file.id),
      canManage,
      owner: users.find((u) => u.id === file.uploadedById) ?? null,
      shares: shares.map((s) => ({
        ...s,
        user: users.find((u) => u.id === s.userId),
      })),
    };
  }
  async function members({ authUserId, activeContext, fileId, q = "" }) {
    const context = await contextFor(authUserId, activeContext);
    await manageable(context, fileId);
    const rows = await prisma.membership.findMany({
      where: {
        companyId: context.companyId,
        enabled: true,
        role: {
          enabled: true,
          OR: [
            { key: { in: ["runly.admin", "system.admin"] } },
            {
              permissions: {
                some: {
                  permission: { active: true, key: "files.assets.read" },
                },
              },
            },
          ],
        },
        user: {
          enabled: true,
          OR: [
            { displayName: { contains: q.slice(0, 100), mode: "insensitive" } },
            { email: { contains: q.slice(0, 100), mode: "insensitive" } },
          ],
        },
      },
      include: {
        user: { select: userSelect },
      },
      orderBy: { user: { displayName: "asc" } },
      take: 30,
    });
    return attachAvatarUrls(rows.map((m) => m.user));
  }
  async function changeSharing({
    authUserId,
    activeContext,
    fileId,
    scope,
    userId,
    role,
    revoke = false,
  }) {
    const context = await contextFor(authUserId, activeContext);
    return prisma.$transaction(async (db) => {
      await db.$queryRaw`SELECT id FROM file_asset WHERE id = ${fileId}::uuid FOR UPDATE`;
      const file = await manageable(context, fileId, db);
      if (scope !== undefined) {
        if (!["COMPANY", "RESTRICTED"].includes(scope))
          throw new FileAccessError("Alcance inválido.", 400);
        if (scope === "RESTRICTED" && !file.uploadedById)
          throw new FileAccessError(
            "Este archivo necesita un propietario antes de restringir el acceso.",
            409,
          );
        await db.fileAsset.update({
          where: { id: fileId },
          data: { accessScope: scope, updatedAt: file.updatedAt },
        });
      } else {
        if (userId === file.uploadedById)
          throw new FileAccessError(
            "El propietario conserva el control del documento.",
            400,
          );
        if (!revoke) {
          if (!["VIEWER", "EDITOR"].includes(role))
            throw new FileAccessError("Permiso inválido.", 400);
          const member = await db.membership.findFirst({
            where: {
              userId,
              companyId: context.companyId,
              enabled: true,
              user: { enabled: true },
              role: { enabled: true },
            },
            include: {
              role: {
                include: { permissions: { include: { permission: true } } },
              },
            },
          });
          const keys = new Set(
            member?.role.permissions
              .filter((p) => p.permission.active)
              .map((p) => p.permission.key),
          );
          const admin = ["runly.admin", "system.admin"].includes(
            member?.role.key,
          );
          if (
            !member ||
            (!admin &&
              (!keys.has("files.assets.read") ||
                (role === "EDITOR" && !keys.has("files.assets.update"))))
          )
            throw new FileAccessError(
              "La persona necesita pertenecer a esta empresa y tener los permisos del módulo correspondientes.",
            );
        }
        const where = { fileId_userId: { fileId, userId } };
        if (revoke)
          await db.fileAssetShare.deleteMany({ where: { fileId, userId } });
        else {
          const current = await db.fileAssetShare.findUnique({ where });
          await db.fileAssetShare.upsert({
            where,
            create: { fileId, userId, role, invitedById: context.profileId },
            update: {
              role,
              status: current?.status === "ACCEPTED" ? "ACCEPTED" : "PENDING",
              invitedById: context.profileId,
            },
          });
        }
      }
      await audit(db, context, fileId, "files.access.changed", {
        scope,
        userId,
        role,
        revoke,
      });
      return { ok: true };
    });
  }
  async function invitations({ authUserId, activeContext, page = 1 }) {
    const context = await contextFor(authUserId, activeContext);
    const where = {
      userId: context.profileId,
      status: "PENDING",
      file: { entityId: context.companyId, enabled: true },
    };
    const current = Math.max(
      1,
      Math.min(100000, Number.parseInt(page, 10) || 1),
    );
    const [total, data] = await prisma.$transaction([
      prisma.fileAssetShare.count({ where }),
      prisma.fileAssetShare.findMany({
        where,
        include: {
          file: { select: { id: true, originalName: true, mimeType: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (current - 1) * 20,
        take: 20,
      }),
    ]);
    return {
      data,
      pagination: {
        page: current,
        pageSize: 20,
        total,
        totalPages: Math.max(1, Math.ceil(total / 20)),
      },
    };
  }
  async function respond({ authUserId, activeContext, invitationId, accept }) {
    const context = await contextFor(authUserId, activeContext);
    const result = await prisma.fileAssetShare.updateMany({
      where: {
        id: invitationId,
        userId: context.profileId,
        status: "PENDING",
        file: { entityId: context.companyId, enabled: true },
      },
      data: { status: accept ? "ACCEPTED" : "DECLINED" },
    });
    if (!result.count)
      throw new FileAccessError("La invitación ya no está disponible.", 404);
    return { ok: true };
  }
  return { create, sharing, members, changeSharing, invitations, respond };
}
