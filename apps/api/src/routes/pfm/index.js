// apps/api/src/routes/pfm/index.js
import { Hono } from "hono";
import { createWalletsRouter } from "./wallets-routes.js";
import { createCategoriesRouter } from "./categories-routes.js";
import { createMovementsRouter } from "./movements-routes.js";
import { createSummaryRouter } from "./summary-routes.js";
import { createRecurringRouter } from "./recurring-routes.js";
import { createReceiptsRouter } from "./receipts-routes.js";
import { createBudgetsRouter } from "./budgets-routes.js";
import { createWalletsService } from "./wallets-service.js";
import { createCategoriesService } from "./categories-service.js";
import { createMovementsService } from "./movements-service.js";
import { createLedgerLinkService } from "./ledger-link-service.js";
import { createSummaryService } from "./summary-service.js";
import { createInvestmentsService } from "./investments-service.js";
import { createPfmCalendarBridge } from "./pfm-calendar-bridge.js";
import { createRecurringService } from "./recurring-service.js";
import { createReceiptsService } from "./receipts-service.js";
import { createBudgetsService } from "./budgets-service.js";
import { createGoalsService } from "./goals-service.js";
import { createVisionService } from "../../services/vision-service.js";
import { createLedgerService } from "../ledger/ledger-service.js";

export function createPfmRouter({
  prisma,
  requirePermission,
  requireAnyPermission,
  supabaseAdmin,
  filesService,
  notificationService,
}) {
  const app = new Hono();

  const anyPermission =
    typeof requireAnyPermission === "function"
      ? requireAnyPermission
      : (keys = []) => requirePermission(keys[0]);

  const calendarBridge = createPfmCalendarBridge({ prisma });
  const wallets = createWalletsService({ prisma, calendarBridge });
  const ledgerService = createLedgerService({ prisma });
  const ledgerLink = createLedgerLinkService({ prisma, ledgerService });
  const movements = createMovementsService({ prisma, wallets });
  const summary = createSummaryService({ prisma });
  const investments = createInvestmentsService({ prisma });
  const recurring = createRecurringService({ prisma, wallets, calendarBridge });
  const vision = createVisionService({ env: process.env });
  const receipts = createReceiptsService({
    prisma,
    vision,
    supabaseAdmin,
    movements,
    wallets,
    filesService,
  });
  const budgets = createBudgetsService({ prisma, notificationService: notificationService ?? null });
  const goals = createGoalsService({ prisma });
  const categories = createCategoriesService({ prisma });

  app.route(
    "/",
    createWalletsRouter({ prisma, requirePermission, requireAnyPermission: anyPermission }),
  );
  app.route(
    "/",
    createCategoriesRouter({ prisma, requirePermission, requireAnyPermission: anyPermission }),
  );
  app.route(
    "/",
    createMovementsRouter({
      prisma,
      requirePermission,
      requireAnyPermission: anyPermission,
      wallets,
      movements,
      ledgerLink,
    }),
  );
  app.route("/", createSummaryRouter({ prisma, requireAnyPermission: anyPermission }));
  app.route(
    "/",
    createRecurringRouter({
      requirePermission,
      requireAnyPermission: anyPermission,
      recurring,
      summary,
    }),
  );
  if (filesService) {
    app.route(
      "/",
      createReceiptsRouter({
        requirePermission,
        requireAnyPermission: anyPermission,
        receipts,
        filesService,
        visionConfigured: () => Boolean(process.env.GROQ_API_KEY),
      }),
    );
  }
  app.route(
    "/",
    createBudgetsRouter({
      requirePermission,
      requireAnyPermission: anyPermission,
      budgets,
      goals,
      wallets,
    }),
  );
  app.pfmServices = { recurring, summary, receipts, budgets, goals, investments };
  return app;
}
