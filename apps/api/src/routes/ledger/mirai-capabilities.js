// apps/api/src/routes/ledger/mirai-capabilities.js
//
// runly.ledger capability for MirAI (spec 2026-09-30-mirai-ledger-hr-fleet
// §3). Builds its own ledger/categories/AI-import services the same way the
// HTTP routers do, independent of them. publicLookup: not applicable — account
// and transaction data never leaves the server; exchange-rate/market
// questions go through web_search instead, same precedent as runly.pfm.
//
// `attachments` is a chat-attachment-access.js instance (see
// chat-attachment-access.js's createChatAttachmentAccess) — required only for
// the ledger.statement.import action's prepare(), which downloads the chat
// attachment the user is importing. When the caller doesn't need statement
// import wired (e.g. a unit test exercising only the read tools), it may be
// omitted; the import action then reports "not available here" instead of
// throwing.
import { createLedgerService } from "./ledger-service.js";
import { createCategoriesService } from "./categories-service.js";
import { createAiImportService } from "./ai-import-service.js";
import { createAiRouter } from "../../services/ai/ai-router.js";
import { createLedgerEffects } from "./ledger-effects.js";
import { createLedgerMiraiQueries } from "./ledger-mirai-queries.js";
import { createLedgerMiraiActions } from "./mirai-actions.js";

export function createLedgerMiraiCapabilities({ prisma, attachments = null }) {
  const ledgerService = createLedgerService({ prisma });
  const categoriesService = createCategoriesService({ prisma });
  const aiImportService = createAiImportService({ prisma });
  const aiRouter = createAiRouter({ env: process.env });
  const effects = createLedgerEffects({ prisma });

  return {
    moduleKey: "runly.ledger",
    label: "Libro de cuentas",
    summary: "Cuentas bancarias y de efectivo, movimientos y resumenes de ingresos/egresos; registrar, editar y eliminar movimientos; importar un estado de cuenta adjunto.",
    tools: createLedgerMiraiQueries({ prisma, ledgerService, categoriesService }),
    actions: createLedgerMiraiActions({
      prisma, ledgerService, effects, aiImportService, aiRouter, attachmentAccess: attachments,
    }),
    publicLookup: [],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType !== "account" || !pageContext.recordId) return null;
      const account = await ledgerService
        .getAccount({ companyId: actx.companyId, accountId: String(pageContext.recordId), actorId: actx.actorProfileId })
        .catch(() => null);
      if (!account) return null;
      return `El usuario esta viendo la cuenta "${account.name}" (accountId ${account.id}), banco ${account.bank}, moneda ${account.currency}, saldo ${Number(account.current_balance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`;
    },
  };
}
