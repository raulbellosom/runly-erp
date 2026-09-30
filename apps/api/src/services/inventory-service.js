// inventory-service.js — business logic layer for runly.inventory module
import { createActivityService } from './activity-service.js';
import { createActivityBridge } from './activity-bridge.js';
import { buildInventoryWhere } from './inventory-query.js';
import { InventoryServiceError, assertCompany, createRefGuard } from './inventory-guards.js';
import { createInventoryCatalogService } from './inventory-catalog-service.js';
import { DEFAULT_LISTED_ADMIN_STATUSES } from './inventory-admin-service.js';

// Operational statuses a user can set by hand; `assigned` only comes from
// the assign/return flow, bajas from the administrative transitions.
const EDITABLE_STATUSES = new Set(['available', 'maintenance']);
const CREATABLE_ADMIN_STATUSES = new Set(['registered', 'registration_pending']);
// How the company came to own the item (Compras owns the commercial data).
export const ACQUISITION_ORIGINS = ['PURCHASE', 'DONATION', 'TRANSFER', 'LEASE', 'INTERNAL', 'INITIAL_STOCK', 'OTHER'];
const ACQUISITION_ORIGIN_SET = new Set(ACQUISITION_ORIGINS);
// undefined = untouched; blank = OTHER (the column default); unknown value = 400.
export function normalizeAcquisitionOrigin(value) {
  if (value === undefined) return undefined;
  const origin = String(value ?? '').trim().toUpperCase();
  if (!origin) return 'OTHER';
  if (!ACQUISITION_ORIGIN_SET.has(origin)) throw new InventoryServiceError('Origen de adquisición no válido.', 400);
  return origin;
}
const todayDate = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };

export { InventoryServiceError };

