import { PosServiceError, requireCompanyId, writeAudit } from "./service-helpers.js";
import { createPosScopeService } from './pos-scope-service.js';

function cleanData(data = {}) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [
        key,
        typeof value === "string" ? value.trim() || null : value,
      ]),
  );
}

export function createPosFloorService({ prisma }) {
  async function listFloors({ companyId, outletId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    return prisma.posFloor.findMany({
      where: { companyId: scopedCompanyId, ...(outletId ? { outletId } : {}) },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
  }

  async function createFloor({ companyId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    await createPosScopeService({ prisma }).outlet(scopedCompanyId, data.outletId);
    const floor = await prisma.posFloor.create({
      data: {
        companyId: scopedCompanyId,
        ...cleanData(data),
      },
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosFloor",
      entityId: floor.id,
      action: "pos.floor.create",
      after: floor,
    });
    return floor;
  }

  async function getFloorById({ companyId, id }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const floor = await prisma.posFloor.findFirst({ where: { id, companyId: scopedCompanyId } });
    if (!floor) throw new PosServiceError("Plano POS no encontrado.", 404);
    return floor;
  }

  async function getFloorWithLayout({ companyId, id, myTablesOnly = false, actorId }) {
    const scopedCompanyId = requireCompanyId(companyId)
    const floor = await prisma.posFloor.findFirst({
      where: { id, companyId: scopedCompanyId },
      include: {
        elements: { orderBy: { createdAt: 'asc' } },
        // Never filter tables out by waiterId here — "mis-mesas" is a display
        // concern (isMine flag below), not a data-visibility concern. Filtering
        // the query left the canvas with no status data for non-mine tables and
        // made it fall back to a pale "Disponible" ghost regardless of the
        // table's true state.
        tables: {
          where: { enabled: true },
          orderBy: { createdAt: 'asc' },
          include: {
            reservations: {
              where: { status: 'CONFIRMED' },
              orderBy: { scheduledAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    })
    if (!floor) throw new PosServiceError('Plano POS no encontrado.', 404)

    const waiterIds = [...new Set(floor.tables.map((t) => t.waiterId).filter(Boolean))]
    let waiterNames = {}
    if (waiterIds.length > 0) {
      const waiters = await prisma.userProfile.findMany({
        where: { id: { in: waiterIds } },
        select: { id: true, displayName: true },
      })
      waiterNames = Object.fromEntries(waiters.map((w) => [w.id, w.displayName]))
    }

    return {
      ...floor,
      tables: floor.tables.map((t) => ({
        ...t,
        waiterName: t.waiterId ? (waiterNames[t.waiterId] ?? null) : null,
        activeReservation: t.reservations?.[0] ?? null,
        reservations: undefined,
        ...(myTablesOnly && actorId ? { isMine: t.waiterId === actorId } : {}),
      })),
    }
  }

  async function saveLayout({ companyId, id, actorId, elements }) {
    const scopedCompanyId = requireCompanyId(companyId)
    const floor = await prisma.posFloor.findFirst({ where: { id, companyId: scopedCompanyId } })
    if (!floor) throw new PosServiceError('Plano POS no encontrado.', 404)

    const incoming = elements ?? []
    const incomingIds = incoming.filter((e) => e.id).map((e) => e.id)

    await prisma.$transaction(async (tx) => {
      // find elements being removed (to soft-delete their linked tables)
      const removedElements = await tx.posFloorElement.findMany({
        where: { floorId: id, ...(incomingIds.length ? { id: { notIn: incomingIds } } : {}) },
      })

      // delete removed elements
      await tx.posFloorElement.deleteMany({
        where: { floorId: id, ...(incomingIds.length ? { id: { notIn: incomingIds } } : {}) },
      })

      // soft-delete tables from removed elements if no active orders
      for (const elem of removedElements) {
        if (!elem.tableId) continue
        const activeCount = await tx.posOrder.count({
          where: {
            tableId: elem.tableId,
            status: { in: ['DRAFT', 'OPEN', 'SENT', 'PARTIALLY_SERVED', 'SERVED'] },
          },
        })
        if (activeCount === 0) {
          await tx.posTable.update({ where: { id: elem.tableId }, data: { enabled: false } })
        }
      }

      // upsert incoming elements
      for (const elem of incoming) {
        const { id: elemId, kind, x, y, width, height, label, style, tableName, capacity, chairStyle, color } = elem

        // Store visual metadata (chairStyle, color, BAR stools) in the style JSON column
        const metaStyle = {}
        if (chairStyle) metaStyle.chairStyle = chairStyle
        if (color) metaStyle.color = color
        if (kind === 'BAR' && capacity != null) metaStyle.capacity = capacity
        const mergedStyle = (Object.keys(metaStyle).length > 0 || style)
          ? { ...(style ?? {}), ...metaStyle }
          : null

        const posData = {
          x,
          y,
          width,
          height,
          rotation: elem.rotation ?? 0,
          label: label ?? null,
          style: mergedStyle,
        }

        if (elemId) {
          await tx.posFloorElement.updateMany({
            where: { id: elemId, floorId: id },
            data: posData,
          })
          // For TABLE elements, also sync name/capacity to the linked PosTable
          if (kind?.startsWith('TABLE_') && (tableName != null || capacity != null)) {
            const existingElem = await tx.posFloorElement.findFirst({
              where: { id: elemId, floorId: id },
              select: { tableId: true },
            })
            if (existingElem?.tableId) {
              const tableUpdate = {}
              if (tableName != null) tableUpdate.name = (tableName || 'Mesa').trim()
              if (capacity != null) tableUpdate.capacity = capacity
              if (Object.keys(tableUpdate).length > 0) {
                try {
                  await tx.posTable.update({ where: { id: existingElem.tableId }, data: tableUpdate })
                } catch (err) {
                  if (err?.code === 'P2002') {
                    throw new PosServiceError(`Ya existe una mesa con el nombre "${tableUpdate.name}" en este plano.`, 409)
                  }
                  throw err
                }
              }
            }
          }
        } else {
          let tableId = null
          if (kind.startsWith('TABLE_')) {
            try {
              const table = await tx.posTable.create({
                data: {
                  companyId: scopedCompanyId,
                  floorId: id,
                  name: (tableName ?? 'Mesa').trim(),
                  capacity: capacity ?? 2,
                },
              })
              tableId = table.id
            } catch (err) {
              if (err?.code === 'P2002') {
                throw new PosServiceError(`Ya existe una mesa con el nombre "${(tableName ?? 'Mesa').trim()}" en este plano.`, 409)
              }
              throw err
            }
          }
          await tx.posFloorElement.create({
            data: { floorId: id, tableId, kind, ...posData },
          })
        }
      }

      await writeAudit(tx, {
        actorId,
        entityType: 'PosFloor',
        entityId: id,
        action: 'pos.floor.save_layout',
        after: { elementCount: incoming.length },
      })
    })

    return getFloorWithLayout({ companyId: scopedCompanyId, id })
  }

  async function updateFloor({ companyId, id, actorId, data }) {
    const before = await getFloorById({ companyId, id });
    const updated = await prisma.posFloor.update({
      where: { id },
      data: cleanData(data),
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosFloor",
      entityId: id,
      action: "pos.floor.update",
      before,
      after: updated,
    });
    return updated;
  }

  async function publishFloor({ companyId, id, actorId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const floor = await getFloorById({ companyId: scopedCompanyId, id });
    return prisma.$transaction(async (tx) => {
      await tx.posFloor.updateMany({
        where: {
          companyId: scopedCompanyId,
          outletId: floor.outletId,
          id: { not: id },
        },
        data: { isActive: false },
      });
      const updated = await tx.posFloor.update({
        where: { id },
        data: { isActive: true },
      });
      await writeAudit(tx, {
        actorId,
        entityType: "PosFloor",
        entityId: id,
        action: "pos.floor.publish",
        before: floor,
        after: updated,
      });
      return updated;
    });
  }

  async function createTable({ companyId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const floor = await getFloorById({ companyId: scopedCompanyId, id: data.floorId });
    await createPosScopeService({ prisma }).zone(scopedCompanyId, floor.id, data.zoneId);
    const table = await prisma.posTable.create({
      data: {
        companyId: scopedCompanyId,
        floorId: floor.id,
        zoneId: data.zoneId ?? null,
        name: data.name.trim(),
        capacity: Number(data.capacity ?? 2),
      },
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosTable",
      entityId: table.id,
      action: "pos.table.create",
      after: table,
    });
    return table;
  }

  async function getTableInCompany({ companyId, tableId }) {
    const table = await prisma.posTable.findFirst({ where: { id: tableId, companyId } });
    if (!table) throw new PosServiceError("Mesa POS no encontrada.", 404);
    return table;
  }

  async function updateTable({ companyId, tableId, actorId, data }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const before = await getTableInCompany({ companyId: scopedCompanyId, tableId });
    if (data.floorId) await getFloorById({ companyId: scopedCompanyId, id: data.floorId });
    await createPosScopeService({ prisma }).zone(scopedCompanyId, data.floorId ?? before.floorId, data.zoneId !== undefined ? data.zoneId : before.zoneId);
    const updated = await prisma.posTable.update({
      where: { id: tableId },
      data: cleanData(data),
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosTable",
      entityId: tableId,
      action: "pos.table.update",
      before,
      after: updated,
    });
    return updated;
  }

  async function updateTableStatus({ companyId, tableId, actorId, status }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const before = await getTableInCompany({ companyId: scopedCompanyId, tableId });
    const updated = await prisma.posTable.update({
      where: { id: tableId },
      data: {
        status,
        ...(status === "AVAILABLE" ? { waiterId: null } : {}),
      },
    });
    await writeAudit(prisma, {
      actorId,
      entityType: "PosTable",
      entityId: tableId,
      action: "pos.table.status.update",
      before,
      after: updated,
    });
    return updated;
  }

  async function updateTableWaiter({ companyId, actorId, tableId, waiterId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const table = await prisma.posTable.findFirst({
      where: { id: tableId, companyId: scopedCompanyId },
    });
    if (!table) throw new PosServiceError("Mesa no encontrada.", 404);

    if (waiterId) {
      const profile = await prisma.userProfile.findUnique({
        where: { id: waiterId },
        select: { id: true },
      });
      if (!profile) throw new PosServiceError("Usuario no encontrado.", 404);
    }

    const updated = await prisma.posTable.update({
      where: { id: tableId },
      data: { waiterId: waiterId ?? null },
    });

    await writeAudit(prisma, {
      actorId,
      entityType: "PosTable",
      entityId: tableId,
      action: "pos.table.waiter.assign",
      before: { waiterId: table.waiterId },
      after: { waiterId: waiterId ?? null },
    });

    return updated;
  }

  async function getActiveMap({ companyId, outletId, myTablesOnly = false, actorId }) {
    const scopedCompanyId = requireCompanyId(companyId);
    const floor = await prisma.posFloor.findFirst({
      where: { companyId: scopedCompanyId, outletId, isActive: true },
    });
    if (!floor) return null;

    // Fetch every table with its real status, never filtered out of the response —
    // "mis-mesas" is a display concern (isMine), not a data-visibility concern. A
    // previous version filtered non-mine tables out of the query entirely, which
    // left the canvas with no status data for them and made it fall back to a
    // pale "Disponible" ghost regardless of the table's true state.
    const [zones, elements, tables] = await Promise.all([
      prisma.posFloorZone.findMany({ where: { floorId: floor.id }, orderBy: { position: "asc" } }),
      prisma.posFloorElement.findMany({ where: { floorId: floor.id } }),
      prisma.posTable.findMany({ where: { floorId: floor.id } }),
    ]);

    const waiterIds = [...new Set(tables.map((table) => table.waiterId).filter(Boolean))];
    let waiterNames = {};
    if (waiterIds.length > 0) {
      const waiters = await prisma.userProfile.findMany({
        where: { id: { in: waiterIds } },
        select: { id: true, displayName: true },
      });
      waiterNames = Object.fromEntries(waiters.map((w) => [w.id, w.displayName]));
    }

    return {
      ...floor,
      zones,
      elements,
      tables: tables.map((table) => ({
        ...table,
        waiterName: table.waiterId ? (waiterNames[table.waiterId] ?? null) : null,
        ...(myTablesOnly && actorId ? { isMine: table.waiterId === actorId } : {}),
      })),
    };
  }

  return {
    listFloors,
    createFloor,
    getFloorById,
    getFloorWithLayout,
    updateFloor,
    publishFloor,
    createTable,
    updateTable,
    updateTableStatus,
    updateTableWaiter,
    getActiveMap,
    saveLayout,
  };
}
