import {
  normalizePagination, normalizeOptionalString,
  isTableNotFoundError, isUniqueViolation, toCount, firstRow, hasOwn,
} from './service-helpers.js'

export class LedgerServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'LedgerServiceError'
    this.status = status
  }
}

export function createLedgerService({ prisma }) {

  // ── Accounts ────────────────────────────────────────────────────────────────

  async function listAccounts({ companyId, actorId }) {
    try {
      const rows = await prisma.$queryRaw`
        SELECT a.*,
          a.opening_balance + COALESCE(
            SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0)) FILTER (WHERE t.enabled = true),
            0
          ) AS current_balance
        FROM ledger_account a
        LEFT JOIN ledger_transaction t ON t.account_id = a.id
        WHERE a.company_id = ${companyId}::uuid
          AND a.enabled = true
          AND (
            a.owner_id = ${actorId}::uuid
            OR EXISTS (
              SELECT 1 FROM ledger_account_member m
              WHERE m.account_id = a.id AND m.user_id = ${actorId}::uuid AND m.status = 'active'
            )
            OR EXISTS (
              SELECT 1 FROM ledger_group_member gm
              JOIN ledger_group g ON g.id = gm.group_id AND g.enabled = true
              WHERE gm.group_id = a.group_id AND gm.user_id = ${actorId}::uuid AND gm.status = 'active'
            )
          )
        GROUP BY a.id
        ORDER BY a.name
      `
      return { data: rows }
    } catch (err) {
      if (isTableNotFoundError(err)) throw new LedgerServiceError('El modulo Ledger no esta instalado.', 503)
      throw err
    }
  }

  async function getAccount({ companyId, accountId, actorId }) {
    if (!actorId) throw new LedgerServiceError('Se requiere un usuario autenticado.', 401)
    try {
      const rows = await prisma.$queryRaw`
        SELECT a.*,
          a.opening_balance + COALESCE(
            SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0)) FILTER (WHERE t.enabled = true),
            0
          ) AS current_balance,
          (
            a.owner_id = ${actorId}::uuid
            OR EXISTS (
              SELECT 1 FROM ledger_account_member m
              WHERE m.account_id = a.id AND m.user_id = ${actorId}::uuid
                AND m.status = 'active' AND m.role = 'editor'
            )
            OR EXISTS (
              SELECT 1 FROM ledger_group_member gm
              JOIN ledger_group g ON g.id = gm.group_id AND g.enabled = true
              WHERE gm.group_id = a.group_id AND gm.user_id = ${actorId}::uuid
                AND gm.status = 'active' AND (gm.role = 'editor' OR gm.role = 'admin')
            )
          ) AS can_write,
          (a.owner_id = ${actorId}::uuid) AS is_owner
        FROM ledger_account a
        LEFT JOIN ledger_transaction t ON t.account_id = a.id
        WHERE a.id = ${accountId}::uuid
          AND a.company_id = ${companyId}::uuid
          AND a.enabled = true
          AND (
            a.owner_id = ${actorId}::uuid
            OR EXISTS (
              SELECT 1 FROM ledger_account_member m
              WHERE m.account_id = a.id AND m.user_id = ${actorId}::uuid AND m.status = 'active'
            )
            OR EXISTS (
              SELECT 1 FROM ledger_group_member gm
              JOIN ledger_group g ON g.id = gm.group_id AND g.enabled = true
              WHERE gm.group_id = a.group_id AND gm.user_id = ${actorId}::uuid AND gm.status = 'active'
            )
          )
        GROUP BY a.id
      `
      const account = firstRow(rows)
      if (!account) throw new LedgerServiceError('Cuenta no encontrada.', 404)
      return account
    } catch (err) {
      if (err instanceof LedgerServiceError) throw err
      if (isTableNotFoundError(err)) throw new LedgerServiceError('El modulo Ledger no esta instalado.', 503)
      throw err
    }
  }

  // Internal-only: fetches current field values without an ownership check.
  // Only safe to call from write paths that already ran canWriteAccount()
  // themselves (e.g. updateAccount below) — never expose this to a route
  // handler directly.
  async function getAccountUnchecked({ companyId, accountId }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM ledger_account
      WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid
    `
    const account = firstRow(rows)
    if (!account) throw new LedgerServiceError('Cuenta no encontrada.', 404)
    return account
  }

  async function createAccount({ companyId, ownerId, groupId = null, data }) {
    if (!ownerId) throw new LedgerServiceError('Se requiere un propietario para la cuenta.', 400)
    const { name, bank, account_number, currency, opening_balance } = data
    try {
      const rows = await prisma.$queryRaw`
        INSERT INTO ledger_account
          (company_id, owner_id, group_id, name, bank, account_number, currency, opening_balance, enabled, updated_at)
        VALUES (
          ${companyId}::uuid,
          ${ownerId},
          ${groupId},
          ${name},
          ${bank},
          ${normalizeOptionalString(account_number)},
          ${currency},
          ${opening_balance ?? 0},
          true,
          NOW()
        )
        RETURNING *
      `
      return firstRow(rows)
    } catch (err) {
      if (isUniqueViolation(err)) throw new LedgerServiceError(`Ya existe una cuenta con el nombre "${name}".`, 409)
      throw err
    }
  }

  async function canReadAccount({ companyId, accountId, actorId }) {
    const rows = await prisma.$queryRaw`
      SELECT 1 FROM ledger_account a
      WHERE a.id = ${accountId}::uuid
        AND a.company_id = ${companyId}::uuid
        AND a.enabled = true
        AND (
          a.owner_id = ${actorId}::uuid
          OR EXISTS (
            SELECT 1 FROM ledger_account_member m
            WHERE m.account_id = a.id AND m.user_id = ${actorId}::uuid AND m.status = 'active'
          )
          OR EXISTS (
            SELECT 1 FROM ledger_group_member gm
            JOIN ledger_group g ON g.id = gm.group_id AND g.enabled = true
            WHERE gm.group_id = a.group_id AND gm.user_id = ${actorId}::uuid AND gm.status = 'active'
          )
        )
    `
    return rows.length > 0
  }

  async function canWriteAccount({ companyId, accountId, actorId }) {
    const rows = await prisma.$queryRaw`
      SELECT 1 FROM ledger_account a
      WHERE a.id = ${accountId}::uuid
        AND a.company_id = ${companyId}::uuid
        AND a.enabled = true
        AND (
          a.owner_id = ${actorId}::uuid
          OR EXISTS (
            SELECT 1 FROM ledger_account_member m
            WHERE m.account_id = a.id AND m.user_id = ${actorId}::uuid
              AND m.status = 'active' AND m.role = 'editor'
          )
          OR EXISTS (
            SELECT 1 FROM ledger_group_member gm
            JOIN ledger_group g ON g.id = gm.group_id AND g.enabled = true
            WHERE gm.group_id = a.group_id AND gm.user_id = ${actorId}::uuid
              AND gm.status = 'active' AND (gm.role = 'editor' OR gm.role = 'admin')
          )
        )
    `
    return rows.length > 0
  }

  async function updateAccount({ companyId, accountId, data }) {
    const existing = await getAccountUnchecked({ companyId, accountId })

    const name            = hasOwn(data, 'name')            ? String(data.name).trim()                     : existing.name
    const bank            = hasOwn(data, 'bank')            ? String(data.bank).trim()                     : existing.bank
    const account_number  = hasOwn(data, 'account_number')  ? normalizeOptionalString(data.account_number) : existing.account_number
    const currency        = hasOwn(data, 'currency')        ? data.currency                                : existing.currency
    const opening_balance = hasOwn(data, 'opening_balance') ? Number(data.opening_balance)                 : Number(existing.opening_balance)

    try {
      const rows = await prisma.$queryRaw`
        UPDATE ledger_account
        SET name = ${name},
            bank = ${bank},
            account_number = ${account_number},
            currency = ${currency},
            opening_balance = ${opening_balance},
            updated_at = NOW()
        WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid AND enabled = true
        RETURNING *
      `
      return firstRow(rows)
    } catch (err) {
      if (isUniqueViolation(err)) throw new LedgerServiceError(`Ya existe una cuenta con el nombre "${name}".`, 409)
      throw err
    }
  }

  async function setAccountEnabled({ companyId, accountId, enabled }) {
    const rows = await prisma.$queryRaw`
      UPDATE ledger_account
      SET enabled = ${enabled}, updated_at = NOW()
      WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    const row = firstRow(rows)
    if (!row) throw new LedgerServiceError('Cuenta no encontrada.', 404)
    return row
  }

  async function setAccountGroup({ companyId, accountId, actorId, groupId }) {
    const accountRows = await prisma.$queryRaw`
      SELECT id, owner_id, group_id FROM ledger_account
      WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid AND enabled = true
    `
    const account = firstRow(accountRows)
    if (!account) throw new LedgerServiceError('Cuenta no encontrada.', 404)
    if (!(await canWriteAccount({ companyId, accountId, actorId }))) {
      throw new LedgerServiceError('No tienes permisos para asignar esta cuenta a un grupo.', 403)
    }

    if (groupId !== null) {
      const groupRows = await prisma.$queryRaw`
        SELECT g.id FROM ledger_group g
        WHERE g.id = ${groupId}::uuid AND g.company_id = ${companyId}::uuid AND g.enabled = true
          AND (
            g.created_by = ${actorId}::uuid
            OR EXISTS (
              SELECT 1 FROM ledger_group_member gm
              WHERE gm.group_id = g.id AND gm.user_id = ${actorId}::uuid
                AND gm.status = 'active' AND gm.role IN ('editor', 'admin')
            )
          )
      `
      if (!firstRow(groupRows)) throw new LedgerServiceError('Grupo no encontrado o sin permisos.', 403)

      // Access now flows from the group — drop any direct per-account members so
      // there is a single source of truth for who can see the account. Both writes
      // run in one transaction so a mid-failure can't strand the account without
      // members AND without its new group_id.
      const rows = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`
          DELETE FROM ledger_account_member WHERE account_id = ${accountId}::uuid
        `
        return tx.$queryRaw`
          UPDATE ledger_account
          SET group_id = ${groupId}, updated_at = NOW()
          WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid
          RETURNING *
        `
      })
      return firstRow(rows)
    }

    const rows = await prisma.$queryRaw`
      UPDATE ledger_account
      SET group_id = ${groupId}, updated_at = NOW()
      WHERE id = ${accountId}::uuid AND company_id = ${companyId}::uuid
      RETURNING *
    `
    return firstRow(rows)
  }

  // ── Transactions ─────────────────────────────────────────────────────────────

  async function listTransactions({ companyId, accountId, actorId = null, dateFrom, dateTo, page, pageSize, order = 'asc', maxPageSize = 2000 }) {
    // Default cap: 2000 for spreadsheet view; callers may pass maxPageSize up to 50000 for exports
    const pag  = normalizePagination({ page, pageSize, maxPageSize: Math.min(maxPageSize, 50000) })
    const from = normalizeOptionalString(dateFrom) ?? null
    const to   = normalizeOptionalString(dateTo)   ?? null
    // 'desc' returns the most recent slice first (used by the register to show
    // recent movements by default); callers re-sort ascending for display.
    const descFlag = String(order).toLowerCase() === 'desc' ? 1 : 0

    try {
      // Single query: window functions compute consecutive + running balance,
      // filtered CTE applies date range, COUNT(*) OVER() avoids a second round trip.
      // Account ownership is enforced by the JOIN + company_id filter on the transaction.
      // Category name/color is only exposed when the category is a system one
      // (owner_id IS NULL) or owned by the requesting actor — a collaborator on a
      // shared account never sees another user's personal category label.
      const rows = await prisma.$queryRaw`
        WITH ranked AS (
          SELECT
            t.*,
            tt.code  AS tipo_code,
            tt.name  AS tipo_name,
            c.name   AS category_name,
            c.color  AS category_color,
            ROW_NUMBER() OVER (
              PARTITION BY t.account_id ORDER BY t.fecha, t.created_at
            )::int4 AS consecutive,
            a.opening_balance + SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0))
              OVER (
                PARTITION BY t.account_id
                ORDER BY t.fecha, t.created_at
                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
              ) AS saldo_actual
          FROM ledger_transaction t
          JOIN ledger_account a ON a.id = t.account_id AND a.company_id = ${companyId}::uuid
          LEFT JOIN ledger_transaction_type tt ON tt.id = t.tipo_id
          LEFT JOIN ledger_category c ON c.id = t.category_id
            AND (c.owner_id IS NULL OR c.owner_id = ${actorId}::uuid)
          WHERE t.account_id = ${accountId}::uuid
            AND t.company_id = ${companyId}::uuid
            AND t.enabled = true
        ),
        filtered AS (
          SELECT * FROM ranked
          WHERE (${from}::date IS NULL OR fecha >= ${from}::date)
            AND (${to}::date   IS NULL OR fecha <= ${to}::date)
        ),
        paged AS (
          SELECT *, COUNT(*) OVER()::int4 AS _total_count
          FROM filtered
          ORDER BY
            CASE WHEN ${descFlag}::int = 1 THEN fecha      END DESC,
            CASE WHEN ${descFlag}::int = 1 THEN created_at  END DESC,
            CASE WHEN ${descFlag}::int = 0 THEN fecha      END ASC,
            CASE WHEN ${descFlag}::int = 0 THEN created_at  END ASC
          LIMIT ${pag.pageSize} OFFSET ${pag.offset}
        )
        SELECT * FROM paged
        ORDER BY fecha, created_at
      `

      const total = rows.length > 0 ? (rows[0]._total_count ?? rows.length) : 0
      // Strip the internal count column before returning to callers
      const data = rows.map(({ _total_count, ...r }) => r)

      return {
        data,
        pagination: {
          page:     pag.page,
          pageSize: pag.pageSize,
          total:    toCount(total),
        },
      }
    } catch (err) {
      if (isTableNotFoundError(err)) throw new LedgerServiceError('El modulo Ledger no esta instalado.', 503)
      throw err
    }
  }

  async function createTransaction({ companyId, accountId, data }) {
    const { fecha, tipo_id, numero, nombre, referencia, concepto, deposito, retiro, category_id } = data
    const tipoIdVal     = normalizeOptionalString(tipo_id)     ?? null
    const categoryIdVal = normalizeOptionalString(category_id) ?? null

    // Single round trip: CTE validates account ownership, INSERT only runs if account exists.
    // No pre-flight getAccount() call needed — saves one network round trip to Supabase.
    const rows = await prisma.$queryRaw`
      WITH account_check AS (
        SELECT id FROM ledger_account
        WHERE id = ${accountId}::uuid
          AND company_id = ${companyId}::uuid
          AND enabled = true
      )
      INSERT INTO ledger_transaction
        (account_id, company_id, fecha, tipo_id, numero, nombre,
         referencia, concepto, deposito, retiro, category_id, enabled, updated_at)
      SELECT
        ${accountId}::uuid,
        ${companyId}::uuid,
        ${fecha}::date,
        ${tipoIdVal}::uuid,
        ${normalizeOptionalString(numero)},
        ${nombre},
        ${normalizeOptionalString(referencia)},
        ${normalizeOptionalString(concepto)},
        ${deposito ?? null},
        ${retiro   ?? null},
        ${categoryIdVal}::uuid,
        true,
        NOW()
      FROM account_check
      RETURNING *
    `
    const row = firstRow(rows)
    if (!row) throw new LedgerServiceError('Cuenta no encontrada o no disponible.', 404)
    return row
  }

  async function updateTransaction({ companyId, accountId, transactionId, data }) {
    // Single round trip — no pre-flight SELECT. Each field uses CASE WHEN to only update
    // columns present in the payload, preserving current values for omitted fields.
    // This halves the Supabase round trips vs the old SELECT-then-UPDATE pattern.
    const hasFecha      = hasOwn(data, 'fecha')
    const hasTipoId     = hasOwn(data, 'tipo_id')
    const hasNumero     = hasOwn(data, 'numero')
    const hasNombre     = hasOwn(data, 'nombre')
    const hasReferencia = hasOwn(data, 'referencia')
    const hasConcepto   = hasOwn(data, 'concepto')
    const hasDeposito   = hasOwn(data, 'deposito')
    const hasRetiro     = hasOwn(data, 'retiro')
    const hasCatId      = hasOwn(data, 'category_id')

    const fechaVal    = hasFecha      ? (data.fecha ?? null)                                   : null
    const tipoIdVal   = hasTipoId     ? (normalizeOptionalString(data.tipo_id)     ?? null)    : null
    const numeroVal   = hasNumero     ? (normalizeOptionalString(data.numero)      ?? null)    : null
    const nombreVal   = hasNombre     ? String(data.nombre).trim()                             : null
    const refVal      = hasReferencia ? (normalizeOptionalString(data.referencia)  ?? null)    : null
    const conceptoVal = hasConcepto   ? (normalizeOptionalString(data.concepto)    ?? null)    : null
    const depositoVal = hasDeposito   ? (data.deposito ?? null)                                : null
    const retiroVal   = hasRetiro     ? (data.retiro   ?? null)                                : null
    const catIdVal    = hasCatId      ? (normalizeOptionalString(data.category_id) ?? null)    : null

    const rows = await prisma.$queryRaw`
      UPDATE ledger_transaction
      SET
        fecha       = CASE WHEN ${hasFecha}      THEN ${fechaVal}::date    ELSE fecha       END,
        tipo_id     = CASE WHEN ${hasTipoId}     THEN ${tipoIdVal}::uuid   ELSE tipo_id     END,
        numero      = CASE WHEN ${hasNumero}     THEN ${numeroVal}         ELSE numero      END,
        nombre      = CASE WHEN ${hasNombre}     THEN ${nombreVal}         ELSE nombre      END,
        referencia  = CASE WHEN ${hasReferencia} THEN ${refVal}            ELSE referencia  END,
        concepto    = CASE WHEN ${hasConcepto}   THEN ${conceptoVal}       ELSE concepto    END,
        deposito    = CASE WHEN ${hasDeposito}   THEN ${depositoVal}       ELSE deposito    END,
        retiro      = CASE WHEN ${hasRetiro}     THEN ${retiroVal}         ELSE retiro      END,
        category_id = CASE WHEN ${hasCatId}      THEN ${catIdVal}::uuid    ELSE category_id END,
        updated_at  = NOW()
      WHERE id         = ${transactionId}::uuid
        AND account_id = ${accountId}::uuid
        AND company_id = ${companyId}::uuid
        AND enabled    = true
      RETURNING *
    `
    const row = firstRow(rows)
    if (!row) throw new LedgerServiceError('Movimiento no encontrado.', 404)
    return row
  }

  async function setTransactionEnabled({ companyId, accountId, transactionId, enabled }) {
    const rows = await prisma.$queryRaw`
      UPDATE ledger_transaction
      SET enabled = ${enabled}, updated_at = NOW()
      WHERE id         = ${transactionId}::uuid
        AND account_id = ${accountId}::uuid
        AND company_id = ${companyId}::uuid
      RETURNING *
    `
    const row = firstRow(rows)
    if (!row) throw new LedgerServiceError('Movimiento no encontrado.', 404)
    return row
  }

  return {
    listAccounts, getAccount, getAccountUnchecked, createAccount, canReadAccount, canWriteAccount, updateAccount, setAccountEnabled, setAccountGroup,
    listTransactions, createTransaction, updateTransaction, setTransactionEnabled,
  }
}
