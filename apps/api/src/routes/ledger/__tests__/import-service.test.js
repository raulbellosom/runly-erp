// apps/api/src/routes/ledger/__tests__/import-service.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { parseImportBuffer, validateImportRows } from '../import-service.js'

describe('import-service', () => {
  it('parseImportBuffer parses a CSV buffer into row objects', async () => {
    const csv = 'Fecha,Descripcion,Cargo,Abono\n2026-01-05,Renta,1500,\n2026-01-10,Nomina,,20000\n'
    const rows = await parseImportBuffer(Buffer.from(csv, 'utf-8'), 'csv')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].Fecha, '2026-01-05')
    assert.equal(rows[0].Descripcion, 'Renta')
    assert.equal(rows[1].Abono, '20000')
  })

  it('parseImportBuffer parses an XLSX buffer into row objects', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Movimientos')
    sheet.addRow(['Fecha', 'Descripcion', 'Cargo', 'Abono'])
    sheet.addRow(['2026-01-05', 'Renta', 1500, null])
    sheet.addRow(['2026-01-10', 'Nomina', null, 20000])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const rows = await parseImportBuffer(buffer, 'xlsx')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].Fecha, '2026-01-05')
    assert.equal(rows[0].Descripcion, 'Renta')
    assert.equal(rows[1].Abono, '20000')
  })

  it('parseImportBuffer rejects an unsupported format', async () => {
    await assert.rejects(
      () => parseImportBuffer(Buffer.from('x'), 'pdf'),
      /Formato no soportado/,
    )
  })

  it('validateImportRows separates valid rows from rows with errors', () => {
    const rawRows = [
      { Fecha: '2026-01-05', Descripcion: 'Renta', Cargo: '1500', Abono: '' },
      { Fecha: 'no-es-fecha', Descripcion: 'Malo', Cargo: '', Abono: '' },
    ]
    const mapping = { fecha: 'Fecha', nombre: 'Descripcion', retiro: 'Cargo', deposito: 'Abono' }
    const { valid, errors } = validateImportRows(rawRows, mapping)
    assert.equal(valid.length, 1)
    assert.equal(valid[0].nombre, 'Renta')
    assert.equal(errors.length, 1)
    assert.equal(errors[0].rowIndex, 2)
  })
})