function normalizeLimit(limit, fallback = 50, max = 200) {
  const parsed = Number.parseInt(String(limit ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function normalizePage(page) {
  const parsed = Number.parseInt(String(page ?? 1), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

// Table sort keys -> Prisma orderBy. Relation name columns sort by the related
// row's name; unknown keys fall back to newest first.
const ITEM_SORTS = {
  assetTag: (dir) => ({ assetTag: dir }),
  name: (dir) => ({ name: dir }),
  status: (dir) => ({ status: dir }),
  adminStatus: (dir) => ({ adminStatus: dir }),
  conditionName: (dir) => ({ condition: { name: dir } }),
  model: (dir) => ({ model: dir }),
  serialNumber: (dir) => ({ serialNumber: dir }),
  purchaseDate: (dir) => ({ purchaseDate: { sort: dir, nulls: 'last' } }),
  warrantyExpiry: (dir) => ({ warrantyExpiry: { sort: dir, nulls: 'last' } }),
  createdAt: (dir) => ({ createdAt: dir }),
  updatedAt: (dir) => ({ updatedAt: dir }),
  categoryName: (dir) => ({ category: { name: dir } }),
  brandName: (dir) => ({ brand: { name: dir } }),
  locationName: (dir) => ({ location: { name: dir } }),
  assignedToName: (dir) => [{ assignedTo: { firstName: dir } }, { assignedTo: { lastName: dir } }],
};

export function itemOrderBy(sortBy, sortDir) {
  const dir = sortDir === 'asc' ? 'asc' : 'desc';
  const build = ITEM_SORTS[sortBy];
  if (!build) return { createdAt: 'desc' };
  return [build(dir), { createdAt: 'desc' }].flat();
}

// Name is optional for users: a blank name is generated from what the item
// is — "Marca Modelo", else "Tipo Modelo"/"Tipo", else "Activo <etiqueta>".
export function buildAutoItemName({ brandName, typeName, model, assetTag }) {
  const clean = (v) => String(v ?? '').trim();
  const modelText = clean(model);
  const brand = clean(brandName);
  const type = clean(typeName);
  // Avoid "Dell Dell XPS" when the model text already starts with the brand.
  const withBrand = brand && modelText.toLocaleLowerCase('es').startsWith(brand.toLocaleLowerCase('es')) ? modelText : [brand, modelText].filter(Boolean).join(' ');
  const name = (brand && modelText ? withBrand : '') || [type, modelText].filter(Boolean).join(' ') || brand || '';
  return (name || `Activo ${clean(assetTag)}`.trim()).slice(0, 255);
}

export function createInventoryService({ prisma, activityBridge }) {
  const bridge =
    activityBridge ??
    createActivityBridge({
      prisma,
      activityService: createActivityService({ prisma }),
    });

  const assertRefInCompany = createRefGuard(prisma);

  // ── Resolve Supabase auth UUID → UserProfile.id ───────────────────────────
  async function resolveProfileId(authUserId) {
    if (!authUserId) return null;
    const profile = await prisma.userProfile.findFirst({
      where: { authUserId },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  async function autoItemName({ brandId, categoryId, model, assetTag }) {
    const [brand, type] = await Promise.all([
      brandId ? prisma.invBrand.findFirst({ where: { id: brandId }, select: { name: true } }) : null,
      categoryId ? prisma.invCategory.findFirst({ where: { id: categoryId }, select: { name: true } }) : null,
    ]);
    return buildAutoItemName({ brandName: brand?.name, typeName: type?.name, model, assetTag });
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  async function listItems({
    companyId,
    search,
    categoryId,
    brandId,
    locationId,
    status,
    assignedToId,
    modelId,
    conditionId,
    adminStatus,
    createdFrom,
    createdTo,
    purchaseFrom,
    purchaseTo,
    sortBy,
    sortDir,
    page = 1,
    limit = 50,
  }) {
    assertCompany(companyId);
    const take = normalizeLimit(limit);
    const skip = (normalizePage(page) - 1) * take;

    const where = buildInventoryWhere(companyId, {
      search, categoryId, brandId, locationId, conditionId, status, assignedToId, modelId, createdFrom, createdTo, purchaseFrom, purchaseTo,
      adminStatus: adminStatus === 'all' ? undefined : (adminStatus || DEFAULT_LISTED_ADMIN_STATUSES),
    });

    const [data, total] = await Promise.all([
      prisma.invItem.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, icon: true, color: true } },
          brand: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          condition: { select: { id: true, name: true, color: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
        orderBy: itemOrderBy(sortBy, sortDir),
        skip,
        take,
      }),
      prisma.invItem.count({ where }),
    ]);

    const enriched = await Promise.all(data.map(async (item) => ({
      ...item,
      categoryName: item.category?.name ?? null,
      brandName: item.brand?.name ?? null,
      locationName: item.location?.name ?? null,
      conditionName: item.condition?.name ?? null,
      assignedToName: item.assignedTo
        ? [item.assignedTo.firstName, item.assignedTo.lastName].filter(Boolean).join(' ')
        : null,
      coverImageFileId: await resolveCoverImageFileId(item.id),
    })));

    return { data: enriched, total, page: normalizePage(page), limit: take };
  }

  // Resolves the "cover photo" for an inventory item: the file explicitly
  // marked isCover, else the earliest-uploaded image attachment, else null.
  // Only selects mimeType (not the full FileAsset row) to keep this cheap.
  async function resolveCoverImageFileId(itemId) {
    const files = await prisma.invItemFile.findMany({
      where: { itemId },
      select: {
        fileAssetId: true,
        isCover: true,
        sortOrder: true,
        createdAt: true,
        fileAsset: { select: { mimeType: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const explicit = files.find((f) => f.isCover);
    if (explicit) return explicit.fileAssetId;
    const firstImage = files.find((f) => String(f.fileAsset?.mimeType ?? '').startsWith('image/'));
    return firstImage?.fileAssetId ?? null;
  }

  // Same flat shape getItem()/listItems() already expose (relation IDs
  // resolved to names), used to build before/after audit snapshots so
  // activity-bridge.js's computeFieldChanges can diff them into readable
  // field-level changes instead of raw category/brand/location UUIDs.
  function toFlatSnapshot(item) {
    if (!item) return null
    return {
      name: item.name ?? null,
      assetTag: item.assetTag ?? null,
      itemType: item.itemType ?? null,
      categoryName: item.category?.name ?? null,
      brandName: item.brand?.name ?? null,
      locationName: item.location?.name ?? null,
      model: item.model ?? null,
      serialNumber: item.serialNumber ?? null,
      partNumber: item.partNumber ?? null,
      status: item.status ?? null,
      purchaseDate: item.purchaseDate ?? null,
      purchasePrice: item.purchasePrice != null ? Number(item.purchasePrice) : null,
      vendorName: item.vendorName ?? null,
      invoiceNumber: item.invoiceNumber ?? null,
      acquisitionOrigin: item.acquisitionOrigin ?? 'OTHER',
      warrantyExpiry: item.warrantyExpiry ?? null,
      warrantyNotes: item.warrantyNotes ?? null,
      notes: item.notes ?? null,
    }
  }

  async function getItem(id, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({
      where: { id, companyId, enabled: true },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true, description: true } },
        brand:    { select: { id: true, name: true, website: true } },
        location: { select: { id: true, name: true, address: true } },
        condition: { select: { id: true, name: true, color: true } },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, employeeCode: true, userProfileId: true },
        },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        customValues: {
          include: {
            field: { select: { id: true, label: true, fieldKey: true, fieldType: true, options: true } },
          },
        },
        // full file list intentionally omitted here — fetched separately by
        // /items/:id/files; only resolveCoverImageFileId below queries InvItemFile,
        // and only for mimeType/isCover/sortOrder, not the full row.
      },
    });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    const coverImageFileId = await resolveCoverImageFileId(id);
    return {
      ...item,
      categoryName: item.category?.name ?? null,
      brandName: item.brand?.name ?? null,
      locationName: item.location?.name ?? null,
      conditionName: item.condition?.name ?? null,
      assignedToName: item.assignedTo
        ? ([item.assignedTo.firstName, item.assignedTo.lastName].filter(Boolean).join(' ') || null)
        : null,
      coverImageFileId,
      // Drives the read-only "Datos de compra heredados" detail section.
      hasLegacyPurchaseData: Boolean(item.purchaseDate || item.purchasePrice != null || item.vendorName || item.invoiceNumber),
    };
  }

  async function createItem(data, companyId, creatorId) {
    assertCompany(companyId);
    await assertRefInCompany('invCategory', data.categoryId, companyId, 'El tipo');
    await assertRefInCompany('invBrand', data.brandId, companyId, 'La marca');
    await assertRefInCompany('invLocation', data.locationId, companyId, 'La ubicacion');
    await assertRefInCompany('invCondition', data.conditionId, companyId, 'La condicion');
    if (data.status !== undefined && data.status !== null && !EDITABLE_STATUSES.has(data.status)) {
      throw new InventoryServiceError('Estado no válido: usa Disponible o Mantenimiento. Las bajas se registran desde la ficha del activo.', 400);
    }
    const adminStatus = data.adminStatus ?? 'registered';
    if (!CREATABLE_ADMIN_STATUSES.has(adminStatus)) throw new InventoryServiceError('Un activo nuevo solo puede registrarse como Alta o Pendiente de alta.', 400);
    const creatorProfileId = await resolveProfileId(creatorId);
    let assetTag = data.assetTag;
    if (!assetTag) {
      const year = new Date().getFullYear();
      const count = await prisma.invItem.count({ where: { companyId } });
      assetTag = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
    }

    const {
      name,
      description,
      categoryId,
      brandId,
      locationId,
      serialNumber,
      model,
      modelId,
      partNumber,
      status,
      purchaseDate,
      purchasePrice,
      vendorName,
      invoiceNumber,
      acquisitionOrigin,
      warrantyExpiry,
      warrantyNotes,
      licenseKey,
      licenseExpiry,
      licenseSeats,
      notes,
      customValues,
    } = data;

    let itemData = {
      companyId,
      assetTag,
      name: String(name ?? '').trim() || await autoItemName({ brandId, categoryId, model, assetTag }),
      status: status ?? 'available',
      adminStatus,
      registeredAt: adminStatus === 'registered' ? todayDate() : null,
      createdById: creatorProfileId ?? undefined,
    };
    if (description !== undefined) itemData.description = description;
    if (categoryId !== undefined) itemData.categoryId = categoryId;
    if (brandId !== undefined) itemData.brandId = brandId;
    if (locationId !== undefined) itemData.locationId = locationId;
    if (data.conditionId !== undefined) itemData.conditionId = data.conditionId || null;
    if (serialNumber !== undefined) itemData.serialNumber = serialNumber;
    if (model !== undefined) itemData.model = model;
    if (modelId !== undefined) itemData.modelId = modelId || null;
    if (partNumber !== undefined) itemData.partNumber = partNumber;
    if (purchaseDate !== undefined) itemData.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
    if (purchasePrice !== undefined) itemData.purchasePrice = purchasePrice;
    if (vendorName !== undefined) itemData.vendorName = vendorName;
    if (invoiceNumber !== undefined) itemData.invoiceNumber = invoiceNumber;
    if (acquisitionOrigin !== undefined) itemData.acquisitionOrigin = normalizeAcquisitionOrigin(acquisitionOrigin);
    if (warrantyExpiry !== undefined) itemData.warrantyExpiry = warrantyExpiry ? new Date(warrantyExpiry) : null;
    if (warrantyNotes !== undefined) itemData.warrantyNotes = warrantyNotes;
    if (licenseKey !== undefined) itemData.licenseKey = licenseKey;
    if (licenseExpiry !== undefined) itemData.licenseExpiry = licenseExpiry ? new Date(licenseExpiry) : null;
    if (licenseSeats !== undefined) itemData.licenseSeats = licenseSeats;
    if (notes !== undefined) itemData.notes = notes;

    if (customValues && Array.isArray(customValues) && customValues.length > 0) {
      let created;
      let tagAttempt = 0;
      while (!created) {
        try {
          created = await prisma.$transaction(async (tx) => {
            const item = await tx.invItem.create({ data: itemData });
            for (const cv of customValues) {
              await tx.invCustomFieldValue.create({
                data: { itemId: item.id, fieldId: cv.fieldId, value: cv.value ?? null },
              });
            }
            return tx.invItem.findFirst({
              where: { id: item.id },
              include: {
                category: { select: { id: true, name: true, icon: true, color: true } },
                brand: { select: { id: true, name: true } },
                location: { select: { id: true, name: true } },
                customValues: { include: { field: { select: { id: true, label: true, fieldKey: true, fieldType: true, options: true } } } },
              },
            });
          });
        } catch (err) {
          if (!data.assetTag && err.code === 'P2002' && err.meta?.target?.includes('asset_tag') && tagAttempt < 5) {
            tagAttempt++;
            const year = new Date().getFullYear();
            const count = await prisma.invItem.count({ where: { companyId } });
            itemData = { ...itemData, assetTag: `INV-${year}-${String(count + tagAttempt).padStart(4, '0')}` };
          } else {
            throw err;
          }
        }
      }
      await bridge.logAndPublish({
        auditEntry: {
          actorId: creatorProfileId ?? 'system',
          moduleKey: 'runly.inventory',
          entityType: 'InvItem',
          entityId: created.id,
          action: 'inventory.item.created',
          after: { name: created.name, assetTag: created.assetTag },
        },
        hint: { verb: 'created', label: created.name },
        companyId,
      }).catch(() => {});
      return created;
    }

    let created;
    let tagAttempt = 0;
    while (!created) {
      try {
        created = await prisma.invItem.create({
          data: itemData,
          include: {
            category: { select: { id: true, name: true, icon: true, color: true } },
            brand: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
          },
        });
      } catch (err) {
        if (!data.assetTag && err.code === 'P2002' && err.meta?.target?.includes('asset_tag') && tagAttempt < 5) {
          tagAttempt++;
          const year = new Date().getFullYear();
          const count = await prisma.invItem.count({ where: { companyId } });
          itemData = { ...itemData, assetTag: `INV-${year}-${String(count + tagAttempt).padStart(4, '0')}` };
        } else {
          throw err;
        }
      }
    }
    await bridge.logAndPublish({
      auditEntry: {
        actorId: creatorProfileId ?? 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: created.id,
        action: 'inventory.item.created',
        after: { name: created.name, assetTag: created.assetTag },
      },
      hint: { verb: 'created', label: created.name },
      companyId,
    }).catch(() => {});
    return created;
  }

  async function updateItem(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invItem.findFirst({
      where: { id, companyId, enabled: true },
      include: {
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });
    if (!existing) throw new InventoryServiceError('Item not found', 404);
    if (existing.adminStatus === 'deregistered') {
      throw new InventoryServiceError('El activo está dado de baja; revierte la baja para editarlo.', 409);
    }
    await assertRefInCompany('invCategory', data.categoryId, companyId, 'El tipo');
    await assertRefInCompany('invBrand', data.brandId, companyId, 'La marca');
    await assertRefInCompany('invLocation', data.locationId, companyId, 'La ubicacion');
    await assertRefInCompany('invCondition', data.conditionId, companyId, 'La condicion');

    const {
      name,
      assetTag,
      description,
      categoryId,
      brandId,
      locationId,
      serialNumber,
      model,
      modelId,
      partNumber,
      status,
      purchaseDate,
      purchasePrice,
      vendorName,
      invoiceNumber,
      acquisitionOrigin,
      warrantyExpiry,
      warrantyNotes,
      licenseKey,
      licenseExpiry,
      licenseSeats,
      notes,
      customValues,
    } = data;

    const updateData = {};
    if (name !== undefined) {
      updateData.name = String(name ?? '').trim() || await autoItemName({
        brandId: brandId !== undefined ? brandId : existing.brandId,
        categoryId: categoryId !== undefined ? categoryId : existing.categoryId,
        model: model !== undefined ? model : existing.model,
        assetTag: assetTag || existing.assetTag,
      });
    }
    if (assetTag !== undefined) updateData.assetTag = assetTag;
    if (description !== undefined) updateData.description = description;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (brandId !== undefined) updateData.brandId = brandId;
    if (locationId !== undefined) updateData.locationId = locationId;
    if (serialNumber !== undefined) updateData.serialNumber = serialNumber;
    if (model !== undefined) updateData.model = model;
    if (modelId !== undefined) updateData.modelId = modelId || null;
    if (partNumber !== undefined) updateData.partNumber = partNumber;
    // Forms resend the current status; only a real change is validated.
    if (status !== undefined && status !== existing.status) {
      if (!EDITABLE_STATUSES.has(status)) throw new InventoryServiceError('Estado no válido: usa Disponible o Mantenimiento.', 400);
      if (existing.status === 'assigned') throw new InventoryServiceError('Registra la devolución del activo antes de cambiar su estado.', 409);
      updateData.status = status;
    }
    if (data.conditionId !== undefined) updateData.conditionId = data.conditionId || null;
    if (purchaseDate !== undefined) updateData.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
    if (purchasePrice !== undefined) updateData.purchasePrice = purchasePrice;
    if (vendorName !== undefined) updateData.vendorName = vendorName;
    if (invoiceNumber !== undefined) updateData.invoiceNumber = invoiceNumber;
    if (acquisitionOrigin !== undefined) updateData.acquisitionOrigin = normalizeAcquisitionOrigin(acquisitionOrigin);
    if (warrantyExpiry !== undefined) updateData.warrantyExpiry = warrantyExpiry ? new Date(warrantyExpiry) : null;
    if (warrantyNotes !== undefined) updateData.warrantyNotes = warrantyNotes;
    if (licenseKey !== undefined) updateData.licenseKey = licenseKey;
    if (licenseExpiry !== undefined) updateData.licenseExpiry = licenseExpiry ? new Date(licenseExpiry) : null;
    if (licenseSeats !== undefined) updateData.licenseSeats = licenseSeats;
    if (notes !== undefined) updateData.notes = notes;

    if (customValues && Array.isArray(customValues) && customValues.length > 0) {
      const result = await prisma.$transaction(async (tx) => {
        await tx.invItem.update({ where: { id }, data: updateData });
        for (const cv of customValues) {
          await tx.invCustomFieldValue.upsert({
            where: { itemId_fieldId: { itemId: id, fieldId: cv.fieldId } },
            update: { value: cv.value ?? null },
            create: { itemId: id, fieldId: cv.fieldId, value: cv.value ?? null },
          });
        }
        return tx.invItem.findFirst({
          where: { id },
          include: {
            category: { select: { id: true, name: true, icon: true, color: true } },
            brand: { select: { id: true, name: true } },
            location: { select: { id: true, name: true } },
            customValues: { include: { field: { select: { id: true, label: true, fieldKey: true, fieldType: true, options: true } } } },
          },
        });
      });
      await bridge.logAndPublish({
        auditEntry: {
          actorId: 'system',
          moduleKey: 'runly.inventory',
          entityType: 'InvItem',
          entityId: id,
          action: 'inventory.item.updated',
          before: toFlatSnapshot(existing),
          after: toFlatSnapshot(result),
        },
        hint: { verb: 'updated', label: result?.name ?? id },
        companyId,
      }).catch(() => {});
      return result;
    }

    const updated = await prisma.invItem.update({
      where: { id },
      data: updateData,
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
        brand: { select: { id: true, name: true } },
        location: { select: { id: true, name: true } },
      },
    });
    await bridge.logAndPublish({
      auditEntry: {
        actorId: 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: id,
        action: 'inventory.item.updated',
        before: toFlatSnapshot(existing),
        after: toFlatSnapshot(updated),
      },
      hint: { verb: 'updated', label: updated.name ?? id },
      companyId,
    }).catch(() => {});
    return updated;
  }

  async function deleteItem(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invItem.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Item not found', 404);
    const updated = await prisma.invItem.update({ where: { id }, data: { enabled: false } });
    await bridge.logAndPublish({
      auditEntry: {
        actorId: 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: id,
        action: 'inventory.item.deleted',
        after: { enabled: false, name: existing.name ?? null },
      },
      hint: { verb: 'deleted', label: existing.name ?? id },
      companyId,
    }).catch(() => {});
    return updated;
  }

  // ── Assignments ────────────────────────────────────────────────────────────

  async function assignItem(itemId, employeeId, assignedByAuthId, notes, companyId) {
    assertCompany(companyId);
    const actorProfileId = await resolveProfileId(assignedByAuthId);
    if (!actorProfileId) throw new InventoryServiceError('Usuario no encontrado.', 400);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId, enabled: true } });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    if (item.adminStatus === 'registration_pending') throw new InventoryServiceError('El activo está pendiente de alta; confirma el alta antes de asignarlo.', 409);
    if (item.adminStatus === 'deregistered') throw new InventoryServiceError('El activo está dado de baja y no se puede asignar.', 409);
    await assertRefInCompany('hrEmployee', employeeId, companyId, 'El colaborador');
    const activeAssignment = await prisma.invAssignment.findFirst({ where: { itemId, returnedAt: null } });
    if (activeAssignment) throw new InventoryServiceError('Item is already assigned', 409);

    const result = await prisma.$transaction(async (tx) => {
      const assignment = await tx.invAssignment.create({
        data: { itemId, employeeId, assignedById: actorProfileId, notes: notes ?? null },
      });
      const updatedItem = await tx.invItem.update({
        where: { id: itemId },
        data: { status: 'assigned', assignedToId: employeeId, assignedAt: new Date() },
        include: {
          category: { select: { id: true, name: true, icon: true, color: true } },
          brand: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
      });
      return { item: updatedItem, assignment };
    });
    await bridge.logAndPublish({
      auditEntry: {
        actorId: actorProfileId ?? 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: itemId,
        action: 'inventory.item.assigned',
        after: { employeeId, name: item?.name ?? null },
      },
      hint: { verb: 'assigned', label: item.name ?? itemId },
      companyId,
    }).catch(() => {});
    return result;
  }

  async function returnItem(itemId, assignedById, notes, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId, enabled: true } });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    const activeAssignment = await prisma.invAssignment.findFirst({
      where: { itemId, returnedAt: null },
      orderBy: { assignedAt: 'desc' },
    });
    if (!activeAssignment) throw new InventoryServiceError('Item is not currently assigned', 409);

    const result = await prisma.$transaction(async (tx) => {
      await tx.invAssignment.update({
        where: { id: activeAssignment.id },
        data: { returnedAt: new Date(), ...(notes !== undefined ? { notes } : {}) },
      });

      return tx.invItem.update({
        where: { id: itemId },
        data: { status: 'available', assignedToId: null, assignedAt: null },
        include: {
          category: { select: { id: true, name: true, icon: true, color: true } },
          brand: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
        },
      });
    });
    await bridge.logAndPublish({
      auditEntry: {
        actorId: 'system',
        moduleKey: 'runly.inventory',
        entityType: 'InvItem',
        entityId: itemId,
        action: 'inventory.item.returned',
        after: { status: 'available', name: item?.name ?? null },
      },
      hint: { verb: 'returned', label: item.name ?? itemId },
      companyId,
    }).catch(() => {});
    return result;
  }

  async function getAssignmentHistory(itemId, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId, enabled: true } });
    if (!item) throw new InventoryServiceError('Item not found', 404);

    return prisma.invAssignment.findMany({
      where: { itemId },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        assignedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async function listAllAssignments({
    companyId,
    employeeId,
    itemId,
    active,
    page = 1,
    limit = 50,
  }) {
    assertCompany(companyId);
    const take = normalizeLimit(limit);
    const skip = (normalizePage(page) - 1) * take;

    const where = {
      item: { companyId, enabled: true },
    };
    if (employeeId) where.employeeId = employeeId;
    if (itemId) where.itemId = itemId;
    if (active === true || active === 'true') where.returnedAt = null;

    const [data, total] = await Promise.all([
      prisma.invAssignment.findMany({
        where,
        include: {
          item: {
            select: {
              id: true,
              name: true,
              assetTag: true,
              category: { select: { id: true, name: true, icon: true, color: true } },
            },
          },
          employee: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
          assignedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { assignedAt: 'desc' },
        skip,
        take,
      }),
      prisma.invAssignment.count({ where }),
    ]);

    return { data, total, page: normalizePage(page), limit: take };
  }

  async function getItemsByEmployee(employeeId, companyId) {
    assertCompany(companyId);
    return prisma.invItem.findMany({
      where: { assignedToId: employeeId, companyId, enabled: true, status: 'assigned' },
      include: {
        category: { select: { id: true, name: true, icon: true, color: true } },
      },
      orderBy: { assignedAt: 'desc' },
    });
  }

  async function listItemFiles(itemId, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId, enabled: true }, select: { id: true } });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    return prisma.invItemFile.findMany({
      where: { itemId },
      include: { fileAsset: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true, bucket: true, objectKey: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function addItemFile(itemId, fileAssetId, companyId, label) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId, enabled: true }, select: { id: true } });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    return prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`inventory-files:${itemId}`}, 0))::text AS locked`;
      const include = { fileAsset: { select: { id: true, originalName: true, mimeType: true, sizeBytes: true } } };
      const previous = await tx.invItemFile.findFirst({ where: { itemId, fileAssetId }, include });
      if (previous) return previous;
      if (await tx.invItemFile.count({ where: { itemId } }) >= 20) throw new InventoryServiceError('El equipo admite hasta 20 archivos.', 400);
      return tx.invItemFile.create({ data: { itemId, fileAssetId, label: label ?? null }, include });
    });
  }

  async function removeItemFile(itemId, docId, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId, enabled: true }, select: { id: true } });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    const row = await prisma.invItemFile.findFirst({ where: { id: docId, itemId } });
    if (!row) throw new InventoryServiceError('File association not found', 404);
    await prisma.invItemFile.delete({ where: { id: docId } });
    return { success: true };
  }

  async function setItemFileCover(itemId, docId, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({
      where: { id: itemId, companyId, enabled: true },
      select: { id: true },
    });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    return prisma.$transaction(async (tx) => {
      const row = await tx.invItemFile.findFirst({ where: { id: docId, itemId } });
      if (!row) throw new InventoryServiceError('File association not found', 404);
      await tx.invItemFile.updateMany({ where: { itemId }, data: { isCover: false } });
      return tx.invItemFile.update({ where: { id: docId }, data: { isCover: true } });
    });
  }

  async function reorderItemFiles(itemId, companyId, items) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({
      where: { id: itemId, companyId, enabled: true },
      select: { id: true },
    });
    if (!item) throw new InventoryServiceError('Item not found', 404);
    if (!Array.isArray(items)) return;
    await prisma.$transaction(
      items
        .filter((entry) => entry && typeof entry.id === 'string')
        .map(({ id, sortOrder }) =>
          prisma.invItemFile.updateMany({
            where: { id, itemId },
            data: { sortOrder: Number(sortOrder) || 0 },
          }),
        ),
    );
  }

  return {
    // Items
    listItems,
    getItem,
    createItem,
    updateItem,
    deleteItem,
    // Files
    listItemFiles,
    addItemFile,
    removeItemFile,
    setItemFileCover,
    reorderItemFiles,
    // Assignments
    assignItem,
    returnItem,
    getAssignmentHistory,
    listAllAssignments,
    getItemsByEmployee,
    ...createInventoryCatalogService({ prisma }),
  };
}
