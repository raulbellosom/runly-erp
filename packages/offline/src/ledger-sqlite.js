const ENTITY_CONFIG = {
  account: {
    table: 'ledger_account',
    columns: [
      'id',
      'company_id',
      'owner_id',
      'group_id',
      'name',
      'bank',
      'account_number',
      'currency',
      'opening_balance',
      'enabled',
      'created_at',
      'updated_at',
    ],
    mapRecord(record) {
      return [
        record.id,
        record.companyId,
        record.ownerId ?? record.owner_id ?? null,
        record.groupId ?? record.group_id ?? null,
        record.name,
        record.bank,
        record.accountNumber ?? null,
        record.currency ?? 'MXN',
        Number(record.openingBalance ?? 0),
        record.enabled === false ? 0 : 1,
        normalizeTimestamp(record.createdAt ?? record.created_at),
        normalizeTimestamp(record.updatedAt ?? record.updated_at),
      ]
    },
  },
  transaction: {
    table: 'ledger_transaction',
    columns: [
      'id',
      'company_id',
      'account_id',
      'category_id',
      'tipo_id',
      'fecha',
      'numero',
      'nombre',
      'referencia',
      'concepto',
      'deposito',
      'retiro',
      'enabled',
      'created_at',
      'updated_at',
    ],
    mapRecord(record) {
      return [
        record.id,
        record.companyId,
        record.accountId,
        record.categoryId ?? null,
        record.tipoId ?? null,
        normalizeDate(record.fecha),
        record.numero ?? null,
        record.nombre,
        record.referencia ?? null,
        record.concepto ?? null,
        record.deposito ?? null,
        record.retiro ?? null,
        record.enabled === false ? 0 : 1,
        normalizeTimestamp(record.createdAt ?? record.created_at),
        normalizeTimestamp(record.updatedAt ?? record.updated_at),
      ]
    },
  },
  category: {
    table: 'ledger_category',
    columns: [
      'id',
      'company_id',
      'name',
      'color',
      'kind',
      'enabled',
      'created_at',
      'updated_at',
    ],
    mapRecord(record) {
      return [
        record.id,
        record.companyId,
        record.name,
        record.color ?? null,
        record.kind ?? 'both',
        record.enabled === false ? 0 : 1,
        normalizeTimestamp(record.createdAt ?? record.created_at),
        normalizeTimestamp(record.updatedAt ?? record.updated_at),
      ]
    },
  },
  transaction_type: {
    table: 'ledger_transaction_type',
    columns: [
      'id',
      'company_id',
      'code',
      'name',
      'enabled',
      'created_at',
      'updated_at',
    ],
    mapRecord(record) {
      return [
        record.id,
        record.companyId,
        record.code,
        record.name,
        record.enabled === false ? 0 : 1,
        normalizeTimestamp(record.createdAt ?? record.created_at),
        normalizeTimestamp(record.updatedAt ?? record.updated_at),
      ]
    },
  },
}

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS ledger_account (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    owner_id TEXT,
    group_id TEXT,
    name TEXT NOT NULL,
    bank TEXT NOT NULL,
    account_number TEXT,
    currency TEXT NOT NULL DEFAULT 'MXN',
    opening_balance REAL NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_transaction (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    category_id TEXT,
    tipo_id TEXT,
    fecha TEXT NOT NULL,
    numero TEXT,
    nombre TEXT NOT NULL,
    referencia TEXT,
    concepto TEXT,
    deposito REAL,
    retiro REAL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_category (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    name TEXT NOT NULL,
    color TEXT,
    kind TEXT NOT NULL DEFAULT 'both',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ledger_transaction_type (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_lt_account_fecha ON ledger_transaction(account_id, fecha)',
  'CREATE INDEX IF NOT EXISTS idx_lt_company_fecha ON ledger_transaction(company_id, fecha)',
  'CREATE INDEX IF NOT EXISTS idx_lt_category ON ledger_transaction(category_id)',
]

function normalizeRecord(record) {
  return record?.data ?? record
}

function normalizePath(path) {
  return String(path).replace(/\\/g, '/')
}

function normalizeTimestamp(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function normalizeDate(value) {
  if (!value) return null
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: local SQLite cache mirrors the server's date representation
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value).slice(0, 10)
}

async function loadTauriDatabase(path) {
  const { default: Database } = await import('@tauri-apps/plugin-sql')
  return Database.load(path)
}

export { isNativeDesktop as isTauriAvailable } from '@runly/core/native-runtime'

export class LedgerSQLiteStore {
  #dbLoader
  #openPromise

  constructor({ companyId, userId, dbLoader } = {}) {
    this.companyId = companyId
    this.userId = userId
    this.db = null
    this.#dbLoader = dbLoader ?? loadTauriDatabase
    this.#openPromise = null
  }

  async open() {
    if (this.db) return this.db
    if (!this.companyId) {
      throw new Error('LedgerSQLiteStore requires companyId')
    }
    if (!this.#openPromise) {
      this.#openPromise = (async () => {
        const path = normalizePath(`sqlite:runly-erp/ledger-${this.companyId}${this.userId ? `-${encodeURIComponent(this.userId)}` : ''}.db`)
        const database = await this.#dbLoader(path)
        this.db = database
        await this._migrate()
        return database
      })().catch((error) => {
        this.#openPromise = null
        throw error
      })
    }
    return this.#openPromise
  }

  async _migrate() {
    const database = this.#ensureDb()
    for (const sql of MIGRATIONS) {
      await database.execute(sql)
    }
    await this.#safeAlterTable('ALTER TABLE ledger_account ADD COLUMN owner_id TEXT')
    await this.#safeAlterTable('ALTER TABLE ledger_account ADD COLUMN group_id TEXT')
  }

  async upsertBatch(entityType, records = []) {
    const config = ENTITY_CONFIG[entityType]
    if (!config) {
      throw new Error(`Unsupported ledger entity type: ${entityType}`)
    }
    const database = this.#ensureDb()
    if (!Array.isArray(records) || records.length === 0) return

    const placeholders = config.columns.map(() => '?').join(', ')
    const insertSql = `INSERT OR REPLACE INTO ${config.table} (${config.columns.join(', ')}) VALUES (${placeholders})`
    const deleteSql = `DELETE FROM ${config.table} WHERE id = ?`

    for (const record of records) {
      if (record?.deleted === true) {
        if (record?.id) {
          await database.execute(deleteSql, [record.id])
        }
        continue
      }

      const normalized = normalizeRecord(record)
      if (!normalized?.id) continue
      await database.execute(insertSql, config.mapRecord(normalized))
    }
  }

  async getAccountList() {
    const database = this.#ensureDb()
    return database.select(
      `SELECT
        id,
        company_id,
        owner_id,
        group_id,
        name,
        bank,
        account_number,
        currency,
        opening_balance,
        COALESCE(opening_balance, 0) + COALESCE((
          SELECT SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0))
          FROM ledger_transaction t
          WHERE t.account_id = ledger_account.id
            AND t.company_id = ledger_account.company_id
            AND t.enabled = 1
        ), 0) AS current_balance,
        enabled,
        created_at,
        updated_at
      FROM ledger_account
      WHERE company_id = ? AND enabled = 1
      ORDER BY name ASC`,
      [this.companyId],
    )
  }

  async getAccount(accountId) {
    const database = this.#ensureDb()
    const rows = await database.select(
      `SELECT
        id,
        company_id,
        owner_id,
        group_id,
        name,
        bank,
        account_number,
        currency,
        opening_balance,
        COALESCE(opening_balance, 0) + COALESCE((
          SELECT SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0))
          FROM ledger_transaction t
          WHERE t.account_id = ledger_account.id
            AND t.company_id = ledger_account.company_id
            AND t.enabled = 1
        ), 0) AS current_balance,
        enabled,
        created_at,
        updated_at
      FROM ledger_account
      WHERE company_id = ? AND id = ? AND enabled = 1
      LIMIT 1`,
      [this.companyId, accountId],
    )

    return rows[0] ?? null
  }

  async getTransactionTypes() {
    const database = this.#ensureDb()
    return database.select(
      `SELECT id, company_id, code, name, enabled, created_at, updated_at
      FROM ledger_transaction_type
      WHERE company_id = ? AND enabled = 1
      ORDER BY code ASC`,
      [this.companyId],
    )
  }

  async getCategories() {
    const database = this.#ensureDb()
    return database.select(
      `SELECT id, company_id, name, color, kind, enabled, created_at, updated_at
      FROM ledger_category
      WHERE company_id = ? AND enabled = 1
      ORDER BY name ASC`,
      [this.companyId],
    )
  }

  async queryTransactions(accountId, { start, end, limit = 100, offset = 0 } = {}) {
    const database = this.#ensureDb()
    const params = [
      this.companyId,
      accountId,
      start ?? null,
      start ?? null,
      end ?? null,
      end ?? null,
      limit,
      offset,
    ]

    return database.select(
      `WITH ranked AS (
        SELECT
          t.*,
          tt.code AS tipo_code,
          tt.name AS tipo_name,
          c.name AS category_name,
          c.color AS category_color,
          ROW_NUMBER() OVER (
            PARTITION BY t.account_id ORDER BY t.fecha, t.created_at, t.id
          ) AS consecutive,
          COALESCE(a.opening_balance, 0) + SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0))
            OVER (
              PARTITION BY t.account_id
              ORDER BY t.fecha, t.created_at, t.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS saldo_actual
        FROM ledger_transaction t
        INNER JOIN ledger_account a
          ON a.id = t.account_id
          AND a.company_id = t.company_id
        LEFT JOIN ledger_transaction_type tt
          ON tt.id = t.tipo_id
          AND tt.company_id = t.company_id
        LEFT JOIN ledger_category c
          ON c.id = t.category_id
          AND c.company_id = t.company_id
        WHERE t.company_id = ?
          AND t.account_id = ?
          AND t.enabled = 1
      ),
      filtered AS (
        SELECT * FROM ranked
        WHERE (? IS NULL OR fecha >= ?)
          AND (? IS NULL OR fecha <= ?)
      )
      SELECT *, COUNT(*) OVER() AS _total_count
      FROM filtered
      ORDER BY fecha, created_at
      LIMIT ? OFFSET ?`,
      params,
    )
  }

  async getRunningBalance(accountId, upToDate) {
    const database = this.#ensureDb()
    const rows = await database.select(
      `SELECT
        COALESCE(a.opening_balance, 0) +
        COALESCE(SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0)), 0) AS balance
      FROM ledger_account a
      LEFT JOIN ledger_transaction t
        ON t.account_id = a.id
        AND t.company_id = a.company_id
        AND t.enabled = 1
        AND (? IS NULL OR t.fecha <= ?)
      WHERE a.company_id = ? AND a.id = ?
      GROUP BY a.id, a.opening_balance`,
      [upToDate ?? null, upToDate ?? null, this.companyId, accountId],
    )

    return Number(rows?.[0]?.balance ?? 0)
  }

  async getMonthlySummary(accountId, year) {
    const database = this.#ensureDb()
    return database.select(
      `SELECT
        strftime('%m', fecha) AS month,
        COALESCE(SUM(COALESCE(deposito, 0)), 0) AS depositTotal,
        COALESCE(SUM(COALESCE(retiro, 0)), 0) AS withdrawalTotal
      FROM ledger_transaction
      WHERE company_id = ?
        AND account_id = ?
        AND enabled = 1
        AND strftime('%Y', fecha) = ?
      GROUP BY strftime('%m', fecha)
      ORDER BY month ASC`,
      [this.companyId, accountId, String(year)],
    )
  }

  async getCategoryBreakdown(accountId, { start, end } = {}) {
    const database = this.#ensureDb()
    const conditions = [
      't.company_id = ?',
      't.account_id = ?',
      't.enabled = 1',
      't.category_id IS NOT NULL',
    ]
    const params = [this.companyId, accountId]

    if (start) {
      conditions.push('t.fecha >= ?')
      params.push(start)
    }
    if (end) {
      conditions.push('t.fecha <= ?')
      params.push(end)
    }

    return database.select(
      `SELECT
        COALESCE(c.name, 'Sin categoria') AS category_name,
        COALESCE(c.color, '#94A3B8') AS color,
        COALESCE(SUM(COALESCE(t.deposito, 0)), 0) AS deposito,
        COALESCE(SUM(COALESCE(t.retiro, 0)), 0) AS retiro
      FROM ledger_transaction t
      LEFT JOIN ledger_category c
        ON c.id = t.category_id
        AND c.company_id = t.company_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY c.name, c.color
      ORDER BY SUM(COALESCE(t.deposito, 0) + COALESCE(t.retiro, 0)) DESC`,
      params,
    )
  }

  async getAccountSummary(accountId, { start, end } = {}) {
    const database = this.#ensureDb()
    const account = await this.getAccount(accountId)
    const openingBalance = Number(account?.opening_balance ?? 0)
    const currentBalance = Number(account?.current_balance ?? 0)

    const kpiRows = await database.select(
      `SELECT
        COALESCE(SUM(COALESCE(deposito, 0)), 0) AS total_deposito,
        COALESCE(SUM(COALESCE(retiro, 0)), 0) AS total_retiro
      FROM ledger_transaction
      WHERE account_id = ?
        AND company_id = ?
        AND enabled = 1
        AND (? IS NULL OR fecha >= ?)
        AND (? IS NULL OR fecha <= ?)`,
      [accountId, this.companyId, start ?? null, start ?? null, end ?? null, end ?? null],
    )

    const seriesRows = await database.select(
      `WITH ranked AS (
        SELECT
          t.fecha AS fecha,
          COALESCE(a.opening_balance, 0) +
            SUM(COALESCE(t.deposito, 0) - COALESCE(t.retiro, 0))
            OVER (
              PARTITION BY t.account_id ORDER BY t.fecha, t.created_at, t.id
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS balance,
          ROW_NUMBER() OVER (PARTITION BY fecha ORDER BY t.created_at DESC, t.id DESC) AS rn
        FROM ledger_transaction t
        INNER JOIN ledger_account a
          ON a.id = t.account_id
          AND a.company_id = t.company_id
        WHERE t.account_id = ?
          AND t.company_id = ?
          AND t.enabled = 1
          AND (? IS NULL OR t.fecha >= ?)
          AND (? IS NULL OR t.fecha <= ?)
      )
      SELECT fecha, balance FROM ranked WHERE rn = 1
      ORDER BY fecha`,
      [accountId, this.companyId, start ?? null, start ?? null, end ?? null, end ?? null],
    )

    const byCategoryRows = await this.getCategoryBreakdown(accountId, { start, end })
    const kpiRow = rowsFirst(kpiRows) ?? {}
    const totalDeposits = Number(kpiRow.total_deposito ?? 0)
    const totalWithdrawals = Number(kpiRow.total_retiro ?? 0)

    return {
      kpis: {
        opening_balance: openingBalance,
        current_balance: currentBalance,
        total_deposito: totalDeposits,
        total_retiro: totalWithdrawals,
        net: totalDeposits - totalWithdrawals,
      },
      balance_series: seriesRows.map((row) => ({
        fecha: normalizeDate(row.fecha),
        balance: Number(row.balance ?? 0),
      })),
      by_category: byCategoryRows.map((row) => ({
        category_name: row.category_name,
        color: row.color,
        deposito: Number(row.deposito ?? 0),
        retiro: Number(row.retiro ?? 0),
      })),
    }
  }

  async close() {
    if (!this.db) return
    const database = this.db
    this.db = null
    this.#openPromise = null
    await database.close()
  }

  #ensureDb() {
    if (!this.db) {
      throw new Error('LedgerSQLiteStore is not open')
    }
    return this.db
  }

  async #safeAlterTable(sql) {
    try {
      await this.#ensureDb().execute(sql)
    } catch (error) {
      const message = String(error?.message ?? '').toLowerCase()
      if (message.includes('duplicate column name')) return
      throw error
    }
  }
}

function rowsFirst(rows) {
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null
}
