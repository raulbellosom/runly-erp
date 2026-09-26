// apps/api/src/routes/ledger/__tests__/export-service.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { buildPdfBuffer, buildExcelBuffer } from '../export-service.js'

const ACCOUNT = { name: 'Prueba', currency: 'MXN', account_number: '8104', bank: 'Scotiabank' }

describe('export-service — buildPdfBuffer', () => {
  it('wraps a very long "concepto" cell without throwing, across a multi-page export', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      consecutive: i + 1,
      fecha: '2026-03-25',
      tipo_code: 'EGR',
      numero: String(400 + i),
      nombre: i === 5 ? 'REFACCIONES Y SERVICIOS BARRERA SA DE CV' : `Proveedor ${i}`,
      referencia: '',
      concepto: i === 5
        ? 'MEX ISR RETENCIONES POR SALARIO FEBRERO 2026 MEX IMPUESTO ESTATAL FEBRERO 2026 texto largo de prueba para el wrap'
        : 'Concepto normal',
      deposito: i % 7 === 0 ? 1000 + i : null,
      retiro: i % 7 !== 0 ? 500 + i : null,
      saldo_actual: 10000 - i * 10,
    }))

    const buffer = await buildPdfBuffer({ account: ACCOUNT, rows, dateFrom: '2026-01-01', dateTo: '2026-03-31' })
    assert.ok(Buffer.isBuffer(buffer))
    assert.ok(buffer.length > 0)
    assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-')
  })

  it('produces a PDF for an account with no account_number without throwing', async () => {
    const account = { ...ACCOUNT, account_number: null }
    const buffer = await buildPdfBuffer({ account, rows: [], dateFrom: null, dateTo: null })
    assert.ok(Buffer.isBuffer(buffer))
    assert.ok(buffer.length > 0)
  })
})

describe('export-service — buildExcelBuffer', () => {
  it('includes the account number in the Resumen sheet', async () => {
    const rows = [
      { consecutive: 1, fecha: '2026-03-25', tipo_code: 'EGR', numero: '0407', nombre: 'BBVA', deposito: null, retiro: 1988, saldo_actual: -107842.79, category_name: 'Impuestos' },
    ]
    const buffer = await buildExcelBuffer({ account: ACCOUNT, rows, dateFrom: '2026-01-01', dateTo: '2026-03-31' })

    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(buffer)
    const summary = workbook.getWorksheet('Resumen')
    const rowsAsArrays = []
    summary.eachRow((row) => rowsAsArrays.push(row.values.slice(1)))

    const accountNumberRow = rowsAsArrays.find((r) => r[0] === 'Numero de cuenta')
    assert.ok(accountNumberRow, 'expected a "Numero de cuenta" row in the Resumen sheet')
    assert.equal(accountNumberRow[1], ACCOUNT.account_number)
  })
})
