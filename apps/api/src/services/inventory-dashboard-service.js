// inventory-dashboard-service.js — statistics for the inventory dashboard:
// weekly/monthly trends (altas/bajas, asignaciones/devoluciones, vigentes), top groupings,
// purchase value and warranties, on top of the administrative summary.
// Spec: docs/superpowers/specs/2026-09-29-inventory-dashboard-design.md
import { getConfiguredTimeZone } from '@runly/core';
import { assertCompany } from './inventory-guards.js';
import { createInventoryAdminService } from './inventory-admin-service.js';

const TOP = 8;

// Bucket start days ("YYYY-MM-DD"), oldest first, for the last `periods`
// weeks (Monday-based, like Postgres date_trunc('week')) or months, in `timeZone`.
// Calendar day of a Date built with Date.UTC (a date, not a local instant).
const utcDay = (date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

export function bucketKeys(granularity, periods, now = new Date(), timeZone = getConfiguredTimeZone()) {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = iso.split('-').map(Number);
  if (granularity === 'week') {
    const today = new Date(Date.UTC(y, m - 1, d));
    const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86400000);
    return Array.from({ length: periods }, (_, i) => utcDay(new Date(monday.getTime() - (periods - 1 - i) * 7 * 86400000)));
  }
  return Array.from({ length: periods }, (_, i) => utcDay(new Date(Date.UTC(y, m - 1 - (periods - 1 - i), 1))));
}

// Kept for callers of the monthly keys ("YYYY-MM").
export function monthKeys(months, now = new Date(), timeZone = getConfiguredTimeZone()) {
  return bucketKeys('month', months, now, timeZone).map((k) => k.slice(0, 7));
}

// [{ bucket, n }] rows -> counts aligned to `keys`.
export function alignSeries(keys, rows) {
  const byBucket = new Map(rows.map((r) => [String(r.bucket ?? r.month), Number(r.n)]));
  return keys.map((k) => byBucket.get(k) ?? 0);
}

