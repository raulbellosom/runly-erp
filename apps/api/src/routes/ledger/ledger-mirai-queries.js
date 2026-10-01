// apps/api/src/routes/ledger/ledger-mirai-queries.js
//
// Exact runly.ledger tools for MirAI (spec 2026-09-30-mirai-ledger-hr-fleet
// §3): accounts with balances (replaces the retired core `list_bank_accounts`),
// cross-account transaction search, income/expense summary with previous-
// period comparison, and categories. Every tool is scoped to the accounts the
// caller can read (ledgerService.listAccounts — the same owner/member/group
// visibility rule used by the HTTP routes), and amounts are always grouped by
// currency, never summed across currencies. Aggregates are computed in SQL,
// never derived by the model from a partial list.
import { Prisma } from "@prisma/client";

const SEARCH_MAX = 30;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_ERROR = "Fechas invalidas; usa YYYY-MM-DD.";
const MAX_RANGE_DAYS = 1100; // ~3 years

function num(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function dateKey(value) {
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date row value
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function dayAfter(isoDate) {
  const [y, mo, d] = isoDate.split("-").map(Number);
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: pure calendar-date arithmetic, no instant involved
  return new Date(Date.UTC(y, mo - 1, d + 1)).toISOString().slice(0, 10);
}

// -> { start, end } (end exclusive) | { error }
function resolveExplicitRange(from, to) {
  if (!ISO_DATE_RE.test(String(from ?? "")) || !ISO_DATE_RE.test(String(to ?? ""))) return { error: DATE_ERROR };
  const fKey = Date.parse(`${from}T00:00:00Z`);
  const tKey = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fKey) || !Number.isFinite(tKey)) return { error: DATE_ERROR };
  const dayCount = Math.round((tKey - fKey) / 86_400_000) + 1;
  if (dayCount < 1) return { error: "'to' debe ser igual o posterior a 'from'." };
  if (dayCount > MAX_RANGE_DAYS) return { error: `El rango maximo es ${MAX_RANGE_DAYS} dias.` };
  return { start: String(from), end: dayAfter(String(to)) };
}

const GROUP_LABEL = {
  category: Prisma.sql`COALESCE(c.name, 'Sin categoria')`,
  month: Prisma.sql`to_char(t.fecha, 'YYYY-MM')`,
  account: Prisma.sql`a.name`,
};

// Accounts the actor can read, via ledgerService.listAccounts's own
// owner/member/group visibility rule (the same one the HTTP routes use).
// Exported so mirai-actions.js resolves accounts the same way.
export async function readableAccounts(ledgerService, actx) {
  const { data } = await ledgerService.listAccounts({ companyId: actx.companyId, actorId: actx.actorProfileId });
  return data ?? [];
}

// Resolves an optional { accountId, accountName } filter down to a single
// account within the caller's readable accounts, or null (no filter, every
// readable account, only used by the read tools — actions always require one).
// Ambiguous names -> error listing the candidates, same pattern as
// contacts_search's resolveContact.
export function resolveAccountFilter(args, accounts) {
  if (args?.accountId) {
    const match = accounts.find((a) => a.id === String(args.accountId));
    if (!match) return { error: "No encontre esa cuenta, o no tienes acceso a ella. Usa ledger_accounts para ver tus cuentas." };
    return { account: match };
  }
  if (args?.accountName) {
    const q = String(args.accountName).trim().toLowerCase();
    const matches = accounts.filter((a) => a.name.toLowerCase().includes(q) || String(a.bank ?? "").toLowerCase().includes(q));
    if (!matches.length) return { error: `No encontre ninguna cuenta llamada "${args.accountName}".` };
    if (matches.length > 1) return { error: `Hay varias cuentas que coinciden con "${args.accountName}": ${matches.map((a) => `${a.name} (${a.bank})`).join(", ")}.` };
    return { account: matches[0] };
  }
  return { account: null };
}

