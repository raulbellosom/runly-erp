// apps/api/src/routes/inventory/index.js
//
// runly.inventory HTTP routes. Extracted verbatim from apps/api/src/index.js
// (2026-08-30) so the entry point stays under the file-size limit. Auth is
// applied by mountWithAuth(); every route still declares its own
// requirePermission(...).
import { Hono } from "hono";
import { createInventoryIntakeRouter } from './intake-routes.js';
import { createInventoryAssistantRouter } from './assistant-routes.js';
import { tenantActiveContext } from '../../lib/active-context.js';
import { createInventoryReusableCatalog, INVENTORY_BASE_TYPES } from '../../services/inventory-reusable-catalog.js';

export function createInventoryRouter({
  prisma,
  requirePermission,
  inventoryService,
  InventoryServiceError,
  inventoryNotifSvc,
  commentsService,
  CommentsServiceError,
  enrichFilesWithSignedUrls,
  filesService,
}) {
  const router = new Hono();
  router.route('/', createInventoryIntakeRouter({ prisma, requirePermission }));
  router.route('/', createInventoryAssistantRouter({ prisma, requirePermission }));
  const reusableCatalog = createInventoryReusableCatalog({ prisma });
  const typeLabels = ['Hardware', 'Software', 'Licencia', 'Equipo', 'Mobiliario', 'Vehículo', 'Consumible', 'Otro'];
  for (const [segment, kind] of [['models', 'model'], ['types', 'type']]) {
    router.get(`/inventory/${segment}`, requirePermission('inventory.catalog.read'), async c => {
      try {
        const search = c.req.query('search') ?? '';
        const rows = await reusableCatalog.list({ companyId: c.get('companyId'), kind, search });
        const base = kind === 'type' ? INVENTORY_BASE_TYPES.map((value, i) => ({ id: value, value, name: typeLabels[i] })).filter(row => `${row.value} ${row.name}`.toLowerCase().includes(search.toLowerCase())) : [];
        return c.json({ data: [...base, ...rows.map(row => ({ ...row, value: row.name }))] });
      } catch (error) { return c.json({ error: 'No se pudo consultar el catálogo.' }, error.status ?? 500); }
    });
    router.post(`/inventory/${segment}`, requirePermission('inventory.catalog.manage'), async c => {
      try {
        const row = await reusableCatalog.create({ companyId: c.get('companyId'), kind, input: await c.req.json() });
        return c.json({ data: { ...row, value: row.name } }, 201);
      } catch (error) { return c.json({ error: error.status ? error.message : 'No se pudo crear el registro.' }, error.status ?? 500); }
    });
  }

  const isInvErr = (err) => err instanceof InventoryServiceError;
  const isCommentErr = (err) => err instanceof CommentsServiceError;

  // ── Items ────────────────────────────────────────────────────────────────
  router.get("/inventory/items", requirePermission("inventory.item.read"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { search, categoryId, brandId, locationId, status, assignedToId, page, limit, pageSize, sortBy, sortDir } = c.req.query();
      const result = await inventoryService.listItems({ companyId, search, categoryId, brandId, locationId, status, assignedToId, sortBy, sortDir, page: Number(page) || 1, limit: Number(pageSize ?? limit) || 50 });
      return c.json(result);
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudieron cargar los items." }, 500);
    }
  });

  router.post("/inventory/items", requirePermission("inventory.item.create"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const authUserId = c.get("authUserId");
      const data = await c.req.json();
      const item = await inventoryService.createItem(data, companyId, authUserId);
      return c.json({ data: item }, 201);
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo crear el item." }, 500);
    }
  });

  router.get("/inventory/items/by-employee/:empId", requirePermission("inventory.assignment.read"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { empId } = c.req.param();
      const items = await inventoryService.getItemsByEmployee(empId, companyId);
      return c.json({ data: items });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudieron cargar los items del colaborador." }, 500);
    }
  });

  router.get("/inventory/items/:id", requirePermission("inventory.item.read"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const item = await inventoryService.getItem(id, companyId);
      return c.json({ data: item });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo cargar el item." }, 500);
    }
  });

  router.put("/inventory/items/:id", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const data = await c.req.json();
      const item = await inventoryService.updateItem(id, data, companyId);
      return c.json({ data: item });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo actualizar el item." }, 500);
    }
  });

  // PATCH alias — RunlyForm (the shared blueprint-driven form renderer) always
  // submits edits via PATCH, matching the convention already used by
  // PATCH /fleet/vehicles/:id. The PUT route above is kept for any other caller.
  router.patch("/inventory/items/:id", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const data = await c.req.json();
      const item = await inventoryService.updateItem(id, data, companyId);
      return c.json({ data: item });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo actualizar el item." }, 500);
    }
  });

  router.delete("/inventory/items/:id", requirePermission("inventory.item.delete"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      await inventoryService.deleteItem(id, companyId);
      return c.json({ success: true });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo eliminar el item." }, 500);
    }
  });

  router.post("/inventory/items/:id/assign", requirePermission("inventory.assignment.manage"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const authUserId = c.get("authUserId");
      const { id } = c.req.param();
      const { employeeId, notes } = await c.req.json();
      const result = await inventoryService.assignItem(id, employeeId, authUserId, notes, companyId);
      return c.json({ data: result }, 201);
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo asignar el item." }, 500);
    }
  });

  router.post("/inventory/items/:id/return", requirePermission("inventory.assignment.manage"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const authUserId = c.get("authUserId");
      const { id } = c.req.param();
      const body = await c.req.json().catch(() => ({}));
      const result = await inventoryService.returnItem(id, authUserId, body.notes, companyId);
      return c.json({ data: result });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo registrar la devolucion del item." }, 500);
    }
  });

  router.get("/inventory/items/:id/assignments", requirePermission("inventory.assignment.read"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const history = await inventoryService.getAssignmentHistory(id, companyId);
      return c.json({ data: history });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo cargar el historial de asignaciones." }, 500);
    }
  });

  // ── Item files ───────────────────────────────────────────────────────────
  router.get("/inventory/items/:id/files", requirePermission("inventory.item.read"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const files = await inventoryService.listItemFiles(id, companyId);
      const enriched = enrichFilesWithSignedUrls ? await enrichFilesWithSignedUrls(files) : files;
      return c.json({ data: enriched });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudieron cargar los archivos." }, 500);
    }
  });

  router.post("/inventory/items/:id/files", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const body = await c.req.json();
      const fileAssetId = body.file_asset_id ?? body.fileAssetId;
      if (!fileAssetId) return c.json({ error: "file_asset_id is required" }, 400);
      if (filesService) {
        await filesService.getById({ authUserId: c.get('authUserId'), activeContext: tenantActiveContext(c), id: fileAssetId });
      }
      const record = await inventoryService.addItemFile(id, fileAssetId, companyId, body.label ?? null);
      return c.json({ data: record }, 201);
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo asociar el archivo." }, 500);
    }
  });

  router.delete("/inventory/items/:id/files/:docId", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id, docId } = c.req.param();
      await inventoryService.removeItemFile(id, docId, companyId);
      return c.json({ success: true });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo eliminar el archivo." }, 500);
    }
  });

  router.patch("/inventory/items/:id/files/:docId/cover", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id, docId } = c.req.param();
      const record = await inventoryService.setItemFileCover(id, docId, companyId);
      return c.json({ data: record });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo marcar la portada." }, 500);
    }
  });

  router.patch("/inventory/items/:id/files/reorder", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { id } = c.req.param();
      const { items } = await c.req.json();
      await inventoryService.reorderItemFiles(id, companyId, items);
      return c.json({ ok: true });
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo reordenar." }, 500);
    }
  });

  // ── Comments ─────────────────────────────────────────────────────────────
  router.get("/inventory/items/:id/comments", requirePermission("inventory.item.read"), async (c) => {
    try {
      const { id } = c.req.param();
      const comments = await commentsService.listComments("InvItem", id);
      return c.json({ data: comments });
    } catch (err) {
      if (isCommentErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudieron cargar los comentarios." }, 500);
    }
  });

  router.post("/inventory/items/:id/comments", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const authUserId = c.get("authUserId");
      const actorId = c.get("userId");
      const { id } = c.req.param();
      const { body } = await c.req.json();
      const comment = await commentsService.createComment("InvItem", id, authUserId, body, companyId);
      const mentionIds = comment.mentions?.map((m) => m.userId) ?? [];
      if (mentionIds.length > 0) {
        const members = await prisma.membership.findMany({
          where: { companyId, userId: { in: mentionIds }, enabled: true },
          select: { userId: true },
        });
        const validatedMentionIds = members.map((m) => m.userId);
        if (validatedMentionIds.length > 0) {
          await inventoryNotifSvc.notifyInvComment({ companyId, actorId, itemId: id, commentId: comment.id, mentionedUserIds: validatedMentionIds });
        }
      }
      return c.json({ data: comment }, 201);
    } catch (err) {
      if (isCommentErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo crear el comentario." }, 500);
    }
  });

  router.patch("/inventory/items/:id/comments/:cid", requirePermission("inventory.item.update"), async (c) => {
    try {
      const authUserId = c.get("authUserId");
      const { cid } = c.req.param();
      const { body } = await c.req.json();
      const comment = await commentsService.updateComment(cid, authUserId, body);
      return c.json({ data: comment });
    } catch (err) {
      if (isCommentErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo actualizar el comentario." }, 500);
    }
  });

  router.delete("/inventory/items/:id/comments/:cid", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const authUserId = c.get("authUserId");
      const { cid } = c.req.param();
      await commentsService.deleteComment(cid, authUserId, companyId);
      return c.json({ success: true });
    } catch (err) {
      if (isCommentErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo eliminar el comentario." }, 500);
    }
  });

  router.post("/inventory/items/:id/comments/:cid/reactions", requirePermission("inventory.item.update"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const authUserId = c.get("authUserId");
      const actorId = c.get("userId");
      const { cid } = c.req.param();
      const { emoji } = await c.req.json();
      const result = await commentsService.toggleReaction(cid, authUserId, emoji);
      if (!result.removed) {
        await inventoryNotifSvc.notifyInvReaction({ companyId, actorId, commentId: cid });
      }
      return c.json({ data: result });
    } catch (err) {
      if (isCommentErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudo registrar la reaccion." }, 500);
    }
  });

  // ── Assignments list ─────────────────────────────────────────────────────
  router.get("/inventory/assignments", requirePermission("inventory.assignment.read"), async (c) => {
    try {
      const companyId = c.get("companyId");
      const { employeeId, itemId, active, page, limit } = c.req.query();
      const result = await inventoryService.listAllAssignments({ companyId, employeeId, itemId, active: active === "true", page: Number(page) || 1, limit: Number(limit) || 50 });
      return c.json(result);
    } catch (err) {
      if (isInvErr(err)) return c.json({ error: err.message }, err.status);
      return c.json({ error: "No se pudieron cargar las asignaciones." }, 500);
    }
  });

  // ── Catalog: Categories / Brands / Locations / Custom Fields ──────────────
  const catalog = [
    ["categories", "catalog", "listCategories", "createCategory", "updateCategory", "deleteCategory", "reorderCategories", "la categoria", "las categorias"],
    ["brands", "catalog", "listBrands", "createBrand", "updateBrand", "deleteBrand", "reorderBrands", "la marca", "las marcas"],
    ["locations", "catalog", "listLocations", "createLocation", "updateLocation", "deleteLocation", "reorderLocations", "la ubicacion", "las ubicaciones"],
    ["custom-fields", "customfield", "listCustomFields", "createCustomField", "updateCustomField", "deleteCustomField", "reorderCustomFields", "el campo personalizado", "los campos personalizados"],
  ];

  for (const [seg, permGroup, listFn, createFn, updateFn, deleteFn, reorderFn, singular, plural] of catalog) {
    router.get(`/inventory/${seg}`, requirePermission("inventory.catalog.read"), async (c) => {
      try {
        const companyId = c.get("companyId");
        const rows =
          seg === "custom-fields"
            ? await inventoryService[listFn](companyId, c.req.query().categoryId)
            : await inventoryService[listFn](companyId);
        return c.json({ data: rows });
      } catch (err) {
        if (isInvErr(err)) return c.json({ error: err.message }, err.status);
        return c.json({ error: `No se pudieron cargar ${plural}.` }, 500);
      }
    });

    router.post(`/inventory/${seg}`, requirePermission(`inventory.${permGroup}.manage`), async (c) => {
      try {
        const companyId = c.get("companyId");
        const data = await c.req.json();
        const row = await inventoryService[createFn](data, companyId);
        return c.json({ data: row }, 201);
      } catch (err) {
        if (isInvErr(err)) return c.json({ error: err.message }, err.status);
        return c.json({ error: `No se pudo crear ${singular}.` }, 500);
      }
    });

    router.patch(`/inventory/${seg}/reorder`, requirePermission(`inventory.${permGroup}.manage`), async (c) => {
      try {
        const companyId = c.get("companyId");
        const { items } = await c.req.json();
        await inventoryService[reorderFn](companyId, items);
        return c.json({ ok: true });
      } catch (err) {
        if (isInvErr(err)) return c.json({ error: err.message }, err.status);
        return c.json({ error: "No se pudo reordenar." }, 500);
      }
    });

    router.put(`/inventory/${seg}/:id`, requirePermission(`inventory.${permGroup}.manage`), async (c) => {
      try {
        const companyId = c.get("companyId");
        const { id } = c.req.param();
        const data = await c.req.json();
        const row = await inventoryService[updateFn](id, data, companyId);
        return c.json({ data: row });
      } catch (err) {
        if (isInvErr(err)) return c.json({ error: err.message }, err.status);
        return c.json({ error: `No se pudo actualizar ${singular}.` }, 500);
      }
    });

    router.delete(`/inventory/${seg}/:id`, requirePermission(`inventory.${permGroup}.manage`), async (c) => {
      try {
        const companyId = c.get("companyId");
        const { id } = c.req.param();
        await inventoryService[deleteFn](id, companyId);
        return c.json({ success: true });
      } catch (err) {
        if (isInvErr(err)) return c.json({ error: err.message }, err.status);
        return c.json({ error: `No se pudo eliminar ${singular}.` }, 500);
      }
    });
  }

  return router;
}

export default createInventoryRouter;
