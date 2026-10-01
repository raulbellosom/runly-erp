// apps/api/src/routes/purchases/mirai-actions.js
//
// runly.purchases actions MirAI can propose (spec 2026-09-30-mirai-remaining-
// modules §Track B). prepare() resolves names -> ids without writing;
// execute() goes through the same services the HTTP routes use
// (services/purchase-procurement-service.js, services/purchase-receipts-
// service.js), which already perform their own audit log + broadcast
// internally — no inline route side effects to extract (unlike calendar;
// routes/purchases/*-routes.js add nothing of their own after the service
// call, so there is no M-effects.js here).
//
// Map:
//   POST /purchases/requests                -> procurement.createRequest()   perm purchases.request.create
//   POST /purchases/approvals/:id/decide    -> procurement.decideApproval()  perm purchases.approval.decide
//   POST /purchases/receipts                -> receipts.create()            perm purchases.receipt.create
//
// Omitted (documented, not cleanly supported by a single conversational
// action — see the implementation report):
//   - Creating/approving purchase orders, quotes, invoices and payments:
//     each has its own multi-field workflow (lines, supplier selection,
//     policy checks) that does not reduce to a short confirm card.
//   - Partial, per-line receipt quantities: purchases_receipt_register always
//     receives the full pending quantity of every line on the order (the
//     common "ya llego la orden completa" case); a partial receipt still
//     requires the Recepciones screen.
import { z } from "zod";

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];
const optText = (max) => z.string().trim().max(max).nullable().optional();

const createRequestArgs = z.object({
  title: z.string().trim().min(1).max(255),
  justification: optText(2000),
  neededBy: optText(10),
  priority: z.enum(PRIORITIES).optional(),
  estimatedTotal: z.number().positive().optional(),
});
const decideApprovalArgs = z.object({
  approvalId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: optText(1000),
});
const registerReceiptArgs = z.object({
  orderId: z.string().min(1).optional(),
  orderNumber: z.string().trim().min(1).max(40).optional(),
  notes: optText(2000),
});