export function createLedgerMiraiQueries({ prisma, ledgerService, categoriesService }) {
  const ledger_accounts = {
    name: "ledger_accounts",
    permission: "ledger.accounts.read",
    definition: {
      description: "Lista las cuentas (bancarias o de efectivo) que el usuario puede ver, con su saldo actual exacto. Ej: 'cuanto tenemos en el banco', 'saldo de BBVA'.",
      parameters: { type: "object", properties: {} },
    },
    async run(_args, actx) {
      const accounts = await readableAccounts(ledgerService, actx);
      return {
        cuentas: accounts.map((a) => ({
          accountId: a.id,
          nombre: a.name,
          banco: a.bank,
          moneda: a.currency,
          saldo: num(a.current_balance),
        })),
      };
    },
  };

  const ledger_search_transactions = {
    name: "ledger_search_transactions",
    permission: "ledger.transactions.read",
    definition: {
      description: "Busca movimientos (depositos/retiros) en las cuentas del usuario, con totales exactos por moneda. Filtra por cuenta, rango de fechas, tipo, categoria, texto o rango de monto.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          accountName: { type: "string", description: "Nombre o banco de la cuenta, si no tienes su accountId." },
          from: { type: "string", description: "Fecha YYYY-MM-DD, inicio (inclusive)." },
          to: { type: "string", description: "Fecha YYYY-MM-DD, fin (inclusive)." },
          type: { type: "string", description: "Codigo o nombre del tipo de movimiento." },
          category: { type: "string", description: "Nombre de la categoria (o su categoryId de ledger_categories)." },
          search: { type: "string", description: "Texto a buscar en nombre, referencia o concepto." },
          minAmount: { type: "number" },
          maxAmount: { type: "number" },
        },
      },
    },
    async run(args, actx) {
      const accounts = await readableAccounts(ledgerService, actx);
      if (!accounts.length) return { total: 0, sums: [], movimientos: [] };
      const resolved = resolveAccountFilter(args, accounts);
      if (resolved.error) return { error: resolved.error };
      const accountIds = resolved.account ? [resolved.account.id] : accounts.map((a) => a.id);

      let from = null;
      let to = null;
      if (args?.from || args?.to) {
        if (!args?.from || !args?.to) return { error: "Indica 'from' y 'to' juntos, o ninguno." };
        const range = resolveExplicitRange(args.from, args.to);
        if (range.error) return { error: range.error };
        from = range.start;
        to = args.to; // listTransactions-style inclusive upper bound in the WHERE below uses <=
      }
      const type = typeof args?.type === "string" && args.type.trim() ? args.type.trim() : null;
      const category = typeof args?.category === "string" && args.category.trim() ? args.category.trim() : null;
      const categoryId = category && UUID_RE.test(category) ? category : null;
      const categoryName = category && !categoryId ? category : null;
      const search = typeof args?.search === "string" && args.search.trim() ? args.search.trim() : null;
      const minAmount = Number.isFinite(Number(args?.minAmount)) ? Number(args.minAmount) : null;
      const maxAmount = Number.isFinite(Number(args?.maxAmount)) ? Number(args.maxAmount) : null;

      const sumRows = await prisma.$queryRaw`
        SELECT a.currency AS moneda, COUNT(*)::int AS cantidad,
          COALESCE(SUM(t.deposito), 0) AS deposito, COALESCE(SUM(t.retiro), 0) AS retiro
        FROM ledger_transaction t
        JOIN ledger_account a ON a.id = t.account_id
        LEFT JOIN ledger_transaction_type tt ON tt.id = t.tipo_id
        LEFT JOIN ledger_category c ON c.id = t.category_id AND (c.owner_id IS NULL OR c.owner_id = ${actx.actorProfileId}::uuid)
        WHERE t.company_id = ${actx.companyId}::uuid
          AND t.account_id = ANY(${accountIds}::uuid[])
          AND t.enabled = true
          AND (${from}::date IS NULL OR t.fecha >= ${from}::date)
          AND (${to}::date   IS NULL OR t.fecha <= ${to}::date)
          AND (${type}::text IS NULL OR tt.code ILIKE ${type} OR tt.name ILIKE '%' || ${type} || '%')
          AND (${categoryId}::uuid IS NULL OR t.category_id = ${categoryId}::uuid)
          AND (${categoryName}::text IS NULL OR c.name ILIKE '%' || ${categoryName} || '%')
          AND (${search}::text IS NULL OR t.nombre ILIKE '%' || ${search} || '%' OR t.referencia ILIKE '%' || ${search} || '%' OR t.concepto ILIKE '%' || ${search} || '%')
          AND (${minAmount}::numeric IS NULL OR COALESCE(t.deposito, 0) + COALESCE(t.retiro, 0) >= ${minAmount}::numeric)
          AND (${maxAmount}::numeric IS NULL OR COALESCE(t.deposito, 0) + COALESCE(t.retiro, 0) <= ${maxAmount}::numeric)
        GROUP BY a.currency
      `;
      const rows = await prisma.$queryRaw`
        SELECT t.id, t.fecha, t.nombre, t.referencia, t.concepto, t.deposito, t.retiro,
               a.name AS account_name, a.currency AS currency,
               tt.name AS tipo_name, c.name AS category_name
        FROM ledger_transaction t
        JOIN ledger_account a ON a.id = t.account_id
        LEFT JOIN ledger_transaction_type tt ON tt.id = t.tipo_id
        LEFT JOIN ledger_category c ON c.id = t.category_id AND (c.owner_id IS NULL OR c.owner_id = ${actx.actorProfileId}::uuid)
        WHERE t.company_id = ${actx.companyId}::uuid
          AND t.account_id = ANY(${accountIds}::uuid[])
          AND t.enabled = true
          AND (${from}::date IS NULL OR t.fecha >= ${from}::date)
          AND (${to}::date   IS NULL OR t.fecha <= ${to}::date)
          AND (${type}::text IS NULL OR tt.code ILIKE ${type} OR tt.name ILIKE '%' || ${type} || '%')
          AND (${categoryId}::uuid IS NULL OR t.category_id = ${categoryId}::uuid)
          AND (${categoryName}::text IS NULL OR c.name ILIKE '%' || ${categoryName} || '%')
          AND (${search}::text IS NULL OR t.nombre ILIKE '%' || ${search} || '%' OR t.referencia ILIKE '%' || ${search} || '%' OR t.concepto ILIKE '%' || ${search} || '%')
          AND (${minAmount}::numeric IS NULL OR COALESCE(t.deposito, 0) + COALESCE(t.retiro, 0) >= ${minAmount}::numeric)
          AND (${maxAmount}::numeric IS NULL OR COALESCE(t.deposito, 0) + COALESCE(t.retiro, 0) <= ${maxAmount}::numeric)
        ORDER BY t.fecha DESC, t.position DESC
        LIMIT ${SEARCH_MAX}
      `;
      return {
        total: sumRows.reduce((s, r) => s + Number(r.cantidad), 0),
        sums: sumRows.map((r) => ({ moneda: r.moneda, deposito: num(r.deposito), retiro: num(r.retiro), cantidad: Number(r.cantidad) })),
        movimientos: rows.map((r) => ({
          transactionId: r.id,
          fecha: dateKey(r.fecha),
          nombre: r.nombre,
          referencia: r.referencia ?? null,
          concepto: r.concepto ?? null,
          deposito: r.deposito != null ? num(r.deposito) : null,
          retiro: r.retiro != null ? num(r.retiro) : null,
          cuenta: r.account_name,
          moneda: r.currency,
          tipo: r.tipo_name ?? null,
          categoria: r.category_name ?? null,
        })),
      };
    },
  };

  const ledger_summary = {
    name: "ledger_summary",
    permission: "ledger.transactions.read",
    definition: {
      description: "Totales exactos de depositos y retiros agrupados por categoria, mes o cuenta, siempre separados por moneda. Puede comparar contra el periodo anterior de igual duracion.",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "Fecha YYYY-MM-DD, inicio (inclusive)." },
          to: { type: "string", description: "Fecha YYYY-MM-DD, fin (inclusive)." },
          groupBy: { type: "string", enum: ["category", "month", "account"] },
          accountId: { type: "string" },
          accountName: { type: "string" },
          compareWithPrevious: { type: "boolean" },
        },
        required: ["from", "to", "groupBy"],
      },
    },
    async run(args, actx) {
      if (!Object.hasOwn(GROUP_LABEL, String(args?.groupBy))) return { error: "groupBy debe ser category, month o account." };
      const range = resolveExplicitRange(args?.from, args?.to);
      if (range.error) return { error: range.error };
      const accounts = await readableAccounts(ledgerService, actx);
      if (!accounts.length) return { grupos: [] };
      const resolved = resolveAccountFilter(args, accounts);
      if (resolved.error) return { error: resolved.error };
      const accountIds = resolved.account ? [resolved.account.id] : accounts.map((a) => a.id);

      async function grouped(start, end) {
        const groupExpr = GROUP_LABEL[args.groupBy];
        const rows = await prisma.$queryRaw`
          SELECT ${groupExpr} AS grupo, a.currency AS moneda,
            COALESCE(SUM(t.deposito), 0) AS deposito, COALESCE(SUM(t.retiro), 0) AS retiro
          FROM ledger_transaction t
          JOIN ledger_account a ON a.id = t.account_id
          LEFT JOIN ledger_category c ON c.id = t.category_id AND (c.owner_id IS NULL OR c.owner_id = ${actx.actorProfileId}::uuid)
          WHERE t.company_id = ${actx.companyId}::uuid
            AND t.account_id = ANY(${accountIds}::uuid[])
            AND t.enabled = true
            AND t.fecha >= ${start}::date AND t.fecha < ${end}::date
          GROUP BY ${groupExpr}, a.currency
        `;
        return new Map(rows.map((r) => [`${r.grupo}||${r.moneda}`, { deposito: num(r.deposito), retiro: num(r.retiro) }]));
      }

      const actual = await grouped(range.start, range.end);
      if (!args?.compareWithPrevious) {
        return {
          grupos: [...actual.entries()]
            .map(([key, totals]) => {
              const [grupo, moneda] = key.split("||");
              return { grupo, moneda, deposito: totals.deposito, retiro: totals.retiro };
            })
            .sort((a, b) => (b.deposito + b.retiro) - (a.deposito + a.retiro)),
        };
      }

      const lengthDays = Math.round((Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86_400_000);
      const prevEnd = range.start;
      const [y, mo, d] = range.start.split("-").map(Number);
      // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: pure calendar-date arithmetic, no instant involved
      const prevStart = new Date(Date.UTC(y, mo - 1, d - lengthDays)).toISOString().slice(0, 10);
      const anterior = await grouped(prevStart, prevEnd);

      const keys = new Set([...actual.keys(), ...anterior.keys()]);
      const grupos = [...keys].map((key) => {
        const [grupo, moneda] = key.split("||");
        const act = actual.get(key) ?? { deposito: 0, retiro: 0 };
        const ant = anterior.get(key) ?? { deposito: 0, retiro: 0 };
        return {
          grupo, moneda,
          deposito: act.deposito, retiro: act.retiro,
          depositoAnterior: ant.deposito, retiroAnterior: ant.retiro,
        };
      });
      grupos.sort((a, b) => (b.deposito + b.retiro) - (a.deposito + a.retiro));
      return { grupos };
    },
  };

  const ledger_categories = {
    name: "ledger_categories",
    permission: "ledger.categories.read",
    definition: {
      description: "Categorias disponibles para clasificar movimientos (propias del usuario y del sistema).",
      parameters: { type: "object", properties: {} },
    },
    async run(_args, actx) {
      const { data } = await categoriesService.listCategories({ companyId: actx.companyId, actorId: actx.actorProfileId });
      return {
        categorias: data.map((c) => ({ categoryId: c.id, nombre: c.name, tipo: c.kind, sistema: Boolean(c.is_system) })),
      };
    },
  };

  return [ledger_accounts, ledger_search_transactions, ledger_summary, ledger_categories];
}
