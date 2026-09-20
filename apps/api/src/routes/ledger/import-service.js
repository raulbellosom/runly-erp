import { parse as parseCsv } from 'csv-parse/sync'
import ExcelJS from 'exceljs'
import { LedgerServiceError } from './ledger-service.js'
import { normalizeOptionalString } from './service-helpers.js'

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

function parseIsoDate(value) {
  const s = String(value ?? '').trim()
  if (ISO_DATE_REGEX.test(s)) return s
  // Try DD/MM/YYYY
  const parts = s.split(/[\/\-]/)
  if (parts.length === 3) {
    const [a, b, c] = parts
    if (c.length === 4) {
      const iso = `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
      if (ISO_DATE_REGEX.test(iso)) return iso
    }
  }
  return null
}

function parseDecimal(value) {
  if (value == null || value === '') return null
  const s = String(value).replace(/[$,\s]/g, '').trim()
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Parse a CSV or XLSX buffer into raw rows (array of objects keyed by first-row headers).
 * @param {Buffer} buffer
 * @param {'csv'|'xlsx'} format
 * @returns {Promise<Array<Record<string, string>>>}
 */
export async function parseImportBuffer(buffer, format) {
  if (format === 'csv') {
    return parseCsv(buffer, {
      columns:           true,
      skip_empty_lines:  true,
      trim:              true,
      bom:               true,
    })
  }

  if (format === 'xlsx') {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const sheet = workbook.worksheets[0]
    if (!sheet) return []

    const headers = []
    const rows    = []
    sheet.eachRow((row, rowNum) => {
      if (rowNum === 1) {
        row.eachCell((cell) => headers.push(String(cell.value ?? '').trim()))
        return
      }
      const obj = {}
      row.eachCell((cell, colNum) => {
        const header = headers[colNum - 1]
        if (header) obj[header] = String(cell.value ?? '').trim()
      })
      rows.push(obj)
    })
    return rows
  }

  throw new LedgerServiceError('Formato no soportado. Use CSV o XLSX.', 400)
}

/**
 * Map raw rows using the user-supplied column mapping and validate each row.
 * @param {Array<Record<string, string>>} rawRows
 * @param {Record<string, string>} mapping  e.g. { fecha: 'Fecha', nombre: 'Descripcion', ... }
 * @returns {{ valid: object[], errors: { rowIndex: number, rawRow: object, errors: string[] }[] }}
 */
export function validateImportRows(rawRows, mapping) {
  const valid  = []
  const errors = []

  rawRows.forEach((rawRow, idx) => {
    const rowErrors = []

    const fecha  = parseIsoDate(mapping.fecha  ? rawRow[mapping.fecha]  : null)
    if (!fecha) rowErrors.push(`fecha: valor "${rawRow[mapping.fecha]}" no es una fecha valida (YYYY-MM-DD o DD/MM/YYYY).`)

    const nombre = normalizeOptionalString(mapping.nombre ? rawRow[mapping.nombre] : null)
    if (!nombre) rowErrors.push('nombre: es obligatorio.')

    const deposito = parseDecimal(mapping.deposito ? rawRow[mapping.deposito] : null)
    const retiro   = parseDecimal(mapping.retiro   ? rawRow[mapping.retiro]   : null)
    if (!deposito && !retiro) rowErrors.push('Se requiere deposito o retiro mayor a cero.')

    if (rowErrors.length > 0) {
      errors.push({ rowIndex: idx + 1, rawRow, errors: rowErrors })
      return
    }

    valid.push({
      fecha,
      nombre,
      deposito,
      retiro,
      numero:     normalizeOptionalString(mapping.numero     ? rawRow[mapping.numero]     : null),
      referencia: normalizeOptionalString(mapping.referencia ? rawRow[mapping.referencia] : null),
      concepto:   normalizeOptionalString(mapping.concepto   ? rawRow[mapping.concepto]   : null),
    })
  })

  return { valid, errors }
}

/**
 * Insert all valid rows via sequential INSERTs.
 * @param {{ prisma: object, companyId: string, accountId: string, rows: object[] }} opts
 * @returns {Promise<{ inserted: number }>}
 */
export async function commitImportRows({ prisma, companyId, accountId, rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return { inserted: 0 }

  // All-or-nothing: a partial failure must not leave half an import behind.
  const inserted = await prisma.$transaction(async (tx) => {
    let count = 0
    for (const row of rows) {
      await tx.$queryRaw`
        INSERT INTO ledger_transaction
          (account_id, company_id, fecha, nombre, numero, referencia, concepto,
           deposito, retiro, enabled, updated_at)
        VALUES (
          ${accountId}::uuid,
          ${companyId}::uuid,
          ${row.fecha}::date,
          ${row.nombre},
          ${row.numero      ?? null},
          ${row.referencia  ?? null},
          ${row.concepto    ?? null},
          ${row.deposito    ?? null},
          ${row.retiro      ?? null},
          true,
          NOW()
        )
        RETURNING id
      `
      count++
    }
    return count
  })

  return { inserted }
}
