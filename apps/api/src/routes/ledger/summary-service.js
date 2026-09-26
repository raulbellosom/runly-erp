import { normalizeOptionalString, firstRow, isTableNotFoundError } from './service-helpers.js'
import { LedgerServiceError, createLedgerService } from './ledger-service.js'

export function createSummaryService({ prisma }) {
  const ledgerService = createLedgerService({ prisma })

  /**
   * Returns KPI cards + chart data for the AccountScreen Resumen tab.
   * @returns {{ kpis, balance_series, by_category }}
   */
  async function getAccountSummary({ companyId, accountId, actorId = null, dateFrom, dateTo }) {
    // Caller (accounts-routes.js) already ran canReadAccount before invoking this.
    const account = await ledgerService.getAccountUnchecked({ companyId, accountId })
    const from = normalizeOptionalString(dateFrom) ?? null
    const to   = normalizeOptionalString(dateTo)   ?? null

    try {
      const openingBalance = Number(account.opening_balance ?? 0)

      // KPIs for the requested period
      const kpiRows = await prisma.$queryRaw`
        SELECT
          COALESCE(SUM(COALESCE(deposito, 0)), 0) AS total_deposito,
          COALESCE(SUM(COALESCE(retiro,   0)), 0) AS total_retiro
        FROM ledger_transaction
        WHERE account_id = ${accountId}::uuid
          AND company_id = ${companyId}::uuid
          AND enabled = true
          AND (${from}::date IS NULL OR fecha >= ${from}::date)
          AND (${to}::date   IS NULL OR fecha <= ${to}::date)
      `

      // Current balance (all-time, not period-filtered)
      const balanceRows = await prisma.$queryRaw`
        SELECT
          COALESCE(SUM(COALESCE(deposito,0) - COALESCE(retiro,0)) FILTER (WHERE enabled=true), 0)
          AS net_movement
        FROM ledger_transaction
        WHERE account_id = ${accountId}::uuid AND company_id = ${companyId}::uuid
      `

      const kpiRow         = firstRow(kpiRows) ?? {}
      const totalDep       = Number(kpiRow.total_deposito ?? 0)
      const totalRet       = Number(kpiRow.total_retiro   ?? 0)
      const currentBalance = openingBalance + Number(firstRow(balanceRows)?.net_movement ?? 0)

      // Balance series: last saldo_actual per day within period
      const seriesRows = await prisma.$queryRaw`
        WITH ranked AS (
          SELECT
            fecha,
            ${openingBalance} +
              SUM(COALESCE(deposito,0) - COALESCE(retiro,0))
              OVER (
                PARTITION BY account_id ORDER BY fecha, created_at
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS balance,
            ROW_NUMBER() OVER (PARTITION BY fecha ORDER BY created_at DESC) AS rn
          FROM ledger_transaction
          WHERE account_id = ${accountId}::uuid
            AND company_id = ${companyId}::uuid
            AND enabled = true
            AND (${from}::date IS NULL OR fecha >= ${from}::date)
            AND (${to}::date   IS NULL OR fecha <= ${to}::date)
        )
        SELECT fecha, balance FROM ranked WHERE rn = 1
        ORDER BY fecha
      `

      // By month (chronological, within the requested period)
      const byMonthRows = await prisma.$queryRaw`
        SELECT
          date_trunc('month', fecha) AS month_start,
          COALESCE(SUM(COALESCE(deposito, 0)), 0) AS deposito,
          COALESCE(SUM(COALESCE(retiro,   0)), 0) AS retiro
        FROM ledger_transaction
        WHERE account_id = ${accountId}::uuid
          AND company_id = ${companyId}::uuid
          AND enabled = true
          AND (${from}::date IS NULL OR fecha >= ${from}::date)
          AND (${to}::date   IS NULL OR fecha <= ${to}::date)
        GROUP BY date_trunc('month', fecha)
        ORDER BY date_trunc('month', fecha)
      `

      // By category
      const byCategoryRows = await prisma.$queryRaw`
        SELECT
          COALESCE(c.name,  'Sin categoria') AS category_name,
          COALESCE(c.color, '#94A3B8')       AS color,
          COALESCE(SUM(COALESCE(t.deposito, 0)), 0) AS deposito,
          COALESCE(SUM(COALESCE(t.retiro,   0)), 0) AS retiro
        FROM ledger_transaction t
        LEFT JOIN ledger_category c ON c.id = t.category_id
          AND (c.owner_id IS NULL OR c.owner_id = ${actorId}::uuid)
        WHERE t.account_id = ${accountId}::uuid
          AND t.company_id = ${companyId}::uuid
          AND t.enabled = true
          AND (${from}::date IS NULL OR t.fecha >= ${from}::date)
          AND (${to}::date   IS NULL OR t.fecha <= ${to}::date)
        GROUP BY c.name, c.color
        ORDER BY SUM(COALESCE(t.deposito, 0) + COALESCE(t.retiro, 0)) DESC
      `

      return {
        kpis: {
          opening_balance: openingBalance,
          current_balance: currentBalance,
          total_deposito:  totalDep,
          total_retiro:    totalRet,
          net:             totalDep - totalRet,
        },
        balance_series: seriesRows.map((r) => ({
          // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date row value
          fecha:   r.fecha instanceof Date ? r.fecha.toISOString().slice(0, 10) : String(r.fecha).slice(0, 10),
          balance: Number(r.balance),
        })),
        by_month: byMonthRows.map((r) => ({
          // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date row value
          month:   r.month_start instanceof Date ? r.month_start.toISOString().slice(0, 7) : String(r.month_start).slice(0, 7),
          deposito: Number(r.deposito),
          retiro:   Number(r.retiro),
        })),
        by_category: byCategoryRows.map((r) => ({
          category_name: r.category_name,
          color:         r.color,
          deposito:      Number(r.deposito),
          retiro:        Number(r.retiro),
        })),
      }
    } catch (err) {
      if (err instanceof LedgerServiceError) throw err
      if (isTableNotFoundError(err)) throw new LedgerServiceError('El modulo Ledger no esta instalado.', 503)
      throw err
    }
  }

  return { getAccountSummary }
}