export function createPurchasesMiraiActions({ prisma, procurement, receipts }) {
  async function resolveOrder(companyId, { orderId, orderNumber }) {
    const where = orderId ? { id: orderId, companyId } : orderNumber ? { number: orderNumber, companyId } : null;
    if (!where) return { error: "Indica el orderId o el numero de la orden (de purchases_search_documents)." };
    const order = await prisma.purchaseOrder.findFirst({ where });
    if (!order) return { error: "No encontre esa orden de compra, o no pertenece a esta empresa." };
    return { order };
  }

  const createRequest = {
    key: "purchases.request.create",
    moduleKey: "runly.purchases",
    operation: "create",
    label: "Crear solicitud de compra",
    permission: "purchases.request.create",
    description: "Crea una solicitud de compra en borrador (sin conceptos de linea; se completan despues en Compras).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        justification: { type: "string" },
        neededBy: { type: "string", description: "Fecha local YYYY-MM-DD en que se necesita." },
        priority: { type: "string", enum: PRIORITIES },
        estimatedTotal: { type: "number" },
      },
      required: ["title"],
    },
    async prepare(args) {
      const parsed = createRequestArgs.safeParse(args);
      if (!parsed.success) return { error: "Falta el titulo de la solicitud." };
      const a = parsed.data;
      return {
        input: { title: a.title, justification: a.justification ?? null, neededBy: a.neededBy ?? null, priority: a.priority ?? "NORMAL", estimatedTotal: a.estimatedTotal ?? 0 },
        preview: {
          title: "Crear solicitud de compra",
          fields: [
            { label: "Titulo", value: a.title },
            { label: "Prioridad", value: a.priority ?? "NORMAL" },
            a.neededBy ? { label: "Se necesita", value: a.neededBy } : null,
            a.estimatedTotal ? { label: "Total estimado", value: String(a.estimatedTotal) } : null,
            a.justification ? { label: "Justificacion", value: a.justification } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const request = await procurement.createRequest(actx.companyId, actx.actorProfileId, input);
      return { id: request.id, summary: `Solicitud de compra creada: ${request.number} (${request.title})`, link: `/app/m/runly.purchases/requests/${request.id}` };
    },
  };

  const decideApproval = {
    key: "purchases.approval.decide",
    moduleKey: "runly.purchases",
    operation: "update",
    label: "Decidir aprobacion de compra",
    permission: "purchases.approval.decide",
    description: "Aprueba o rechaza una aprobacion de compras pendiente. Requiere el approvalId de purchases_list_approvals. Las aprobaciones de compras no estan asignadas a una persona especifica: cualquiera con permiso para decidir puede hacerlo, igual que en la pantalla de Aprobaciones.",
    parameters: {
      type: "object",
      properties: {
        approvalId: { type: "string" },
        decision: { type: "string", enum: ["APPROVED", "REJECTED"] },
        comment: { type: "string" },
      },
      required: ["approvalId", "decision"],
    },
    async prepare(args, actx) {
      const parsed = decideApprovalArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el approvalId (de purchases_list_approvals) y la decision (APPROVED o REJECTED)." };
      const a = parsed.data;
      const approval = await prisma.purchaseApproval.findFirst({ where: { id: a.approvalId, companyId: actx.companyId } });
      if (!approval) return { error: "No encontre esa aprobacion, o no pertenece a esta empresa." };
      if (approval.status !== "PENDING") return { error: "Esa aprobacion ya fue resuelta." };
      return {
        input: { approvalId: approval.id, decision: a.decision, comment: a.comment ?? null },
        targetId: approval.id,
        preview: {
          title: a.decision === "APPROVED" ? "Aprobar" : "Rechazar",
          fields: [
            { label: "Motivo", value: approval.reason ?? "(sin motivo)" },
            a.comment ? { label: "Comentario", value: a.comment } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const result = await procurement.decideApproval(actx.companyId, actx.actorProfileId, input.approvalId, { decision: input.decision, comment: input.comment });
      return { id: result.id, summary: `Aprobacion ${input.decision === "APPROVED" ? "aprobada" : "rechazada"}.` };
    },
  };

  const registerReceipt = {
    key: "purchases.receipt.create",
    moduleKey: "runly.purchases",
    operation: "create",
    label: "Registrar recepcion de compra",
    permission: "purchases.receipt.create",
    description: "Registra la recepcion completa (todas las cantidades pendientes) de una orden de compra emitida. Requiere el orderId o numero de orden de purchases_search_documents.",
    parameters: {
      type: "object",
      properties: { orderId: { type: "string" }, orderNumber: { type: "string" }, notes: { type: "string" } },
    },
    async prepare(args, actx) {
      const parsed = registerReceiptArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica la orden a recibir (orderId o numero)." };
      const a = parsed.data;
      const found = await resolveOrder(actx.companyId, a);
      if (found.error) return { error: found.error };
      const { order } = found;
      if (!["ISSUED", "PARTIALLY_RECEIVED"].includes(order.status)) return { error: "Solo se pueden recibir ordenes emitidas." };
      const orderLines = await prisma.purchaseLine.findMany({ where: { companyId: actx.companyId, ownerType: "PURCHASE_ORDER", ownerId: order.id } });
      const pending = orderLines
        .map((line) => ({ orderLineId: line.id, description: line.description, quantity: Math.round((Number(line.quantity) - Number(line.receivedQuantity)) * 10000) / 10000 }))
        .filter((line) => line.quantity > 0);
      if (!pending.length) return { error: "Esa orden ya fue recibida por completo." };
      return {
        input: { orderId: order.id, lines: pending.map(({ orderLineId, quantity }) => ({ orderLineId, quantity })), notes: a.notes ?? null },
        preview: {
          title: "Registrar recepcion",
          fields: [
            { label: "Orden", value: order.number },
            ...pending.map((line) => ({ label: line.description || "Concepto", value: `${line.quantity}` })),
          ],
        },
      };
    },
    async execute(input, actx) {
      const receipt = await receipts.create(actx.companyId, actx.actorProfileId, input);
      return { id: receipt.id, summary: `Recepcion ${receipt.number} registrada.`, link: `/app/m/runly.purchases/receipts/${receipt.id}` };
    },
  };

  return [createRequest, decideApproval, registerReceipt];
}