function localToday(timeZone) {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${iso}T00:00:00Z`);
}
const addDays = (date, days) => new Date(date.getTime() + days * 86400000);

export function createInventoryDashboardService({ prisma }) {
  const admin = createInventoryAdminService({ prisma, activityBridge: { logAndPublish: async () => {} } });

  // Per-bucket altas, bajas, asignaciones and devoluciones plus the running
  // total of vigentes (altas minus bajas) starting from the count before the
  // first bucket.
  async function trends(companyId, { granularity = 'month', periods = 12 } = {}, timeZone = getConfiguredTimeZone()) {
    const unit = granularity === 'week' ? 'week' : 'month';
    const count = Math.min(Math.max(Number(periods) || 12, 4), unit === 'week' ? 104 : 36);
    const keys = bucketKeys(unit, count, new Date(), timeZone);
    const from = keys[0];
    const [altas, bajas, assigned, returned, [base]] = await Promise.all([
      prisma.$queryRaw`
        SELECT to_char(date_trunc(${unit}, COALESCE(registered_at, (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date)::timestamp), 'YYYY-MM-DD') AS bucket, count(*)::int AS n
        FROM inv_item
        WHERE company_id = ${companyId}::uuid AND enabled = true
          AND COALESCE(registered_at, (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date) >= ${from}::date
        GROUP BY 1`,
      prisma.$queryRaw`
        SELECT to_char(date_trunc(${unit}, deregistered_at::timestamp), 'YYYY-MM-DD') AS bucket, count(*)::int AS n
        FROM inv_item
        WHERE company_id = ${companyId}::uuid AND enabled = true AND deregistered_at >= ${from}::date
        GROUP BY 1`,
      prisma.$queryRaw`
        SELECT to_char(date_trunc(${unit}, (a.assigned_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})), 'YYYY-MM-DD') AS bucket, count(*)::int AS n
        FROM inv_assignment a JOIN inv_item i ON i.id = a.item_id
        WHERE i.company_id = ${companyId}::uuid AND (a.assigned_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date >= ${from}::date
        GROUP BY 1`,
      prisma.$queryRaw`
        SELECT to_char(date_trunc(${unit}, (a.returned_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})), 'YYYY-MM-DD') AS bucket, count(*)::int AS n
        FROM inv_assignment a JOIN inv_item i ON i.id = a.item_id
        WHERE i.company_id = ${companyId}::uuid AND a.returned_at IS NOT NULL
          AND (a.returned_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date >= ${from}::date
        GROUP BY 1`,
      prisma.$queryRaw`
        SELECT count(*)::int AS n
        FROM inv_item
        WHERE company_id = ${companyId}::uuid AND enabled = true
          AND COALESCE(registered_at, (created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})::date) < ${from}::date
          AND (deregistered_at IS NULL OR deregistered_at >= ${from}::date)`,
    ]);
    const [al, ba, asg, dev] = [altas, bajas, assigned, returned].map((rows) => alignSeries(keys, rows));
    let running = Number(base?.n ?? 0);
    return {
      granularity: unit,
      baseline: running,
      points: keys.map((start, i) => {
        running += al[i] - ba[i];
        const next = keys[i + 1];
        const end = next ? utcDay(new Date(new Date(`${next}T00:00:00Z`).getTime() - 86400000)) : null;
        return { start, end, altas: al[i], bajas: ba[i], asignaciones: asg[i], devoluciones: dev[i], vigentes: running };
      }),
    };
  }

  // Top `TOP` values of `field` among active items, with names resolved.
  async function top(where, field, resolve, emptyLabel) {
    const rows = await prisma.invItem.groupBy({
      by: [field], where, _count: { _all: true }, orderBy: { _count: { id: 'desc' } }, take: TOP,
    });
    const ids = rows.map((r) => r[field]).filter(Boolean);
    const names = ids.length ? await resolve(ids) : new Map();
    return rows.map((r) => ({ id: r[field], name: r[field] ? (names.get(r[field]) ?? '—') : emptyLabel, count: r._count._all }));
  }

  const byIds = (table, label = (row) => row.name) => async (ids) => {
    const rows = await prisma[table].findMany({ where: { id: { in: ids } } });
    return new Map(rows.map((row) => [row.id, label(row)]));
  };

  async function dashboard(companyId, { months = 12 } = {}) {
    assertCompany(companyId);
    const span = Math.min(Math.max(Number(months) || 12, 3), 24);
    const timeZone = getConfiguredTimeZone();
    const active = { companyId, enabled: true, adminStatus: { not: 'deregistered' } };
    const today = localToday(timeZone);

    const [summary, monthly, byType, byBrand, byModel, byLocation, holders, value, expired, in30, in90, upcoming, withWarranty, typeStatus] = await Promise.all([
      admin.summary(companyId),
      trends(companyId, { granularity: 'month', periods: span }, timeZone),
      top(active, 'categoryId', byIds('invCategory'), 'Sin tipo'),
      top(active, 'brandId', byIds('invBrand'), 'Sin marca'),
      top(active, 'modelId', async (ids) => {
        const rows = await prisma.invModel.findMany({ where: { id: { in: ids } }, include: { brand: { select: { name: true } } } });
        return new Map(rows.map((m) => [m.id, [m.brand?.name, m.name].filter(Boolean).join(' ')]));
      }, 'Sin modelo de catálogo'),
      top(active, 'locationId', byIds('invLocation'), 'Sin ubicación'),
      top({ ...active, assignedToId: { not: null } }, 'assignedToId',
        byIds('hrEmployee', (e) => [e.firstName, e.lastName].filter(Boolean).join(' ')), ''),
      prisma.invItem.aggregate({ where: active, _sum: { purchasePrice: true }, _count: { purchasePrice: true } }),
      prisma.invItem.count({ where: { ...active, warrantyExpiry: { lt: today } } }),
      prisma.invItem.count({ where: { ...active, warrantyExpiry: { gte: today, lt: addDays(today, 30) } } }),
      prisma.invItem.count({ where: { ...active, warrantyExpiry: { gte: today, lt: addDays(today, 90) } } }),
      prisma.invItem.findMany({
        where: { ...active, warrantyExpiry: { gte: today } },
        select: { id: true, name: true, assetTag: true, warrantyExpiry: true },
        orderBy: { warrantyExpiry: 'asc' },
        take: TOP,
      }),
      prisma.invItem.count({ where: { ...active, warrantyExpiry: { gte: today } } }),
      prisma.invItem.groupBy({ by: ['categoryId', 'status'], where: active, _count: { _all: true } }),
    ]);

    // Availability per type for the top types (radar: one axis per type).
    const typeProfile = byType.slice(0, 6).map((t) => {
      const counts = Object.fromEntries(typeStatus.filter((r) => r.categoryId === t.id).map((r) => [r.status, r._count._all]));
      return { id: t.id, name: t.name, available: counts.available ?? 0, assigned: counts.assigned ?? 0, maintenance: counts.maintenance ?? 0 };
    });

    const activeCount = summary.total - (summary.byAdminStatus.deregistered ?? 0);
    return {
      ...summary,
      activeCount,
      assignedCount: summary.byStatus.assigned ?? 0,
      purchaseValue: Number(value._sum.purchasePrice ?? 0),
      pricedCount: value._count.purchasePrice ?? 0,
      monthly: monthly.points.map((p) => ({ ...p, month: p.start.slice(0, 7) })),
      top: { types: byType, brands: byBrand, models: byModel, locations: byLocation, holders: holders.filter((h) => h.id) },
      warranties: { expired, in30, in90, upcoming, active: withWarranty },
      typeProfile,
    };
  }

  return { dashboard, trends };
}
