// apps/api/src/routes/purchases/purchases-mirai-queries.js
//
// Exact runly.purchases tools for MirAI (spec 2026-09-30-mirai-remaining-
// modules §3 purchases): pending actions, document search, the approvals
// inbox and a spend summary with period comparison. Aggregates are computed
// in SQL/Prisma or exact JS arithmetic over the filtered rows, never left
// for the model to add up from a partial list.
import { toLocalIso } from "@runly/core";
import { KINDS, num, supplierNames } from "../../services/purchases-shared.js";
import { createPublicLookup } from "../../services/ai/public-lookup.js";

const LIST_MAX = 30;
const CASE_GATE = ["requests", "quotes", "approvals"];
const SEARCHABLE_KINDS = ["requests", "quotes", "orders", "receipts", "invoices", "cases"];
const SPEND_KINDS = { invoices: "purchaseInvoice", orders: "purchaseOrder" };
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function gateFor(kind) {
  return kind === "cases" ? CASE_GATE : KINDS[kind].capability;
}

function parseDateOnly(value) {
  if (!DATE_RE.test(String(value ?? ""))) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Current quarter (or the explicit from/to) and the immediately preceding
// period of the same length, for "este trimestre vs el anterior" questions.
function resolveRange(from, to) {
  if (from || to) {
    const start = parseDateOnly(from);
    const toDate = parseDateOnly(to ?? from);
    if (!start || !toDate) return { error: "Fechas invalidas; usa YYYY-MM-DD." };
    const end = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
    const prevEnd = start;
    const prevStart = new Date(start.getTime() - (end.getTime() - start.getTime()));
    return { current: { start, end }, previous: { start: prevStart, end: prevEnd } };
  }
  const today = new Date(`${toLocalIso()}T00:00:00.000Z`);
  const quarter = Math.floor(today.getUTCMonth() / 3);
  const start = new Date(Date.UTC(today.getUTCFullYear(), quarter * 3, 1));
  const end = new Date(Date.UTC(today.getUTCFullYear(), quarter * 3 + 3, 1));
  const prevStart = new Date(Date.UTC(today.getUTCFullYear(), quarter * 3 - 3, 1));
  return { current: { start, end }, previous: { start: prevStart, end: start } };
}

function sumByDimension(rows, dimension, names) {
  const groups = new Map();
  let total = 0;
  for (const row of rows) {
    const amount = num(row.total);
    total += amount;
    const key = dimension === "supplier" ? (names.get(row.supplierId) ?? "(sin proveedor)")
      : dimension === "status" ? row.status
      : String(row.issueDate ?? "").slice(0, 7);
    const currency = row.currency ?? "MXN";
    const groupKey = `${key}|${currency}`;
    groups.set(groupKey, (groups.get(groupKey) ?? 0) + amount);
  }
  const grupos = [...groups.entries()]
    .map(([key, amount]) => {
      const [grupo, moneda] = key.split("|");
      return { grupo, moneda, total: Math.round(amount * 100) / 100 };
    })
    .sort((a, b) => b.total - a.total);
  return { total: Math.round(total * 100) / 100, grupos };
}

export function createPurchasesMiraiQueries({ prisma, workflow, procurement, listing, assistantContext, publicLookup = createPublicLookup({ env: process.env }) }) {
  async function resolveSupplier(companyId, supplierName) {
    if (!supplierName) return { supplierId: undefined };
    const matches = await prisma.contact.findMany({
      where: { companyId, enabled: true, name: { contains: String(supplierName), mode: "insensitive" } },
      select: { id: true, name: true },
      take: 5,
    });
    if (matches.length === 1) return { supplierId: matches[0].id };
    if (!matches.length) return { error: `No encontre ningun proveedor llamado "${supplierName}".` };
    return { error: `Hay varios proveedores que coinciden con "${supplierName}": ${matches.map((m) => m.name).join(", ")}.` };
  }

  const purchases_pending = {
    name: "purchases_pending",
    permission: "purchases.read",
    definition: {
      description: "Que hay pendiente en Compras: aprobaciones por decidir, ordenes en borrador, facturas vencidas y ordenes por recibir.",
      parameters: { type: "object", properties: {} },
    },
    async run(args, actx) {
      const data = await assistantContext.pendingActions(actx.companyId);
      return {
        aprobacionesPendientes: data.pendingApprovals,
        ordenesEnBorrador: data.draftOrders,
        facturasVencidas: data.overdueInvoices,
        ordenesPorRecibir: data.awaitingReceipt,
      };
    },
  };

  const purchases_search_documents = {
    name: "purchases_search_documents",
    permission: "purchases.read",
    definition: {
      description: "Busca expedientes, solicitudes, cotizaciones, ordenes, recepciones o facturas de compras por numero, proveedor o estado.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: SEARCHABLE_KINDS, description: "Tipo de documento (por defecto orders)." },
          search: { type: "string", description: "Texto libre: numero de folio, referencia o notas." },
          status: { type: "string", description: "Uno o varios estados separados por coma (ej. DRAFT,ISSUED)." },
          supplierName: { type: "string", description: "Nombre del proveedor." },
        },
      },
    },
    async run(args, actx) {
      const kind = SEARCHABLE_KINDS.includes(args?.kind) ? args.kind : "orders";
      const supplier = await resolveSupplier(actx.companyId, args?.supplierName);
      if (supplier.error) return { error: supplier.error };
      try {
        await workflow.assertCapability(actx.companyId, gateFor(kind));
      } catch (err) {
        return { error: err.message ?? "Esta funcion esta deshabilitada en el flujo de compras." };
      }
      const result = await listing.list(kind, actx.companyId, { search: args?.search, status: args?.status, supplierId: supplier.supplierId, pageSize: LIST_MAX });
      return {
        total: result.total,
        documentos: result.data.slice(0, LIST_MAX).map((row) => ({
          documentId: row.id,
          numero: row.number,
          estado: row.status,
          proveedor: row.supplierName ?? null,
          total: row.total ?? null,
          moneda: row.currency ?? null,
          fecha: row.date ?? null,
          link: row.path,
        })),
      };
    },
  };

  const purchases_list_approvals = {
    name: "purchases_list_approvals",
    permission: "purchases.approval.decide",
    definition: {
      description: "Lista las aprobaciones de compras pendientes de decision, con su id, documento, proveedor y motivo.",
      parameters: { type: "object", properties: {} },
    },
    async run(args, actx) {
      let result;
      try {
        result = await procurement.listApprovals(actx.companyId, { status: "PENDING", pageSize: LIST_MAX });
      } catch (err) {
        return { error: err.message ?? "No se pudieron cargar las aprobaciones." };
      }
      return {
        total: result.total,
        aprobaciones: result.data.slice(0, LIST_MAX).map((a) => ({
          approvalId: a.id,
          tipo: a.ownerKind,
          numero: a.ownerNumber,
          proveedor: a.supplierName,
          total: a.ownerTotal,
          moneda: a.currency,
          motivo: a.reason,
          expediente: a.caseNumber,
          link: a.ownerPath,
        })),
      };
    },
  };

  const purchases_spend_summary = {
    name: "purchases_spend_summary",
    permission: "purchases.read",
    definition: {
      description: "Totales exactos de compras (facturadas u ordenadas), comparados contra el periodo anterior de la misma duracion (por defecto, este trimestre vs el anterior). Agrupa por proveedor, mes o estado.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["invoices", "orders"], description: "Documento a sumar (por defecto facturas, si estan habilitadas)." },
          supplierName: { type: "string" },
          from: { type: "string", description: "Fecha local YYYY-MM-DD, inicio del periodo actual (opcional)." },
          to: { type: "string", description: "Fecha local YYYY-MM-DD, fin del periodo actual (opcional)." },
          groupBy: { type: "string", enum: ["supplier", "month", "status"], description: "Como agrupar (por defecto supplier)." },
        },
      },
    },
    async run(args, actx) {
      const caps = await workflow.getCapabilities(actx.companyId).catch(() => ({ capabilities: {} }));
      const kind = ["invoices", "orders"].includes(args?.kind) ? args.kind : (caps.capabilities.invoices !== false ? "invoices" : "orders");
      const model = SPEND_KINDS[kind];
      const groupBy = ["supplier", "month", "status"].includes(args?.groupBy) ? args.groupBy : "supplier";
      const supplier = await resolveSupplier(actx.companyId, args?.supplierName);
      if (supplier.error) return { error: supplier.error };
      const range = resolveRange(args?.from, args?.to);
      if (range.error) return { error: range.error };

      const select = { supplierId: true, total: true, currency: true, status: true, issueDate: true };
      const baseWhere = { companyId: actx.companyId, status: { notIn: ["CANCELLED", "DRAFT"] }, ...(supplier.supplierId ? { supplierId: supplier.supplierId } : {}) };
      const [currentRows, previousRows] = await Promise.all([
        prisma[model].findMany({ where: { ...baseWhere, issueDate: { gte: range.current.start, lt: range.current.end } }, select }),
        prisma[model].findMany({ where: { ...baseWhere, issueDate: { gte: range.previous.start, lt: range.previous.end } }, select }),
      ]);
      const names = await supplierNames(prisma, actx.companyId, [...currentRows, ...previousRows].map((r) => r.supplierId));
      const actual = sumByDimension(currentRows, groupBy, names);
      const anterior = sumByDimension(previousRows, groupBy, names);
      const variacionPct = anterior.total > 0 ? Math.round(((actual.total - anterior.total) / anterior.total) * 10000) / 100 : null;
      return { documento: kind, actual, anterior, variacionPct };
    },
  };

  const purchases_public_supplier_info = {
    name: "purchases_public_supplier_info",
    permission: "purchases.supplier.read",
    definition: {
      description: "Busca en internet informacion publica (sitio web) de un proveedor. Solo cuando el usuario lo pida explicitamente; nunca envia correos ni telefonos.",
      parameters: { type: "object", properties: { supplierId: { type: "string" } }, required: ["supplierId"] },
    },
    async run(args, actx) {
      if (!publicLookup?.enabled) return { error: "La busqueda en internet no esta configurada." };
      const supplier = await prisma.contact.findFirst({ where: { id: String(args?.supplierId ?? ""), companyId: actx.companyId }, select: { id: true, name: true, website: true } });
      if (!supplier) return { error: "No encontre ese proveedor, o no pertenece a esta empresa." };
      actx.turn ??= {};
      actx.turn.purchasesPublicLookupBudget ??= publicLookup.createTurnBudget();
      return publicLookup.lookup({ subject: { name: supplier.name, website: supplier.website }, budget: actx.turn.purchasesPublicLookupBudget });
    },
  };

  return [purchases_pending, purchases_search_documents, purchases_list_approvals, purchases_spend_summary, purchases_public_supplier_info];
}
