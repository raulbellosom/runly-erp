import { Hono } from "hono";
import {
  createAccountSchema,
  updateAccountSchema,
  setAccountGroupSchema,
  createTransactionSchema,
  updateTransactionSchema,
  enabledSchema,
} from "./validators.js";
import { createLedgerService, LedgerServiceError } from "./ledger-service.js";
import { createSummaryService } from "./summary-service.js";
import {
  publishActivityFromContext,
  getActivityContext,
} from "../../services/activity-publisher.js";
// export-service and import-service use optional heavy deps (exceljs, pdfkit, csv-parse)
// that may not be hoisted in every workspace context — load them lazily so auth tests
// can import this router without triggering package resolution at module load time.
import { getCompanyId, getActorId, getValidationErrorMessage } from "./service-helpers.js";

const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

function handleError(c, err, fallback) {
  if (err instanceof LedgerServiceError)
    return c.json({ error: err.message }, err.status);
  if (err instanceof SyntaxError)
    return c.json({ error: 'El cuerpo de la solicitud no es JSON valido.' }, 400);
  if (process.env.NODE_ENV !== "production")
    console.error("[runly.ledger]", err);
  return c.json({ error: fallback }, 500);
}

export function createAccountsRouter({ prisma, requirePermission }) {
  const app = new Hono();
  const service = createLedgerService({ prisma });
  const summary = createSummaryService({ prisma });

  // ── Accounts ──────────────────────────────────────────────────────────────

  app.get(
    "/ledger/accounts",
    requirePermission("ledger.accounts.read"),
    async (c) => {
      try {
        return c.json(
          await service.listAccounts({ companyId: getCompanyId(c), actorId: getActorId(c) }),
        );
      } catch (err) {
        return handleError(c, err, "No se pudieron listar las cuentas.");
      }
    },
  );

  app.post(
    "/ledger/accounts",
    requirePermission("ledger.accounts.create"),
    async (c) => {
      try {
        const parsed = createAccountSchema.safeParse(await c.req.json());
        if (!parsed.success)
          return c.json(
            { error: getValidationErrorMessage(parsed.error) },
            400,
          );
        const account = await service.createAccount({
          companyId: getCompanyId(c),
          ownerId: getActorId(c),
          data: parsed.data,
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "ledger.account.create",
          severity: "success",
          entityType: "FinanceAccount",
          entityId: account.id,
          summary: `${actorName} creó la cuenta "${account.name ?? ""}"`.trim(),
        });
        return c.json({ data: account }, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo crear la cuenta.");
      }
    },
  );

  app.get(
    "/ledger/accounts/:id",
    requirePermission("ledger.accounts.read"),
    async (c) => {
      try {
        return c.json({
          data: await service.getAccount({
            companyId: getCompanyId(c),
            accountId: c.req.param("id"),
            actorId: getActorId(c),
          }),
        });
      } catch (err) {
        return handleError(c, err, "No se pudo obtener la cuenta.");
      }
    },
  );

  app.patch(
    "/ledger/accounts/:id",
    requirePermission("ledger.accounts.update"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para editar esta cuenta.' }, 403)
        }
        const parsed = updateAccountSchema.safeParse(await c.req.json());
        if (!parsed.success)
          return c.json(
            { error: getValidationErrorMessage(parsed.error) },
            400,
          );
        const account = await service.updateAccount({
          companyId,
          accountId,
          data: parsed.data,
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "ledger.account.update",
          severity: "info",
          entityType: "FinanceAccount",
          entityId: accountId,
          summary:
            `${actorName} actualizó la cuenta "${account.name ?? ""}"`.trim(),
        });
        return c.json({ data: account });
      } catch (err) {
        return handleError(c, err, "No se pudo actualizar la cuenta.");
      }
    },
  );

  app.patch(
    "/ledger/accounts/:id/enabled",
    requirePermission("ledger.accounts.delete"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para modificar esta cuenta.' }, 403)
        }
        const parsed = enabledSchema.safeParse(await c.req.json());
        if (!parsed.success)
          return c.json({ error: "Se requiere { enabled: boolean }." }, 400);
        const account = await service.setAccountEnabled({
          companyId,
          accountId,
          enabled: parsed.data.enabled,
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: parsed.data.enabled
            ? "ledger.account.enable"
            : "ledger.account.disable",
          severity: parsed.data.enabled ? "info" : "warning",
          entityType: "FinanceAccount",
          entityId: c.req.param("id"),
          summary: `${actorName} ${parsed.data.enabled ? "habilitó" : "deshabilitó"} una cuenta contable`,
        });
        return c.json({ data: account });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo actualizar el estado de la cuenta.",
        );
      }
    },
  );

  app.patch(
    "/ledger/accounts/:id/group",
    requirePermission("ledger.accounts.update"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        const parsed = setAccountGroupSchema.safeParse(await c.req.json())
        if (!parsed.success)
          return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
        const account = await service.setAccountGroup({
          companyId,
          accountId,
          actorId,
          groupId: parsed.data.group_id,
        })
        return c.json({ data: account })
      } catch (err) {
        return handleError(c, err, "No se pudo actualizar el grupo de la cuenta.")
      }
    },
  )

  // ── Transactions ─────────────────────────────────────────────────────────

  app.get(
    "/ledger/accounts/:id/transactions",
    requirePermission("ledger.transactions.read"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canReadAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para ver esta cuenta.' }, 403)
        }
        const { from, to, page, pageSize, order } = c.req.query();
        return c.json(
          await service.listTransactions({
            companyId,
            accountId,
            actorId,
            dateFrom: from,
            dateTo: to,
            page,
            pageSize,
            order,
          }),
        );
      } catch (err) {
        return handleError(c, err, "No se pudieron listar los movimientos.");
      }
    },
  );

  app.get(
    "/ledger/accounts/:id/transactions/disabled",
    requirePermission("ledger.transactions.read"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canReadAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para ver esta cuenta.' }, 403)
        }
        const { page, pageSize } = c.req.query();
        return c.json(
          await service.listDisabledTransactions({ companyId, accountId, page, pageSize }),
        );
      } catch (err) {
        return handleError(c, err, "No se pudieron listar los movimientos eliminados.");
      }
    },
  );

  app.post(
    "/ledger/accounts/:id/transactions",
    requirePermission("ledger.transactions.create"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para registrar movimientos en esta cuenta.' }, 403)
        }
        const parsed = createTransactionSchema.safeParse(await c.req.json());
        if (!parsed.success)
          return c.json(
            { error: getValidationErrorMessage(parsed.error) },
            400,
          );
        const tx = await service.createTransaction({
          companyId,
          accountId,
          data: parsed.data,
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: "ledger.transaction.create",
          severity: "success",
          entityType: "FinanceTransaction",
          entityId: tx?.id ?? null,
          summary: `${actorName} registró un movimiento contable`,
        });
        return c.json({ data: tx }, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo crear el movimiento.");
      }
    },
  );

  app.patch(
    "/ledger/accounts/:id/transactions/:txId",
    requirePermission("ledger.transactions.update"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para editar movimientos de esta cuenta.' }, 403)
        }
        const parsed = updateTransactionSchema.safeParse(await c.req.json());
        if (!parsed.success)
          return c.json(
            { error: getValidationErrorMessage(parsed.error) },
            400,
          );
        return c.json({
          data: await service.updateTransaction({
            companyId,
            accountId,
            transactionId: c.req.param("txId"),
            data: parsed.data,
          }),
        });
      } catch (err) {
        return handleError(c, err, "No se pudo actualizar el movimiento.");
      }
    },
  );

  app.patch(
    "/ledger/accounts/:id/transactions/:txId/enabled",
    requirePermission("ledger.transactions.delete"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para modificar movimientos de esta cuenta.' }, 403)
        }
        const parsed = enabledSchema.safeParse(await c.req.json());
        if (!parsed.success)
          return c.json({ error: "Se requiere { enabled: boolean }." }, 400);
        const tx = await service.setTransactionEnabled({
          companyId,
          accountId,
          transactionId: c.req.param("txId"),
          enabled: parsed.data.enabled,
        });
        const { actorName } = getActivityContext(c);
        await publishActivityFromContext(prisma, c, {
          type: parsed.data.enabled
            ? "ledger.transaction.enable"
            : "ledger.transaction.disable",
          severity: parsed.data.enabled ? "info" : "warning",
          entityType: "FinanceTransaction",
          entityId: c.req.param("txId"),
          summary: `${actorName} ${parsed.data.enabled ? "reactivó" : "anuló"} un movimiento contable`,
        });
        return c.json({ data: tx });
      } catch (err) {
        return handleError(
          c,
          err,
          "No se pudo actualizar el estado del movimiento.",
        );
      }
    },
  );

  // ── Summary ───────────────────────────────────────────────────────────────

  app.get(
    "/ledger/accounts/:id/summary",
    requirePermission("ledger.accounts.read"),
    async (c) => {
      try {
        const companyId = getCompanyId(c)
        const actorId   = getActorId(c)
        const accountId = c.req.param("id")
        if (!(await service.canReadAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para ver esta cuenta.' }, 403)
        }
        const { from, to } = c.req.query();
        return c.json(
          await summary.getAccountSummary({
            companyId,
            accountId,
            actorId,
            dateFrom: from,
            dateTo: to,
          }),
        );
      } catch (err) {
        return handleError(c, err, "No se pudo obtener el resumen.");
      }
    },
  );

  // ── Export ────────────────────────────────────────────────────────────────

  app.get(
    "/ledger/accounts/:id/export/xlsx",
    requirePermission("ledger.export"),
    async (c) => {
      try {
        const { buildExcelBuffer } = await import("./export-service.js");
        const { resolveCompanyBranding } = await import(
          "../../services/pdf-branding-service.js"
        );
        const companyId = getCompanyId(c);
        const actorId = getActorId(c);
        const { from, to } = c.req.query();
        const account = await service.getAccount({
          companyId,
          accountId: c.req.param("id"),
          actorId,
        });
        const { data: rows } = await service.listTransactions({
          companyId,
          accountId: c.req.param("id"),
          actorId,
          dateFrom: from,
          dateTo: to,
          page: 1,
          pageSize: 50000,
          maxPageSize: 50000,
        });
        const branding = await resolveCompanyBranding({ prisma, companyId }).catch(
          () => undefined,
        );
        const buffer = await buildExcelBuffer({
          account,
          rows,
          branding,
          dateFrom: from,
          dateTo: to,
        });
        c.header(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        c.header(
          "Content-Disposition",
          `attachment; filename="ledger-${Date.now()}.xlsx"`,
        );
        return new Response(buffer, { status: 200, headers: c.res.headers });
      } catch (err) {
        console.error("[runly.ledger:export/xlsx]", err);
        return handleError(c, err, "No se pudo exportar el archivo Excel.");
      }
    },
  );

  app.get(
    "/ledger/accounts/:id/export/csv",
    requirePermission("ledger.export"),
    async (c) => {
      try {
        const { buildCsvString } = await import("./export-service.js");
        const companyId = getCompanyId(c);
        const actorId = getActorId(c);
        const { from, to } = c.req.query();
        await service.getAccount({ companyId, accountId: c.req.param("id"), actorId });
        const { data: rows } = await service.listTransactions({
          companyId,
          accountId: c.req.param("id"),
          actorId,
          dateFrom: from,
          dateTo: to,
          page: 1,
          pageSize: 50000,
          maxPageSize: 50000,
        });
        const csv = buildCsvString({ rows });
        c.header("Content-Type", "text/csv; charset=utf-8");
        c.header(
          "Content-Disposition",
          `attachment; filename="ledger-${Date.now()}.csv"`,
        );
        return new Response(csv, { status: 200, headers: c.res.headers });
      } catch (err) {
        console.error("[runly.ledger:export/csv]", err);
        return handleError(c, err, "No se pudo exportar el CSV.");
      }
    },
  );

  app.get(
    "/ledger/accounts/:id/export/pdf",
    requirePermission("ledger.export"),
    async (c) => {
      try {
        const { buildPdfBuffer } = await import("./export-service.js");
        const { resolveCompanyBranding } = await import(
          "../../services/pdf-branding-service.js"
        );
        const companyId = getCompanyId(c);
        const actorId = getActorId(c);
        const { from, to } = c.req.query();
        const account = await service.getAccount({
          companyId,
          accountId: c.req.param("id"),
          actorId,
        });
        const { data: rows } = await service.listTransactions({
          companyId,
          accountId: c.req.param("id"),
          actorId,
          dateFrom: from,
          dateTo: to,
          page: 1,
          pageSize: 50000,
          maxPageSize: 50000,
        });
        const branding = await resolveCompanyBranding({ prisma, companyId }).catch(
          () => undefined,
        );
        const buffer = await buildPdfBuffer({
          account,
          rows,
          branding,
          dateFrom: from,
          dateTo: to,
        });
        c.header("Content-Type", "application/pdf");
        c.header(
          "Content-Disposition",
          `attachment; filename="ledger-${Date.now()}.pdf"`,
        );
        return new Response(buffer, { status: 200, headers: c.res.headers });
      } catch (err) {
        console.error("[runly.ledger:export/pdf]", err);
        return handleError(c, err, "No se pudo exportar el PDF.");
      }
    },
  );

  // ── Import ────────────────────────────────────────────────────────────────

  app.post(
    "/ledger/accounts/:id/import/parse",
    requirePermission("ledger.import"),
    async (c) => {
      try {
        const { parseImportBuffer } = await import("./import-service.js");
        const companyId = getCompanyId(c);
        const actorId = getActorId(c);
        const accountId = c.req.param("id");
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para importar movimientos en esta cuenta.' }, 403)
        }
        const form = await c.req.formData();
        const file = form.get("file");
        if (!file || typeof file === "string" || typeof file.arrayBuffer !== "function") {
          return c.json({ error: "Adjunta un archivo." }, 400);
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        if (buffer.length > MAX_IMPORT_FILE_BYTES) {
          return c.json({ error: "El archivo excede el tamano maximo de 20MB." }, 400);
        }
        const filename = String(file.name || "").toLowerCase();
        let format = null;
        if (filename.endsWith(".csv")) format = "csv";
        else if (filename.endsWith(".xlsx")) format = "xlsx";
        if (!format) {
          return c.json({ error: "Formato no soportado. Usa CSV o XLSX." }, 400);
        }
        const rows = await parseImportBuffer(buffer, format);
        const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
        return c.json({ rows, headers });
      } catch (err) {
        return handleError(c, err, "No se pudo leer el archivo.");
      }
    },
  );

  app.post(
    "/ledger/accounts/:id/import/preview",
    requirePermission("ledger.import"),
    async (c) => {
      try {
        const { validateImportRows } = await import("./import-service.js");
        const companyId = getCompanyId(c);
        const actorId = getActorId(c);
        const accountId = c.req.param("id");
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para importar movimientos en esta cuenta.' }, 403)
        }
        const body = await c.req.json();
        const { valid, errors } = validateImportRows(
          body.rows ?? [],
          body.mapping ?? {},
        );
        return c.json({
          valid_count: valid.length,
          error_count: errors.length,
          valid,
          errors,
        });
      } catch (err) {
        return handleError(c, err, "No se pudo previsualizar la importacion.");
      }
    },
  );

  app.post(
    "/ledger/accounts/:id/import/commit",
    requirePermission("ledger.import"),
    async (c) => {
      try {
        const { validateImportRows, commitImportRows } =
          await import("./import-service.js");
        const companyId = getCompanyId(c);
        const actorId = getActorId(c);
        const accountId = c.req.param("id");
        if (!(await service.canWriteAccount({ companyId, accountId, actorId }))) {
          return c.json({ error: 'No tienes permisos para importar movimientos en esta cuenta.' }, 403)
        }
        const body = await c.req.json();
        const { valid } = validateImportRows(
          body.rows ?? [],
          body.mapping ?? {},
        );
        const result = await commitImportRows({
          prisma,
          companyId,
          accountId,
          rows: valid,
        });
        return c.json(result, 201);
      } catch (err) {
        return handleError(c, err, "No se pudo completar la importacion.");
      }
    },
  );

  return app;
}
