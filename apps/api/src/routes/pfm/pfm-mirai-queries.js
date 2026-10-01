// apps/api/src/routes/pfm/pfm-mirai-queries.js
//
// Exact PFM tools for MirAI (spec 2026-09-30-mirai-pfm-capability §2): overview,
// wallets, cross-wallet movement search, spending aggregates, budgets, upcoming
// charges and categories. Every tool is scoped to wallets the caller can read
// (wallets.listWallets) and amounts are always grouped by currency, never
// summed across currencies. Totals/sums are computed in SQL, never by the model.
import { Prisma } from "@prisma/client";
import { toLocalIso, toLocalMonth } from "@runly/core";
import { toPlainNumber } from "./service-helpers.js";

const MAX_RANGE_DAYS = 366;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SEARCH_MAX = 30;
const DATE_ERROR = "Fechas invalidas; usa YYYY-MM-DD.";

function dateParts(value) {
  const m = DATE_RE.exec(String(value ?? "").trim());
  return m ? { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]) } : null;
}

// Exclusive day-after boundary for an inclusive "to" date (pure calendar math).
function dayAfter(y, mo, d) {
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: pure calendar-date arithmetic, no instant involved
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

function monthRange(month) {
  const [y, mo] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  return { start, end };
}

// -> { start, end } (end exclusive) | { error }
function resolveExplicitRange(from, to) {
  const f = dateParts(from);
  const t = dateParts(to);
  if (!f || !t) return { error: DATE_ERROR };
  const fKey = Date.UTC(f.y, f.mo - 1, f.d);
  const tKey = Date.UTC(t.y, t.mo - 1, t.d);
  const dayCount = Math.round((tKey - fKey) / 86_400_000) + 1;
  if (dayCount < 1) return { error: "'to' debe ser igual o posterior a 'from'." };
  if (dayCount > MAX_RANGE_DAYS) return { error: `El rango maximo es ${MAX_RANGE_DAYS} dias.` };
  return { start: `${from}`, end: dayAfter(t.y, t.mo, t.d) };
}

// Search tools accept month, or from/to, or default to the current month.
function resolveSearchRange(args) {
  if (MONTH_RE.test(String(args?.month ?? ""))) return monthRange(args.month);
  if (args?.from || args?.to) {
    if (!args?.from || !args?.to) return { error: "Indica 'from' y 'to', o 'month'." };
    return resolveExplicitRange(args.from, args.to);
  }
  return monthRange(toLocalMonth());
}

// Aggregate tools require an explicit from/to.
function resolveSummaryRange(args) {
  if (!args?.from || !args?.to) return { error: "'from' y 'to' son requeridos (YYYY-MM-DD)." };
  return resolveExplicitRange(args.from, args.to);
}

function occurredOnKey(row) {
  const v = row.occurred_on;
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date occurredOn
  return (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10);
}

const GROUP_LABEL = {
  category: Prisma.sql`COALESCE(c.name, 'Sin categoria')`,
  month: Prisma.sql`to_char(m.occurred_on, 'YYYY-MM')`,
  merchant: Prisma.sql`COALESCE(m.merchant, '(sin comercio)')`,
  wallet: Prisma.sql`w.name`,
};

export function createPfmMiraiQueries({ prisma, summary, wallets, budgets, categories }) {
  async function readableWalletIds(actx) {
    const r = await wallets.listWallets({ companyId: actx.companyId, actorId: actx.actorProfileId });
    return (r.data ?? []).map((w) => w.id);
  }

  const pfm_overview = {
    name: "pfm_overview",
    permission: "pfm.wallets.read",
    definition: {
      description: "Resumen financiero del usuario para un mes: saldo total, disponible, deuda de tarjetas, inversiones, gasto e ingreso del mes, mes anterior y gasto por categoria.",
      parameters: {
        type: "object",
        properties: { month: { type: "string", description: "Mes YYYY-MM. Por defecto el mes en curso." } },
      },
    },
    async run(args, actx) {
      const month = MONTH_RE.test(String(args?.month ?? "")) ? args.month : toLocalMonth();
      return summary.getOverview({ companyId: actx.companyId, actorId: actx.actorProfileId, month });
    },
  };

  const pfm_list_wallets = {
    name: "pfm_list_wallets",
    permission: "pfm.wallets.read",
    definition: {
      description: "Lista las carteras del usuario (propias y compartidas) con saldo, tipo y moneda.",
      parameters: { type: "object", properties: {} },
    },
    async run(_args, actx) {
      const r = await wallets.listWallets({ companyId: actx.companyId, actorId: actx.actorProfileId });
      return (r.data ?? []).map((w) => ({
        walletId: w.id,
        name: w.name,
        kind: w.kind,
        currency: w.currency,
        balance: w.currentBalance,
        creditLimit: w.creditLimit ?? null,
        bankLinked: Boolean(w.ledgerAccountId),
      }));
    },
  };

  const pfm_search_movements = {
    name: "pfm_search_movements",
    permission: "pfm.movements.read",
    definition: {
      description: "Busca movimientos del usuario a traves de TODAS sus carteras, con totales exactos por moneda. Filtra por rango de fechas (o mes), cartera, categoria, direccion, estado o texto.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Fecha YYYY-MM-DD, inicio (inclusive)." },
          to: { type: "string", description: "Fecha YYYY-MM-DD, fin (inclusive)." },
          month: { type: "string", description: "YYYY-MM; alternativa a from/to. Por defecto el mes en curso." },
          walletId: { type: "string" },
          categoryId: { type: "string" },
          direction: { type: "string", enum: ["EXPENSE", "INCOME"] },
          status: { type: "string", enum: ["PENDING", "POSTED", "SKIPPED"] },
          search: { type: "string", description: "Texto a buscar en comercio o nota." },
        },
      },
    },
    async run(args, actx) {
      const range = resolveSearchRange(args);
      if (range.error) return { error: range.error };
      const walletIds = await readableWalletIds(actx);
      if (!walletIds.length) return { total: 0, sums: [], movimientos: [] };
      const walletId = args?.walletId && UUID_RE.test(args.walletId) ? args.walletId : null;
      if (walletId && !walletIds.includes(walletId)) return { error: "Cartera no encontrada." };
      const categoryId = args?.categoryId && UUID_RE.test(args.categoryId) ? args.categoryId : null;
      const direction = args?.direction === "EXPENSE" || args?.direction === "INCOME" ? args.direction : null;
      const status = ["PENDING", "POSTED", "SKIPPED"].includes(args?.status) ? args.status : null;
      const search = typeof args?.search === "string" && args.search.trim() ? args.search.trim() : null;

      const sumRows = await prisma.$queryRaw`
        SELECT w.currency AS moneda, COUNT(*)::int AS cantidad,
          COALESCE(SUM(m.amount) FILTER (WHERE m.direction = 'EXPENSE'), 0) AS gasto,
          COALESCE(SUM(m.amount) FILTER (WHERE m.direction = 'INCOME'), 0) AS ingreso
        FROM pfm_movement m
        JOIN pfm_wallet w ON w.id = m.wallet_id
        WHERE m.company_id = ${actx.companyId}::uuid
          AND m.wallet_id = ANY(${walletIds}::uuid[])
          AND m.enabled = true
          AND (${walletId}::uuid IS NULL OR m.wallet_id = ${walletId}::uuid)
          AND (${categoryId}::uuid IS NULL OR m.category_id = ${categoryId}::uuid)
          AND (${direction}::text IS NULL OR m.direction::text = ${direction}::text)
          AND (${status}::text IS NULL OR m.status::text = ${status}::text)
          AND (${search}::text IS NULL OR m.merchant ILIKE '%' || ${search} || '%' OR m.note ILIKE '%' || ${search} || '%')
          AND m.occurred_on >= ${range.start}::date AND m.occurred_on < ${range.end}::date
        GROUP BY w.currency
      `;
      const rows = await prisma.$queryRaw`
        SELECT m.id, w.name AS wallet_name, w.currency, c.name AS category_name,
               m.occurred_on, m.amount, m.direction, m.merchant, m.status
        FROM pfm_movement m
        JOIN pfm_wallet w ON w.id = m.wallet_id
        LEFT JOIN pfm_category c ON c.id = m.category_id
        WHERE m.company_id = ${actx.companyId}::uuid
          AND m.wallet_id = ANY(${walletIds}::uuid[])
          AND m.enabled = true
          AND (${walletId}::uuid IS NULL OR m.wallet_id = ${walletId}::uuid)
          AND (${categoryId}::uuid IS NULL OR m.category_id = ${categoryId}::uuid)
          AND (${direction}::text IS NULL OR m.direction::text = ${direction}::text)
          AND (${status}::text IS NULL OR m.status::text = ${status}::text)
          AND (${search}::text IS NULL OR m.merchant ILIKE '%' || ${search} || '%' OR m.note ILIKE '%' || ${search} || '%')
          AND m.occurred_on >= ${range.start}::date AND m.occurred_on < ${range.end}::date
        ORDER BY m.occurred_on DESC, m.created_at DESC
        LIMIT ${SEARCH_MAX}
      `;
      return {
        total: sumRows.reduce((s, r) => s + Number(r.cantidad), 0),
        sums: sumRows.map((r) => ({
          moneda: r.moneda,
          gasto: toPlainNumber(r.gasto),
          ingreso: toPlainNumber(r.ingreso),
          cantidad: Number(r.cantidad),
        })),
        movimientos: rows.map((r) => ({
          movementId: r.id,
          cartera: r.wallet_name,
          categoria: r.category_name ?? null,
          fecha: occurredOnKey(r),
          monto: toPlainNumber(r.amount),
          moneda: r.currency,
          direccion: r.direction,
          comercio: r.merchant ?? null,
          estado: r.status,
        })),
      };
    },
  };

  const pfm_spending_summary = {
    name: "pfm_spending_summary",
    permission: "pfm.movements.read",
    definition: {
      description: "Totales exactos de movimientos (POSTED) agrupados por categoria, mes, comercio o cartera, siempre separados por moneda. Puede comparar contra el periodo anterior de igual duracion.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Fecha YYYY-MM-DD, inicio (inclusive)." },
          to: { type: "string", description: "Fecha YYYY-MM-DD, fin (inclusive)." },
          groupBy: { type: "string", enum: ["category", "month", "merchant", "wallet"] },
          direction: { type: "string", enum: ["EXPENSE", "INCOME"], description: "Por defecto EXPENSE." },
          compareWithPrevious: { type: "boolean" },
        },
        required: ["from", "to", "groupBy"],
      },
    },
    async run(args, actx) {
      if (!Object.hasOwn(GROUP_LABEL, String(args?.groupBy))) return { error: "groupBy debe ser category, month, merchant o wallet." };
      const range = resolveSummaryRange(args);
      if (range.error) return { error: range.error };
      const direction = args?.direction === "INCOME" ? "INCOME" : "EXPENSE";
      const walletIds = await readableWalletIds(actx);
      if (!walletIds.length) return { grupos: [] };

      async function grouped(start, end) {
        const groupExpr = GROUP_LABEL[args.groupBy];
        const rows = await prisma.$queryRaw`
          SELECT ${groupExpr} AS grupo, w.currency AS moneda, COALESCE(SUM(m.amount), 0) AS total
          FROM pfm_movement m
          JOIN pfm_wallet w ON w.id = m.wallet_id
          LEFT JOIN pfm_category c ON c.id = m.category_id
          WHERE m.company_id = ${actx.companyId}::uuid
            AND m.wallet_id = ANY(${walletIds}::uuid[])
            AND m.enabled = true AND m.status = 'POSTED' AND m.is_adjustment = false
            AND m.direction = ${direction}
            AND m.occurred_on >= ${start}::date AND m.occurred_on < ${end}::date
          GROUP BY ${groupExpr}, w.currency
        `;
        return new Map(rows.map((r) => [`${r.grupo}||${r.moneda}`, toPlainNumber(r.total)]));
      }

      const actual = await grouped(range.start, range.end);
      if (!args?.compareWithPrevious) {
        return {
          grupos: [...actual.entries()]
            .map(([key, total]) => {
              const [grupo, moneda] = key.split("||");
              return { grupo, moneda, total };
            })
            .sort((a, b) => b.total - a.total),
        };
      }

      const f = dateParts(range.start);
      const lengthDays = Math.round((Date.UTC(dateParts(range.end).y, dateParts(range.end).mo - 1, dateParts(range.end).d) - Date.UTC(f.y, f.mo - 1, f.d)) / 86_400_000);
      const prevEnd = range.start;
      // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: pure calendar-date arithmetic, no instant involved
      const prevStart = new Date(Date.UTC(f.y, f.mo - 1, f.d - lengthDays)).toISOString().slice(0, 10);
      const anterior = await grouped(prevStart, prevEnd);

      const keys = new Set([...actual.keys(), ...anterior.keys()]);
      const grupos = [...keys].map((key) => {
        const [grupo, moneda] = key.split("||");
        const act = actual.get(key) ?? 0;
        const ant = anterior.get(key) ?? 0;
        const diferencia = Math.round((act - ant) * 100) / 100;
        const porcentaje = ant === 0 ? null : Math.round((diferencia / ant) * 10000) / 100;
        return { grupo, moneda, actual: act, anterior: ant, diferencia, porcentaje };
      });
      grupos.sort((a, b) => b.actual - a.actual);
      return { grupos };
    },
  };

  const pfm_budgets = {
    name: "pfm_budgets",
    permission: "pfm.movements.read",
    definition: {
      description: "Presupuestos del usuario por categoria, con lo gastado y el porcentaje del mes.",
      parameters: { type: "object", properties: { month: { type: "string", description: "YYYY-MM" } } },
    },
    async run(args, actx) {
      const month = MONTH_RE.test(String(args?.month ?? "")) ? args.month : undefined;
      return budgets.listBudgets({ companyId: actx.companyId, actorId: actx.actorProfileId, month });
    },
  };

  const pfm_upcoming = {
    name: "pfm_upcoming",
    permission: "pfm.movements.read",
    definition: {
      description: "Cargos y movimientos pendientes en los proximos N dias (por defecto 14, maximo 60).",
      parameters: { type: "object", properties: { days: { type: "number" } } },
    },
    async run(args, actx) {
      const days = Math.min(60, Math.max(1, Number(args?.days) || 14));
      return summary.getUpcoming({ companyId: actx.companyId, actorId: actx.actorProfileId, days });
    },
  };

  const pfm_categories = {
    name: "pfm_categories",
    permission: "pfm.categories.read",
    definition: {
      description: "Categorias de gasto o ingreso disponibles para el usuario.",
      parameters: { type: "object", properties: { kind: { type: "string", enum: ["EXPENSE", "INCOME"] } } },
    },
    async run(args, actx) {
      const kind = args?.kind === "EXPENSE" || args?.kind === "INCOME" ? args.kind : undefined;
      const r = await categories.listCategories({ companyId: actx.companyId, actorId: actx.actorProfileId, kind });
      return (r.data ?? []).map((c) => ({ categoryId: c.id, name: c.name, kind: c.kind }));
    },
  };

  return [pfm_overview, pfm_list_wallets, pfm_search_movements, pfm_spending_summary, pfm_budgets, pfm_upcoming, pfm_categories];
}
