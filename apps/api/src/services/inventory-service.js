// inventory-service.js — business logic layer for runly.inventory module
import { parseMentionIds } from '../lib/mention-utils.js'
import { createActivityService } from './activity-service.js';
import { createActivityBridge } from './activity-bridge.js';
import { buildInventoryWhere } from './inventory-query.js';

export class InventoryServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'InventoryServiceError';
    this.status = status;
  }
}


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

// Defensive company-scope guard. A missing companyId reaching a Prisma `where`
// as `undefined` would drop the tenant filter entirely, so reject it here
// (mirrors the fleet/ledger `toScopedCompanyUuid` contract).
function assertCompany(companyId) {
  if (typeof companyId !== 'string' || companyId.trim() === '') {
    throw new InventoryServiceError('companyId es requerido.', 400);
  }
  return companyId;
}

export function createInventoryService({ prisma, activityBridge }) {
  const bridge =
    activityBridge ??
    createActivityBridge({
      prisma,
      activityService: createActivityService({ prisma }),
    });

  // Rejects a foreign-key reference (category/brand/location/parent/employee)
  // that belongs to a different company — closes cross-tenant linking.
  async function assertRefInCompany(model, id, companyId, label) {
    if (id === undefined || id === null || id === '') return;
    const row = await prisma[model].findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!row) {
      throw new InventoryServiceError(
        `${label} no pertenece a la empresa actual.`,
        400,
      );
    }
  }

  // ── Resolve Supabase auth UUID → UserProfile.id ───────────────────────────
  async function resolveProfileId(authUserId) {
    if (!authUserId) return null;
    const profile = await prisma.userProfile.findFirst({
      where: { authUserId },
      select: { id: true },
    });
    return profile?.id ?? null;
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
    sortBy,
    sortDir,
    page = 1,
    limit = 50,
  }) {
    assertCompany(companyId);
    const take = normalizeLimit(limit);
    const skip = (normalizePage(page) - 1) * take;

    const where = buildInventoryWhere(companyId, { search, categoryId, brandId, locationId, status, assignedToId });

    const [data, total] = await Promise.all([
      prisma.invItem.findMany({
        where,
        include: {
          category: { select: { id: true, name: true, icon: true, color: true } },
          brand: { select: { id: true, name: true } },
          location: { select: { id: true, name: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true, employeeCode: true } },
        },
        orderBy: { [new Set(['assetTag', 'name', 'status', 'purchaseDate', 'warrantyExpiry', 'updatedAt']).has(sortBy) ? sortBy : 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc' },
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
      assignedToName: item.assignedTo
        ? ([item.assignedTo.firstName, item.assignedTo.lastName].filter(Boolean).join(' ') || null)
        : null,
      coverImageFileId,
    };
  }

  async function createItem(data, companyId, creatorId) {
    assertCompany(companyId);
    await assertRefInCompany('invCategory', data.categoryId, companyId, 'La categoria');
    await assertRefInCompany('invBrand', data.brandId, companyId, 'La marca');
    await assertRefInCompany('invLocation', data.locationId, companyId, 'La ubicacion');
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
      itemType,
      categoryId,
      brandId,
      locationId,
      serialNumber,
      model,
      partNumber,
      status,
      purchaseDate,
      purchasePrice,
      vendorName,
      invoiceNumber,
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
      name,
      status: status ?? 'available',
      createdById: creatorProfileId ?? undefined,
    };
    if (itemType !== undefined) itemData.itemType = itemType || null;
    if (description !== undefined) itemData.description = description;
    if (categoryId !== undefined) itemData.categoryId = categoryId;
    if (brandId !== undefined) itemData.brandId = brandId;
    if (locationId !== undefined) itemData.locationId = locationId;
    if (serialNumber !== undefined) itemData.serialNumber = serialNumber;
    if (model !== undefined) itemData.model = model;
    if (partNumber !== undefined) itemData.partNumber = partNumber;
    if (purchaseDate !== undefined) itemData.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
    if (purchasePrice !== undefined) itemData.purchasePrice = purchasePrice;
    if (vendorName !== undefined) itemData.vendorName = vendorName;
    if (invoiceNumber !== undefined) itemData.invoiceNumber = invoiceNumber;
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
    await assertRefInCompany('invCategory', data.categoryId, companyId, 'La categoria');
    await assertRefInCompany('invBrand', data.brandId, companyId, 'La marca');
    await assertRefInCompany('invLocation', data.locationId, companyId, 'La ubicacion');

    const {
      name,
      assetTag,
      description,
      itemType,
      categoryId,
      brandId,
      locationId,
      serialNumber,
      model,
      partNumber,
      status,
      purchaseDate,
      purchasePrice,
      vendorName,
      invoiceNumber,
      warrantyExpiry,
      warrantyNotes,
      licenseKey,
      licenseExpiry,
      licenseSeats,
      notes,
      customValues,
    } = data;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (assetTag !== undefined) updateData.assetTag = assetTag;
    if (description !== undefined) updateData.description = description;
    if (itemType !== undefined) updateData.itemType = itemType || null;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (brandId !== undefined) updateData.brandId = brandId;
    if (locationId !== undefined) updateData.locationId = locationId;
    if (serialNumber !== undefined) updateData.serialNumber = serialNumber;
    if (model !== undefined) updateData.model = model;
    if (partNumber !== undefined) updateData.partNumber = partNumber;
    if (status !== undefined) updateData.status = status;
    if (purchaseDate !== undefined) updateData.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
    if (purchasePrice !== undefined) updateData.purchasePrice = purchasePrice;
    if (vendorName !== undefined) updateData.vendorName = vendorName;
    if (invoiceNumber !== undefined) updateData.invoiceNumber = invoiceNumber;
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

  // ── Catalog — Categories ───────────────────────────────────────────────────

  async function listCategories(companyId) {
    assertCompany(companyId);
    return prisma.invCategory.findMany({
      where: { companyId, enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async function createCategory(data, companyId) {
    assertCompany(companyId);
    const { name, description, icon, color, parentId, sortOrder } = data;
    await assertRefInCompany('invCategory', parentId, companyId, 'La categoria padre');
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (icon !== undefined) createData.icon = icon;
    if (color !== undefined) createData.color = color;
    if (parentId !== undefined) createData.parentId = parentId;
    if (sortOrder !== undefined) createData.sortOrder = sortOrder;
    return prisma.invCategory.create({ data: createData });
  }

  async function updateCategory(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCategory.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Category not found', 404);
    const { name, description, icon, color, parentId, sortOrder } = data;
    if (parentId !== undefined && parentId !== null && parentId === id) {
      throw new InventoryServiceError('Una categoria no puede ser su propia padre.', 400);
    }
    await assertRefInCompany('invCategory', parentId, companyId, 'La categoria padre');
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (parentId !== undefined) updateData.parentId = parentId;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    return prisma.invCategory.update({ where: { id }, data: updateData });
  }

  async function deleteCategory(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCategory.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Category not found', 404);
    const inUse = await prisma.invItem.count({ where: { companyId, categoryId: id, enabled: true } });
    if (inUse > 0) {
      throw new InventoryServiceError(
        `No se puede eliminar: ${inUse} elemento(s) usan esta categoria.`,
        409,
      );
    }
    return prisma.invCategory.update({ where: { id }, data: { enabled: false } });
  }

  // ── Catalog — Brands ───────────────────────────────────────────────────────

  async function listBrands(companyId) {
    assertCompany(companyId);
    return prisma.invBrand.findMany({
      where: { companyId, enabled: true },
      orderBy: { name: 'asc' },
    });
  }

  async function createBrand(data, companyId) {
    assertCompany(companyId);
    const { name, description, website } = data;
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (website !== undefined) createData.website = website;
    return prisma.invBrand.create({ data: createData });
  }

  async function updateBrand(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invBrand.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Brand not found', 404);
    const { name, description, website } = data;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (website !== undefined) updateData.website = website;
    return prisma.invBrand.update({ where: { id }, data: updateData });
  }

  async function deleteBrand(id, companyId) {
    assertCompany(companyId);
    const brand = await prisma.invBrand.findFirst({ where: { id, companyId, enabled: true } });
    if (!brand) throw new InventoryServiceError('Brand not found', 404);
    const inUse = await prisma.invItem.count({ where: { companyId, brandId: id, enabled: true } });
    if (inUse > 0) {
      throw new InventoryServiceError(
        `No se puede eliminar: ${inUse} elemento(s) usan esta marca.`,
        409,
      );
    }
    return prisma.invBrand.update({ where: { id }, data: { enabled: false } });
  }

  // ── Catalog — Locations ────────────────────────────────────────────────────

  async function listLocations(companyId) {
    assertCompany(companyId);
    return prisma.invLocation.findMany({
      where: { companyId, enabled: true },
      orderBy: { name: 'asc' },
    });
  }

  async function createLocation(data, companyId) {
    assertCompany(companyId);
    const { name, description, address } = data;
    const createData = { companyId, name };
    if (description !== undefined) createData.description = description;
    if (address !== undefined) createData.address = address;
    return prisma.invLocation.create({ data: createData });
  }

  async function updateLocation(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invLocation.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Location not found', 404);
    const { name, description, address } = data;
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (address !== undefined) updateData.address = address;
    return prisma.invLocation.update({ where: { id }, data: updateData });
  }

  async function deleteLocation(id, companyId) {
    assertCompany(companyId);
    const location = await prisma.invLocation.findFirst({ where: { id, companyId, enabled: true } });
    if (!location) throw new InventoryServiceError('Location not found', 404);
    const inUse = await prisma.invItem.count({ where: { companyId, locationId: id, enabled: true } });
    if (inUse > 0) {
      throw new InventoryServiceError(
        `No se puede eliminar: ${inUse} elemento(s) usan esta ubicacion.`,
        409,
      );
    }
    return prisma.invLocation.update({ where: { id }, data: { enabled: false } });
  }

  // ── Custom Fields ──────────────────────────────────────────────────────────

  async function listCustomFields(companyId, categoryId) {
    assertCompany(companyId);
    const where = { companyId, enabled: true };
    if (categoryId) {
      where.OR = [{ categoryId }, { categoryId: null }];
    } else {
      where.categoryId = null;
    }
    return prisma.invCustomField.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
    });
  }

  async function createCustomField(data, companyId) {
    assertCompany(companyId);
    const { label, fieldKey, fieldType, categoryId, options, required, sortOrder } = data;
    await assertRefInCompany('invCategory', categoryId, companyId, 'La categoria');
    const createData = { companyId, label, fieldKey, fieldType };
    if (categoryId !== undefined) createData.categoryId = categoryId;
    if (options !== undefined) createData.options = options;
    if (required !== undefined) createData.required = required;
    if (sortOrder !== undefined) createData.sortOrder = sortOrder;
    return prisma.invCustomField.create({ data: createData });
  }

  async function updateCustomField(id, data, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCustomField.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Custom field not found', 404);
    const { label, fieldKey, fieldType, categoryId, options, required, sortOrder } = data;
    await assertRefInCompany('invCategory', categoryId, companyId, 'La categoria');
    const updateData = {};
    if (label !== undefined) updateData.label = label;
    if (fieldKey !== undefined) updateData.fieldKey = fieldKey;
    if (fieldType !== undefined) updateData.fieldType = fieldType;
    if (categoryId !== undefined) updateData.categoryId = categoryId;
    if (options !== undefined) updateData.options = options;
    if (required !== undefined) updateData.required = required;
    if (sortOrder !== undefined) updateData.sortOrder = sortOrder;
    return prisma.invCustomField.update({ where: { id }, data: updateData });
  }

  async function deleteCustomField(id, companyId) {
    assertCompany(companyId);
    const existing = await prisma.invCustomField.findFirst({ where: { id, companyId, enabled: true } });
    if (!existing) throw new InventoryServiceError('Custom field not found', 404);
    return prisma.invCustomField.update({ where: { id }, data: { enabled: false } });
  }

  // Reorder helpers scope every write by companyId (via updateMany) so a
  // payload referencing another company's rows is a silent no-op, never a write.
  async function reorderCatalog(model, companyId, items) {
    assertCompany(companyId);
    if (!Array.isArray(items)) return;
    await prisma.$transaction(
      items
        .filter((entry) => entry && typeof entry.id === 'string')
        .map(({ id, sortOrder }) =>
          prisma[model].updateMany({
            where: { id, companyId },
            data: { sortOrder: Number(sortOrder) || 0 },
          }),
        ),
    );
  }

  const reorderCategories = (companyId, items) => reorderCatalog('invCategory', companyId, items);
  const reorderBrands = (companyId, items) => reorderCatalog('invBrand', companyId, items);
  const reorderLocations = (companyId, items) => reorderCatalog('invLocation', companyId, items);
  const reorderCustomFields = (companyId, items) => reorderCatalog('invCustomField', companyId, items);

  // ── Comments ───────────────────────────────────────────────────────────────

  async function listComments(itemId, companyId) {
    assertCompany(companyId);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId, enabled: true } });
    if (!item) throw new InventoryServiceError('Item not found', 404);

    return prisma.invComment.findMany({
      where: { itemId },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
        mentions: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        reactions: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function createComment(itemId, authorAuthId, body, companyId) {
    assertCompany(companyId);
    const authorProfileId = await resolveProfileId(authorAuthId);
    if (!authorProfileId) throw new InventoryServiceError('Usuario no encontrado.', 400);
    const item = await prisma.invItem.findFirst({ where: { id: itemId, companyId, enabled: true } });
    if (!item) throw new InventoryServiceError('Item not found', 404);

    if (!body?.trim()) throw new InventoryServiceError('El comentario no puede estar vacio.', 400);
    if (body.trim().length > 5000) throw new InventoryServiceError('El comentario no puede tener mas de 5000 caracteres.', 400);

    const trimmedBody = body.trim();
    const mentionIds = parseMentionIds(trimmedBody);

    return prisma.$transaction(async (tx) => {
      const comment = await tx.invComment.create({
        data: { itemId, authorId: authorProfileId, body: trimmedBody },
        include: {
          author: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
        },
      });

      for (const userId of mentionIds) {
        try {
          await tx.invMention.create({ data: { commentId: comment.id, userId } });
        } catch (err) {
          if (err.code !== 'P2003' && err.code !== 'P2002') throw err;
        }
      }

      return { comment, mentionIds };
    });
  }

  async function updateComment(commentId, authorAuthId, body, companyId) {
    assertCompany(companyId);
    if (!body?.trim()) throw new InventoryServiceError('El comentario no puede estar vacio.', 400);
    if (body.trim().length > 5000) throw new InventoryServiceError('El comentario no puede tener mas de 5000 caracteres.', 400);

    const authorProfileId = await resolveProfileId(authorAuthId);
    if (!authorProfileId) throw new InventoryServiceError('Usuario no encontrado.', 400);

    const comment = await prisma.invComment.findFirst({
      where: { id: commentId },
      include: { item: { select: { id: true, companyId: true } } },
    });
    if (!comment) throw new InventoryServiceError('Comment not found', 404);
    if (comment.item?.companyId !== companyId) throw new InventoryServiceError('Comment not found', 404);
    if (comment.authorId !== authorProfileId) throw new InventoryServiceError('Solo el autor puede editar este comentario.', 403);

    return prisma.invComment.update({
      where: { id: commentId },
      data: { body: body.trim(), editedAt: new Date() },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, avatarFileId: true } },
      },
    });
  }

  async function deleteComment(commentId, requesterAuthId, companyId) {
    assertCompany(companyId);
    const requesterProfileId = await resolveProfileId(requesterAuthId);
    if (!requesterProfileId) throw new InventoryServiceError('Usuario no encontrado.', 400);
    const comment = await prisma.invComment.findFirst({
      where: { id: commentId },
      include: { item: { select: { id: true, companyId: true } } },
    });
    if (!comment) throw new InventoryServiceError('Comment not found', 404);
    if (comment.item?.companyId !== companyId) throw new InventoryServiceError('Comment not found', 404);
    if (comment.authorId !== requesterProfileId) throw new InventoryServiceError('No tienes permiso para eliminar este comentario.', 403);

    await prisma.invComment.delete({ where: { id: commentId } });
  }

  async function toggleReaction(commentId, userAuthId, emoji) {
    const userProfileId = await resolveProfileId(userAuthId);
    if (!userProfileId) throw new InventoryServiceError('Usuario no encontrado.', 400);
    const existing = await prisma.invCommentReaction.findUnique({
      where: { commentId_userId_emoji: { commentId, userId: userProfileId, emoji } },
    });

    if (existing) {
      await prisma.invCommentReaction.delete({
        where: { commentId_userId_emoji: { commentId, userId: userProfileId, emoji } },
      });
      return { action: 'removed' };
    }

    await prisma.invCommentReaction.create({ data: { commentId, userId: userProfileId, emoji } });
    return { action: 'added' };
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
    // Categories
    listCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    // Brands
    listBrands,
    createBrand,
    updateBrand,
    deleteBrand,
    // Locations
    listLocations,
    createLocation,
    updateLocation,
    deleteLocation,
    // Custom Fields
    listCustomFields,
    createCustomField,
    updateCustomField,
    deleteCustomField,
    reorderCategories,
    reorderBrands,
    reorderLocations,
    reorderCustomFields,
    // Comments
    listComments,
    createComment,
    updateComment,
    deleteComment,
    toggleReaction,
  };
}
