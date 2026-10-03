// runly.inventory administrative status routes: alta/baja transitions (single
// and bulk), an item's administrative record and the summary dashboard.
// The route guard is read access; each action checks its own permission
// (see ADMIN_TRANSITIONS in inventory-admin-service.js).
import { attachUserAvatarUrls } from '../../lib/attach-user-avatars.js';
import { Hono } from 'hono';
import { createInventoryAdminService } from '../../services/inventory-admin-service.js';
import { createInventoryDashboardService } from '../../services/inventory-dashboard-service.js';

export function createInventoryAdminRouter({ prisma, requirePermission, InventoryServiceError, inventoryNotifSvc, supabaseAdmin = null }) {
  const router = new Hono();
  const admin = createInventoryAdminService({ prisma, notifier: inventoryNotifSvc });
  const dashboards = createInventoryDashboardService({ prisma });
  const fail = (c, err, fallback) => err instanceof InventoryServiceError
    ? c.json({ error: err.message }, err.status)
    : c.json({ error: fallback }, 500);
  const read = requirePermission('inventory.item.read');
  const canFor = (c) => {
    const tenant = c.get('tenantContext');
    return (key) => Boolean(tenant?.isAdmin || tenant?.permissionSet?.has(key));
  };

  router.get('/inventory/dashboard', read, async (c) => {
    try {
      const data = await dashboards.dashboard(c.get('companyId'), { months: c.req.query('months') });
      // Holder photos (an employee shows its linked user's avatar).
      const holders = data?.top?.holders ?? [];
      if (holders.length) {
        const employees = await prisma.hrEmployee.findMany({ where: { id: { in: holders.map((h) => h.id) }, companyId: c.get('companyId') }, select: { id: true, userProfileId: true } });
        const profileOf = new Map(employees.map((e) => [e.id, e.userProfileId]));
        for (const holder of holders) holder.userProfileId = profileOf.get(holder.id) ?? null;
        await attachUserAvatarUrls(holders, { prisma, supabaseAdmin });
        for (const holder of holders) delete holder.userProfileId;
      }
      return c.json({ data });
    }
    catch (err) { return fail(c, err, 'No se pudo cargar el dashboard.'); }
  });

  router.get('/inventory/dashboard/trend', read, async (c) => {
    try {
      const data = await dashboards.trends(c.get('companyId'), { granularity: c.req.query('granularity'), periods: c.req.query('periods') });
      return c.json({ data });
    } catch (err) { return fail(c, err, 'No se pudo cargar la tendencia.'); }
  });

  router.get('/inventory/summary', read, async (c) => {
    try { return c.json({ data: await admin.summary(c.get('companyId')) }); }
    catch (err) { return fail(c, err, 'No se pudo cargar el resumen.'); }
  });

  // Registered before /items/:id/... so "admin-transition" is not read as an id.
  router.post('/inventory/items/admin-transition/bulk', read, async (c) => {
    try {
      const { ids, action, ...payload } = await c.req.json();
      const data = await admin.bulkTransition({ ids, action, payload, companyId: c.get('companyId'), actorId: c.get('userId'), can: canFor(c) });
      return c.json({ data });
    } catch (err) { return fail(c, err, 'No se pudo aplicar la acción.'); }
  });

  router.post('/inventory/items/:id/admin-transition', read, async (c) => {
    try {
      const { action, ...payload } = await c.req.json();
      const data = await admin.transition({ itemId: c.req.param('id'), action, payload, companyId: c.get('companyId'), actorId: c.get('userId'), can: canFor(c) });
      return c.json({ data });
    } catch (err) { return fail(c, err, 'No se pudo aplicar la acción.'); }
  });

  router.get('/inventory/items/:id/admin-events', read, async (c) => {
    try { return c.json({ data: await admin.listEvents(c.req.param('id'), c.get('companyId')) }); }
    catch (err) { return fail(c, err, 'No se pudo cargar la situación administrativa.'); }
  });

  return router;
}
