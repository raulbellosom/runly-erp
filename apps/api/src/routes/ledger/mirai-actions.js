// apps/api/src/routes/ledger/mirai-actions.js
//
// runly.ledger actions MirAI can propose (spec 2026-09-30-mirai-ledger-hr-
// fleet §3). prepare() validates and resolves an account name/id -> account
// without writing; execute() goes through ledger-service.js + ledger-
// effects.js, exactly like the HTTP routes in ./accounts-routes.js. The
// statement-import action reuses ai-import-recognize.js's
// recognizeStatementFile() (the same pipeline POST /ledger/imports/recognize
// runs) and ai-import-service.js's commit() (the same one POST
// /ledger/imports/commit runs).
//
// Map (routes/ledger/accounts-routes.js -> services):
//   POST  /ledger/accounts/:id/transactions              -> ledgerService.createTransaction()    perm ledger.transactions.create -> ledgerEffects.afterCreateTransaction
//   PATCH /ledger/accounts/:id/transactions/:txId         -> ledgerService.updateTransaction()    perm ledger.transactions.update (route has no activity effect — see ledger-effects.js)
//   PATCH /ledger/accounts/:id/transactions/:txId/enabled -> ledgerService.setTransactionEnabled() perm ledger.transactions.delete -> ledgerEffects.afterSetTransactionEnabled
// MirAI's delete action soft-deletes (enabled: false) — ledger transactions
// have no hard-delete route to mirror.
//
//   POST /ledger/imports/recognize -> ai-import-recognize.js's recognizeStatementFile() perm ledger.import
//   POST /ledger/imports/commit    -> aiImportService.commit()                          perm ledger.import
// The statement-import action's prepare() runs the recognize pipeline itself
// (no signed proof-token round-trip like the HTTP flow needs): the recognized
// rows are produced and stored server-side as the proposal's own input between
// prepare and execute, never echoed back by an untrusted client. Known limit
// inherited from the shared pipeline: duplicate-detection only runs against
// the account the document's own text auto-detects (ai-import-service.js's
// recognize()), which may differ from the account the caller explicitly named
// here — the exact same limitation the HTTP upload flow has when a user
// manually picks a different account than the one auto-detected.
import { z } from "zod";
import crypto from "node:crypto";
import { actorContext } from "../calendar/calendar-event-effects.js";
import { readableAccounts, resolveAccountFilter } from "./ledger-mirai-queries.js";
import { recognizeStatementFile } from "./ai-import-recognize.js";

const MAX_IMPORT_BYTES = 15 * 1024 * 1024;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const optText = (max) => z.string().trim().max(max).nullable().optional();

