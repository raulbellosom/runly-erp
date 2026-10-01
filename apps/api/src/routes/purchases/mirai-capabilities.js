// apps/api/src/routes/purchases/mirai-capabilities.js
//
// runly.purchases capability for MirAI (spec 2026-09-30-mirai-remaining-
// modules §Track B). Reuses createPurchasesServices() from ./index.js — the
// same factory routes/purchases/index.js uses to build its router — so the
// workflow/procurement/receipts/listing services (and their audit+broadcast
// side effects) are wired identically for MirAI and for HTTP.
import { createPurchasesServices } from "./index.js";
import { createPurchasesAssistantContext } from "../../services/purchases-assistant-context.js";
import { createPurchasesMiraiQueries } from "./purchases-mirai-queries.js";
import { createPurchasesMiraiActions } from "./mirai-actions.js";

export function createPurchasesMiraiCapabilities({ prisma, broadcaster = null }) {
  const services = createPurchasesServices({ prisma, broadcaster });
  const { workflow, procurement, receipts, listing } = services;
  const assistantContext = createPurchasesAssistantContext({ prisma });

  return {
    moduleKey: "runly.purchases",
    label: "Compras",
    summary: "Solicitudes, ordenes, recepciones y facturas de compra: pendientes, busqueda y gasto por proveedor; crear solicitudes, decidir aprobaciones y registrar recepciones.",
    tools: createPurchasesMiraiQueries({ prisma, workflow, procurement, listing, assistantContext }),
    actions: createPurchasesMiraiActions({ prisma, procurement, receipts }),
    publicLookup: [{ model: "supplier", publicFields: ["name", "website"] }],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType !== "document" || !pageContext.recordId) return null;
      const id = String(pageContext.recordId);
      for (const kind of ["orders", "invoices", "requests", "receipts", "cases"]) {
        const model = { orders: "purchaseOrder", invoices: "purchaseInvoice", requests: "purchaseRequest", receipts: "purchaseReceipt", cases: "purchaseCase" }[kind];
        const row = await prisma[model].findFirst({ where: { id, companyId: actx.companyId } }).catch(() => null);
        if (row) {
          const label = row.number ?? row.title ?? id;
          return `El usuario esta viendo el documento de compras "${label}" (documentId ${id}), tipo ${kind}, estado ${row.status}.`;
        }
      }
      return null;
    },
  };
}
