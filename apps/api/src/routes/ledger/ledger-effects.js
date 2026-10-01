// apps/api/src/routes/ledger/ledger-effects.js
//
// Side effects after a ledger transaction write (activity entry), shared by
// the HTTP routes (./accounts-routes.js) and MirAI actions (./mirai-actions.js).
// Extracted from accounts-routes.js (spec 2026-09-30-mirai-ledger-hr-fleet
// §Track A) so both call sites stay identical. `c` is a Hono context or
// actorContext() from ../calendar/calendar-event-effects.js when called
// outside an HTTP request.
//
// Note: accounts-routes.js's PATCH .../transactions/:txId (update) does not
// publish an activity entry today — only create and enabled-toggle do. This
// file only extracts what the route actually does; it does not add a new
// afterUpdate effect that didn't exist before.
import { publishActivityFromContext, getActivityContext } from "../../services/activity-publisher.js";

export function createLedgerEffects({ prisma }) {
  async function afterCreateTransaction(c, tx) {
    const { actorName } = getActivityContext(c);
    await publishActivityFromContext(prisma, c, {
      type: "ledger.transaction.create",
      severity: "success",
      entityType: "FinanceTransaction",
      entityId: tx?.id ?? null,
      summary: `${actorName} registró un movimiento contable`,
    });
  }

  async function afterSetTransactionEnabled(c, tx) {
    const { actorName } = getActivityContext(c);
    await publishActivityFromContext(prisma, c, {
      type: tx.enabled ? "ledger.transaction.enable" : "ledger.transaction.disable",
      severity: tx.enabled ? "info" : "warning",
      entityType: "FinanceTransaction",
      entityId: tx.id,
      summary: `${actorName} ${tx.enabled ? "reactivó" : "anuló"} un movimiento contable`,
    });
  }

  return { afterCreateTransaction, afterSetTransactionEnabled };
}