function money(amount, currency) {
  return `$${Number(amount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
}

// ledger_transaction.fecha is @db.Date -> comes back as a JS Date from
// $queryRaw; normalize to the same "YYYY-MM-DD" shape args use, same pattern
// as ai-import-dedup.js's normalizeFecha.
function fechaKey(value) {
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date row value
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value ?? "").slice(0, 10);
}

const createArgs = z.object({
  accountId: z.string().min(1).optional(),
  accountName: z.string().trim().min(1).max(200).optional(),
  fecha: z.string().regex(ISO_DATE_RE, "Fecha debe ser YYYY-MM-DD."),
  nombre: z.string().trim().min(1).max(255),
  referencia: optText(255),
  concepto: optText(512),
  numero: optText(64),
  deposito: z.number().min(0).optional(),
  retiro: z.number().min(0).optional(),
  categoryId: z.string().uuid().optional(),
}).refine((d) => (d.deposito ?? 0) > 0 || (d.retiro ?? 0) > 0, { message: "Se requiere deposito o retiro mayor a cero." });

const updateArgs = z.object({
  transactionId: z.string().min(1),
  fecha: z.string().regex(ISO_DATE_RE).optional(),
  nombre: z.string().trim().min(1).max(255).optional(),
  referencia: optText(255),
  concepto: optText(512),
  numero: optText(64),
  deposito: z.number().min(0).optional(),
  retiro: z.number().min(0).optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

const deleteArgs = z.object({ transactionId: z.string().min(1) });

const importArgs = z.object({
  attachmentId: z.string().min(1),
  account: z.string().trim().min(1).max(200),
});

export function createLedgerMiraiActions({ prisma, ledgerService, effects, attachmentAccess, aiImportService, aiRouter }) {
  // Resolves { accountId, accountName } to a WRITABLE account — the same
  // canWriteAccount check accounts-routes.js runs before every transaction
  // write — or an error.
  async function resolveWritableAccount(actx, args) {
    const accounts = await readableAccounts(ledgerService, actx);
    const resolved = resolveAccountFilter(args, accounts);
    if (resolved.error) return { error: resolved.error };
    if (!resolved.account) return { error: "Indica la cuenta (accountId de ledger_accounts, o su nombre/banco)." };
    const canWrite = await ledgerService.canWriteAccount({ companyId: actx.companyId, accountId: resolved.account.id, actorId: actx.actorProfileId });
    if (!canWrite) return { error: "No tienes permisos para registrar movimientos en esa cuenta." };
    return { account: resolved.account };
  }

  // Loads a transaction the caller can write to (scoped by company + the same
  // canWriteAccount check the update/enabled routes run), given only a
  // transactionId — accounts-routes.js always has :id from the URL, but a
  // MirAI action only gets the transactionId ledger_search_transactions
  // returned.
  async function loadWritableTransaction(actx, transactionId) {
    if (!UUID_RE.test(String(transactionId ?? ""))) {
      return { error: "transactionId invalido. Usa ledger_search_transactions para obtenerlo." };
    }
    const [tx] = await prisma.$queryRaw`
      SELECT * FROM ledger_transaction WHERE id = ${transactionId}::uuid AND company_id = ${actx.companyId}::uuid
    `;
    if (!tx) return { error: "No encontre ese movimiento, o no pertenece a esta empresa. Usa ledger_search_transactions para obtener su transactionId." };
    const canWrite = await ledgerService.canWriteAccount({ companyId: actx.companyId, accountId: tx.account_id, actorId: actx.actorProfileId });
    if (!canWrite) return { error: "No tienes permisos para modificar movimientos de esa cuenta." };
    return { tx };
  }

  const create = {
    key: "ledger.transaction.create",
    moduleKey: "runly.ledger",
    operation: "create",
    label: "Registrar movimiento",
    permission: "ledger.transactions.create",
    description: "Registra un deposito o retiro en una cuenta. Indica la cuenta (accountId o nombre/banco), fecha, nombre y el monto (deposito o retiro).",
    parameters: {
      type: "object",
      properties: {
        accountId: { type: "string" },
        accountName: { type: "string", description: "Nombre o banco de la cuenta, si no tienes su accountId." },
        fecha: { type: "string", description: "Fecha YYYY-MM-DD." },
        nombre: { type: "string" },
        referencia: { type: "string" },
        concepto: { type: "string" },
        numero: { type: "string" },
        deposito: { type: "number" },
        retiro: { type: "number" },
        categoryId: { type: "string" },
      },
      required: ["fecha", "nombre"],
    },
    async prepare(args, actx) {
      const parsed = createArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica cuenta, fecha, nombre y un deposito o retiro mayor a cero." };
      const a = parsed.data;
      const found = await resolveWritableAccount(actx, a);
      if (found.error) return { error: found.error };
      const account = found.account;
      return {
        input: {
          accountId: account.id,
          data: {
            fecha: a.fecha, numero: a.numero ?? null, nombre: a.nombre,
            referencia: a.referencia ?? null, concepto: a.concepto ?? null,
            deposito: a.deposito ?? null, retiro: a.retiro ?? null, category_id: a.categoryId ?? null,
          },
        },
        preview: {
          title: "Registrar movimiento",
          fields: [
            { label: "Cuenta", value: `${account.name} (${account.bank})` },
            { label: "Fecha", value: a.fecha },
            { label: "Nombre", value: a.nombre },
            a.deposito ? { label: "Deposito", value: money(a.deposito, account.currency) } : null,
            a.retiro ? { label: "Retiro", value: money(a.retiro, account.currency) } : null,
            a.concepto ? { label: "Concepto", value: a.concepto } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const tx = await ledgerService.createTransaction({ companyId: actx.companyId, accountId: input.accountId, data: input.data });
      await effects.afterCreateTransaction(actorContext({ companyId: actx.companyId, profile: actx.actorProfile }), tx);
      return { id: tx.id, summary: `Movimiento registrado: ${tx.nombre}`, link: `/app/m/runly.ledger/accounts/${input.accountId}` };
    },
  };

  const update = {
    key: "ledger.transaction.update",
    moduleKey: "runly.ledger",
    operation: "update",
    label: "Editar movimiento",
    permission: "ledger.transactions.update",
    description: "Cambia los datos de un movimiento existente. Usa el transactionId de ledger_search_transactions; envia solo los campos que cambian.",
    parameters: {
      type: "object",
      properties: {
        transactionId: { type: "string" },
        fecha: { type: "string" },
        nombre: { type: "string" },
        referencia: { type: "string" },
        concepto: { type: "string" },
        numero: { type: "string" },
        deposito: { type: "number" },
        retiro: { type: "number" },
        categoryId: { type: "string" },
      },
      required: ["transactionId"],
    },
    async prepare(args, actx) {
      const parsed = updateArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el transactionId y los campos a cambiar." };
      const a = parsed.data;
      const found = await loadWritableTransaction(actx, a.transactionId);
      if (found.error) return { error: found.error };
      const tx = found.tx;
      const currentFecha = fechaKey(tx.fecha);
      const data = {};
      const fields = [{ label: "Movimiento", value: tx.nombre }];
      if (a.fecha !== undefined && a.fecha !== currentFecha) {
        data.fecha = a.fecha;
        fields.push({ label: "Fecha", before: currentFecha, value: a.fecha });
      }
      if (a.nombre !== undefined && a.nombre !== tx.nombre) {
        data.nombre = a.nombre;
        fields.push({ label: "Nombre", before: tx.nombre, value: a.nombre });
      }
      if (a.referencia !== undefined && (a.referencia ?? null) !== (tx.referencia ?? null)) {
        data.referencia = a.referencia ?? null;
        fields.push({ label: "Referencia", before: tx.referencia ?? "(vacio)", value: a.referencia ?? "(vacio)" });
      }
      if (a.concepto !== undefined && (a.concepto ?? null) !== (tx.concepto ?? null)) {
        data.concepto = a.concepto ?? null;
        fields.push({ label: "Concepto", before: tx.concepto ?? "(vacio)", value: a.concepto ?? "(vacio)" });
      }
      if (a.numero !== undefined && (a.numero ?? null) !== (tx.numero ?? null)) {
        data.numero = a.numero ?? null;
        fields.push({ label: "Numero", before: tx.numero ?? "(vacio)", value: a.numero ?? "(vacio)" });
      }
      if (a.deposito !== undefined && Number(a.deposito) !== Number(tx.deposito ?? 0)) {
        data.deposito = a.deposito;
        fields.push({ label: "Deposito", before: tx.deposito != null ? String(tx.deposito) : "(vacio)", value: String(a.deposito) });
      }
      if (a.retiro !== undefined && Number(a.retiro) !== Number(tx.retiro ?? 0)) {
        data.retiro = a.retiro;
        fields.push({ label: "Retiro", before: tx.retiro != null ? String(tx.retiro) : "(vacio)", value: String(a.retiro) });
      }
      if (a.categoryId !== undefined && (a.categoryId ?? null) !== (tx.category_id ?? null)) {
        data.category_id = a.categoryId ?? null;
        fields.push({ label: "Categoria", before: tx.category_id ?? "(ninguna)", value: a.categoryId ?? "(ninguna)" });
      }
      if (!Object.keys(data).length) return { error: "No indicaste ningun cambio respecto al movimiento actual." };
      return { input: { accountId: tx.account_id, transactionId: tx.id, data }, preview: { title: "Editar movimiento", fields }, targetId: tx.id };
    },
    async execute(input, actx) {
      const tx = await ledgerService.updateTransaction({ companyId: actx.companyId, accountId: input.accountId, transactionId: input.transactionId, data: input.data });
      // accounts-routes.js's PATCH .../transactions/:txId does not publish an
      // activity entry either — see ledger-effects.js's note on this.
      return { id: tx.id, summary: `Movimiento actualizado: ${tx.nombre}`, link: `/app/m/runly.ledger/accounts/${input.accountId}` };
    },
  };

  const remove = {
    key: "ledger.transaction.delete",
    moduleKey: "runly.ledger",
    operation: "delete",
    label: "Eliminar movimiento",
    permission: "ledger.transactions.delete",
    description: "Elimina (deshabilita) un movimiento existente. Usa el transactionId de ledger_search_transactions.",
    parameters: { type: "object", properties: { transactionId: { type: "string" } }, required: ["transactionId"] },
    async prepare(args, actx) {
      const parsed = deleteArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el transactionId del movimiento a eliminar." };
      const found = await loadWritableTransaction(actx, parsed.data.transactionId);
      if (found.error) return { error: found.error };
      const tx = found.tx;
      return {
        input: { accountId: tx.account_id, transactionId: tx.id },
        targetId: tx.id,
        preview: { title: "Eliminar movimiento", fields: [{ label: "Nombre", value: tx.nombre }, { label: "Fecha", value: fechaKey(tx.fecha) }] },
      };
    },
    async execute(input, actx) {
      const tx = await ledgerService.setTransactionEnabled({ companyId: actx.companyId, accountId: input.accountId, transactionId: input.transactionId, enabled: false });
      await effects.afterSetTransactionEnabled(actorContext({ companyId: actx.companyId, profile: actx.actorProfile }), tx);
      return { id: tx.id, summary: `Movimiento eliminado: ${tx.nombre}` };
    },
  };

  const importStatement = {
    key: "ledger.statement.import",
    moduleKey: "runly.ledger",
    operation: "create",
    label: "Importar estado de cuenta",
    permission: "ledger.import",
    description: "Analiza un estado de cuenta adjunto en el chat (PDF, imagen, CSV o XLSX) y propone los movimientos a importar en una cuenta. Usa el attachmentId del archivo.",
    parameters: {
      type: "object",
      properties: {
        attachmentId: { type: "string" },
        account: { type: "string", description: "Nombre, banco o accountId de la cuenta destino." },
      },
      required: ["attachmentId", "account"],
    },
    async prepare(args, actx) {
      if (!attachmentAccess) return { error: "La importacion de adjuntos no esta disponible aqui." };
      const parsed = importArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el attachmentId del archivo y la cuenta destino." };
      const a = parsed.data;
      const accounts = await readableAccounts(ledgerService, actx);
      const filter = UUID_RE.test(a.account) ? { accountId: a.account } : { accountName: a.account };
      const resolved = resolveAccountFilter(filter, accounts);
      if (resolved.error) return { error: resolved.error };
      if (!resolved.account) return { error: "Indica la cuenta destino." };
      const account = resolved.account;
      const canWrite = await ledgerService.canWriteAccount({ companyId: actx.companyId, accountId: account.id, actorId: actx.actorProfileId });
      if (!canWrite) return { error: "No tienes permisos para importar movimientos en esa cuenta." };

      let file;
      try {
        file = await attachmentAccess.fetchForActor(a.attachmentId, actx.turn ?? actx, { maxBytes: MAX_IMPORT_BYTES });
      } catch (err) {
        return { error: String(err?.message ?? err).slice(0, 200) };
      }

      let recognized;
      try {
        recognized = await recognizeStatementFile({
          buffer: file.buffer, filename: file.name, mimeType: file.mimeType,
          companyId: actx.companyId, actorId: actx.actorProfileId, service: aiImportService, aiRouter,
        });
      } catch (err) {
        return { error: String(err?.message ?? err).slice(0, 200) };
      }

      const rows = recognized.rows ?? [];
      if (!rows.length) return { error: "No encontre movimientos reconocibles en ese archivo." };
      const dates = rows.map((r) => r.fecha).filter(Boolean).sort();
      const duplicates = rows.filter((r) => r.possibleDuplicate).length;
      const totalDeposito = rows.reduce((s, r) => s + (Number(r.deposito) || 0), 0);
      const totalRetiro = rows.reduce((s, r) => s + (Number(r.retiro) || 0), 0);
      const batchKey = crypto.randomUUID();

      return {
        input: { accountId: account.id, batchKey, rows },
        preview: {
          title: "Importar estado de cuenta",
          fields: [
            { label: "Cuenta", value: `${account.name} (${account.bank})` },
            { label: "Archivo", value: file.name },
            { label: "Movimientos reconocidos", value: String(rows.length) },
            dates.length ? { label: "Rango de fechas", value: `${dates[0]} a ${dates[dates.length - 1]}` } : null,
            { label: "Total depositos", value: money(totalDeposito, account.currency) },
            { label: "Total retiros", value: money(totalRetiro, account.currency) },
            duplicates ? { label: "Posibles duplicados (se omiten)", value: String(duplicates) } : null,
          ].filter(Boolean),
          rows: rows.slice(0, 10).map((r) => ({
            fecha: r.fecha, nombre: r.nombre, deposito: r.deposito ?? null, retiro: r.retiro ?? null,
            duplicado: Boolean(r.possibleDuplicate),
          })),
        },
      };
    },
    async execute(input, actx) {
      const result = await aiImportService.commit({
        companyId: actx.companyId, actorId: actx.actorProfileId,
        accountId: input.accountId, batchKey: input.batchKey, rows: input.rows,
      });
      return {
        id: input.accountId,
        summary: `Importacion completada: ${result.inserted} movimiento(s) registrados, ${result.skipped} omitidos.`,
        link: `/app/m/runly.ledger/accounts/${input.accountId}`,
      };
    },
  };

  return [create, update, remove, importStatement];
}
