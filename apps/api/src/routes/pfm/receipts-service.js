// apps/api/src/routes/pfm/receipts-service.js
import { prepareVisionImage } from "../../services/vision-image.js";
export { prepareVisionImage } from "../../services/vision-image.js";
import { PfmServiceError, isTableNotFoundError } from "./service-helpers.js";

const NOT_INSTALLED = "El modulo de finanzas personales no esta instalado.";
const MAX_ATTEMPTS = 3;

export function createReceiptsService({
  prisma,
  vision,
  supabaseAdmin,
  movements,
  wallets,
  filesService,
}) {
  async function createReceipt({ companyId, actorId, fileId }) {
    try {
      return await prisma.pfmReceipt.create({
        data: {
          companyId,
          ownerId: actorId,
          fileId,
          status: "PROCESSING",
          provider: vision?.provider ?? "groq",
        },
      });
    } catch (err) {
      if (isTableNotFoundError(err)) throw new PfmServiceError(NOT_INSTALLED, 503);
      throw err;
    }
  }

  async function listReceipts({ companyId, actorId }) {
    if (!actorId) throw new PfmServiceError("Se requiere un usuario autenticado.", 401);
    try {
      const rows = await prisma.pfmReceipt.findMany({
        where: { companyId, ownerId: actorId, enabled: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return { data: rows.map(shape) };
    } catch (err) {
      if (isTableNotFoundError(err)) throw new PfmServiceError(NOT_INSTALLED, 503);
      throw err;
    }
  }

  async function getReceipt({ companyId, actorId, receiptId }) {
    const row = await prisma.pfmReceipt.findFirst({
      where: { id: receiptId, companyId, ownerId: actorId, enabled: true },
    });
    if (!row) throw new PfmServiceError("Ticket no encontrado.", 404);
    return shape(row);
  }

  // Worker entrypoint — one receipt.
  async function processReceipt({ receiptId }) {
    const receipt = await prisma.pfmReceipt.findUnique({ where: { id: receiptId } });
    if (!receipt || receipt.status !== "PROCESSING") return { skipped: true };
    const attempts = (receipt.attempts ?? 0) + 1;
    try {
      const file = await prisma.fileAsset.findUnique({ where: { id: receipt.fileId } });
      if (!file) throw new Error("archivo del ticket no encontrado");
      const dl = await supabaseAdmin.storage.from(file.bucket).download(file.objectKey);
      if (dl.error || !dl.data) throw new Error("no se pudo descargar la imagen del ticket");
      const buf = Buffer.from(await dl.data.arrayBuffer());
      const visionBuf = await prepareVisionImage(buf);
      const { parsed, rawResponse, model } = await vision.extractReceipt({
        imageBase64: visionBuf.toString("base64"),
        mimeType: "image/jpeg",
      });
      await prisma.pfmReceipt.update({
        where: { id: receiptId },
        data: { status: "PARSED", parsed, rawResponse, model, attempts, errorReason: null },
      });
      return { status: "PARSED" };
    } catch (err) {
      const finalFail = attempts >= MAX_ATTEMPTS;
      await prisma.pfmReceipt.update({
        where: { id: receiptId },
        data: {
          status: finalFail ? "FAILED" : "PROCESSING",
          attempts,
          errorReason: String(err?.message ?? err).slice(0, 500),
        },
      });
      return { status: finalFail ? "FAILED" : "PROCESSING" };
    }
  }

  async function confirmReceipt({ companyId, actorId, receiptId, data }) {
    const receipt = await prisma.pfmReceipt.findFirst({
      where: { id: receiptId, companyId, ownerId: actorId, enabled: true },
    });
    if (!receipt) throw new PfmServiceError("Ticket no encontrado.", 404);
    if (receipt.status === "CONFIRMED") {
      throw new PfmServiceError("Este ticket ya fue registrado.", 409);
    }
    const movement = await movements.createMovement({
      companyId,
      actorId,
      walletId: data.walletId,
      data: {
        direction: data.direction,
        amount: data.amount,
        occurredOn: data.occurredOn,
        categoryId: data.categoryId ?? null,
        merchant: data.merchant ?? null,
        note: data.note ?? null,
        receiptId,
        status: "POSTED",
      },
    });
    const updated = await prisma.pfmReceipt.update({
      where: { id: receiptId },
      data: { status: "CONFIRMED", movementId: movement.id },
    });
    return { receipt: shape(updated), movementId: movement.id };
  }

  async function retryReceipt({ companyId, actorId, receiptId }) {
    const receipt = await prisma.pfmReceipt.findFirst({
      where: { id: receiptId, companyId, ownerId: actorId, enabled: true },
    });
    if (!receipt) throw new PfmServiceError("Ticket no encontrado.", 404);
    if (receipt.status !== "FAILED") {
      throw new PfmServiceError("Solo se puede reintentar un ticket con error.", 409);
    }
    const updated = await prisma.pfmReceipt.update({
      where: { id: receiptId },
      data: { status: "PROCESSING", attempts: 0, errorReason: null },
    });
    return shape(updated);
  }

  async function processPendingBatch({ limit = 5 } = {}) {
    let rows;
    try {
      rows = await prisma.pfmReceipt.findMany({
        where: { status: "PROCESSING", enabled: true, attempts: { lt: MAX_ATTEMPTS } },
        orderBy: { createdAt: "asc" },
        take: limit,
        select: { id: true },
      });
    } catch (err) {
      if (isTableNotFoundError(err)) return { processed: 0 };
      throw err;
    }
    let processed = 0;
    for (const r of rows) {
      try {
        await processReceipt({ receiptId: r.id });
        processed += 1;
      } catch (err) {
        console.error("[runly.pfm] processReceipt failed", r.id, err?.message ?? err);
      }
    }
    return { processed };
  }

  return {
    createReceipt,
    listReceipts,
    getReceipt,
    processReceipt,
    processPendingBatch,
    confirmReceipt,
    retryReceipt,
  };
}

function shape(row) {
  return {
    id: row.id,
    fileId: row.fileId ?? row.file_id,
    status: row.status,
    provider: row.provider,
    model: row.model ?? null,
    parsed: row.parsed ?? null,
    movementId: row.movementId ?? row.movement_id ?? null,
    errorReason: row.errorReason ?? row.error_reason ?? null,
    attempts: row.attempts ?? 0,
    createdAt: row.createdAt ?? row.created_at,
  };
}
