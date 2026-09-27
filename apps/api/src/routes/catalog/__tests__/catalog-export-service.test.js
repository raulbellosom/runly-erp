// apps/api/src/routes/catalog/__tests__/catalog-export-service.test.js
//
// Coverage for the stock-movements Excel/PDF export added alongside the
// catalog HistorialTab redesign (2026-09-27).
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import {
  buildStockMovementsExcelBuffer,
  buildStockMovementsPdfBuffer,
} from '../catalog-export-service.js'

const PRODUCT = { name: 'Camiseta Azul', sku: 'CAM-AZ-001', slug: 'camiseta-azul', stock: 42 }
const ROWS = [
  { created_at: '2026-01-15T10:00:00Z', quantity_delta: 20, reason: 'Compra', note: null, variant_option_values: null },
  { created_at: '2026-01-20T10:00:00Z', quantity_delta: -3, reason: 'Venta', note: 'POS-102', variant_option_values: null },
]

async function loadWorkbook(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.from(buffer))
  return wb
}

describe('buildStockMovementsExcelBuffer', () => {
  it('sets the workbook creator to the real company, not "Runly ERP"', async () => {
    const buffer = await buildStockMovementsExcelBuffer({
      product: PRODUCT,
      rows: ROWS,
      branding: { companyName: 'Acme Corp', primaryColor: '#123456' },
    })
    const wb = await loadWorkbook(buffer)
    assert.equal(wb.creator, 'Acme Corp')
    assert.equal(wb.company, 'Acme Corp')
  })

  it('labels positive deltas as Entrada and negative as Salida', async () => {
    const buffer = await buildStockMovementsExcelBuffer({ product: PRODUCT, rows: ROWS })
    const wb = await loadWorkbook(buffer)
    // A fresh-loaded worksheet loses the in-memory column-key map, so cells
    // are addressed by numeric index here: fecha(1) cantidad(2) tipo(3) ...
    const sheet = wb.getWorksheet('Movimientos')
    assert.equal(sheet.getRow(2).getCell(3).value, 'Entrada')
    assert.equal(sheet.getRow(3).getCell(3).value, 'Salida')
  })

  it('handles an empty movement list without throwing', async () => {
    const buffer = await buildStockMovementsExcelBuffer({ product: PRODUCT, rows: [] })
    const wb = await loadWorkbook(buffer)
    assert.ok(wb.getWorksheet('Movimientos'))
  })
})

describe('buildStockMovementsPdfBuffer', () => {
  it('produces a non-empty PDF buffer', async () => {
    const buffer = await buildStockMovementsPdfBuffer({ product: PRODUCT, rows: ROWS })
    assert.ok(Buffer.isBuffer(buffer))
    assert.ok(buffer.length > 100)
    assert.equal(buffer.subarray(0, 5).toString('latin1'), '%PDF-')
  })
})
