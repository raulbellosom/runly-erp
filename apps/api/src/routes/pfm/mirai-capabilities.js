// apps/api/src/routes/pfm/mirai-capabilities.js
//
// runly.pfm capability for MirAI (spec 2026-09-30-mirai-pfm-capability). Builds
// its own PFM services the same way routes/pfm/index.js does, independent of
// the HTTP router. publicLookup: not applicable, personal finance data never
// leaves the server; market/exchange-rate questions use web_search instead.
import { createWalletsService } from "./wallets-service.js";
import { createMovementsService } from "./movements-service.js";
import { createSummaryService } from "./summary-service.js";
import { createBudgetsService } from "./budgets-service.js";
import { createCategoriesService } from "./categories-service.js";
import { createPfmCalendarBridge } from "./pfm-calendar-bridge.js";
import { createPfmMiraiQueries } from "./pfm-mirai-queries.js";
import { createPfmMiraiActions } from "./mirai-actions.js";

const KIND_LABEL = { CASH: "efectivo", DEBIT: "debito", CREDIT: "credito", INVESTMENT: "inversion" };
const money = (amount, currency) =>
  `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export function createPfmMiraiCapabilities({ prisma }) {
  const calendarBridge = createPfmCalendarBridge({ prisma });
  const wallets = createWalletsService({ prisma, calendarBridge });
  const movements = createMovementsService({ prisma, wallets });
  const summary = createSummaryService({ prisma });
  const budgets = createBudgetsService({ prisma });
  const categories = createCategoriesService({ prisma });

  return {
    moduleKey: "runly.pfm",
    label: "Finanzas personales",
    summary: "Carteras, movimientos, gasto por categoria, presupuestos y cargos proximos; registrar, editar y eliminar movimientos.",
    tools: createPfmMiraiQueries({ prisma, summary, wallets, budgets, categories }),
    actions: createPfmMiraiActions({ wallets, movements, categories }),
    publicLookup: [],
    async describeContext(pageContext, actx) {
      if (pageContext?.recordType === "wallet" && pageContext.recordId) {
        const wallet = await wallets
          .getWallet({ companyId: actx.companyId, walletId: String(pageContext.recordId), actorId: actx.actorProfileId })
          .catch(() => null);
        if (wallet) {
          return `El usuario esta viendo la cartera "${wallet.name}" (walletId ${wallet.id}), tipo ${KIND_LABEL[wallet.kind] ?? wallet.kind}, moneda ${wallet.currency}, saldo ${money(wallet.currentBalance, wallet.currency)}.`;
        }
      }
      return "El usuario esta en el modulo Finanzas personales.";
    },
  };
}
