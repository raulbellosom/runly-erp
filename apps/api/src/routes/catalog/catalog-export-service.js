// apps/api/src/routes/catalog/catalog-export-service.js
//
// Excel/PDF export for a product's stock movement history. Mirrors the
// established pattern in apps/api/src/routes/ledger/export-service.js
// (same libraries, same branded-PDF helpers) so downloads look consistent
// across the ERP.
import ExcelJS from 'exceljs'
import { drawPdfHeader, drawPdfFooter, resolveRunlyWatermarkBuffer, toSafeText } from '../../services/pdf-branding-service.js'

function fmtDateTime(d) {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  return date.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })
}

function variantLabel(row) {
  if (!row.variant_option_values) return ''
  try {
    const values = typeof row.variant_option_values === 'string'
      ? JSON.parse(row.variant_option_values)
      : row.variant_option_values
    return Object.values(values ?? {}).join(' / ')
  } catch {
    return ''
  }
}

const EMPTY_BRANDING = {
  companyName: 'Runly ERP',
  rfc: '-',
  primaryColor: '#0F766E',
  logoBuffer: null,
  addressLines: [],
}

/**
 * @param {{ product: object, rows: object[], branding?: object }} opts
 * @returns {Promise<Buffer>}
 */
export async function buildStockMovementsExcelBuffer({ product, rows, branding = EMPTY_BRANDING }) {
  const companyName = toSafeText(branding?.companyName, 'Runly ERP')
  const workbook = new ExcelJS.Workbook()
  workbook.creator = companyName
  workbook.company = companyName
  workbook.created = new Date()

  const sheet = workbook.addWorksheet('Movimientos', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: 'Fecha',    key: 'fecha',    width: 20 },
    { header: 'Cantidad', key: 'cantidad', width: 12 },
    { header: 'Tipo',     key: 'tipo',     width: 10 },
    { header: 'Variante', key: 'variante', width: 20 },
    { header: 'Motivo',   key: 'motivo',   width: 24 },
    { header: 'Nota',     key: 'nota',     width: 40 },
  ]
  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE9E9E9' } }

  for (const row of rows) {
    const delta = Number(row.quantity_delta ?? 0)
    sheet.addRow({
      fecha:    fmtDateTime(row.created_at),
      cantidad: delta,
      tipo:     delta >= 0 ? 'Entrada' : 'Salida',
      variante: variantLabel(row),
      motivo:   row.reason ?? '',
      nota:     row.note ?? '',
    })
  }
  if (rows.length === 0) {
    sheet.addRow({ motivo: 'Sin movimientos registrados.' })
  }

  const totalIn  = rows.reduce((s, r) => s + Math.max(0, Number(r.quantity_delta ?? 0)), 0)
  const totalOut = rows.reduce((s, r) => s + Math.max(0, -Number(r.quantity_delta ?? 0)), 0)

  const summary = workbook.addWorksheet('Resumen')
  summary.addRow(['Empresa',         companyName])
  summary.addRow(['Producto',        product?.name ?? ''])
  summary.addRow(['SKU',             product?.sku ?? ''])
  summary.addRow(['Stock actual',    Number(product?.stock ?? 0)])
  summary.addRow(['Generado',        new Date().toLocaleString('es-MX')])
  summary.addRow(['Total entradas',  totalIn])
  summary.addRow(['Total salidas',   totalOut])
  summary.getColumn(1).width = 18
  summary.getColumn(2).width = 32
  summary.getRow(1).font = { bold: true }

  return workbook.xlsx.writeBuffer()
}

/**
 * @param {{ product: object, rows: object[], branding?: object }} opts
 * @returns {Promise<Buffer>}
 */
export async function buildStockMovementsPdfBuffer({ product, rows, branding = EMPTY_BRANDING }) {
  const { resolvePdfDocumentCtor } = await import('../../services/pdf-branding-service.js')
  const PDFDocument = await resolvePdfDocumentCtor()

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true })
    const chunks = []
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    let y = drawPdfHeader(doc, {
      branding,
      title: 'Historial de movimientos de inventario',
      subtitle: `${product?.name ?? ''}${product?.sku ? ` — ${product.sku}` : ''}`,
      folio: `Stock actual: ${Number(product?.stock ?? 0)}`,
    })
    doc.y = y

    const cols = [90, 60, 55, 100, 100, 145]
    const headers = ['Fecha', 'Cantidad', 'Tipo', 'Variante', 'Motivo', 'Nota']
    const startX = doc.page.margins.left
    const ROW_MIN_HEIGHT = 12
    const ROW_V_PAD = 3

    function measureRowHeight(cells, bold) {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
      let maxHeight = ROW_MIN_HEIGHT
      cells.forEach((text, i) => {
        const h = doc.heightOfString(String(text ?? ''), { width: cols[i] - 4 })
        if (h > maxHeight) maxHeight = h
      })
      return maxHeight + ROW_V_PAD
    }

    function drawRow(cells, bold = false) {
      const rowHeight = measureRowHeight(cells, bold)
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 30) {
        doc.addPage()
        y = drawPdfHeader(doc, {
          branding,
          title: 'Historial de movimientos de inventario',
          subtitle: `${product?.name ?? ''}${product?.sku ? ` — ${product.sku}` : ''}`,
          folio: `Stock actual: ${Number(product?.stock ?? 0)}`,
        })
      }
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7)
      let x = startX
      cells.forEach((text, i) => {
        doc.text(String(text ?? ''), x + 2, y, { width: cols[i] - 4 })
        x += cols[i]
      })
      y += rowHeight
    }

    drawRow(headers, true)
    const totalWidth = cols.reduce((a, b) => a + b, 0)
    doc.moveTo(startX, y).lineTo(startX + totalWidth, y).stroke()
    y += 4

    if (rows.length === 0) {
      doc.font('Helvetica').fontSize(8).fillColor('#64748B')
      doc.text('Sin movimientos registrados.', startX + 2, y, { lineBreak: false })
      doc.fillColor('#000000')
      y += 14
    }

    for (const row of rows) {
      const delta = Number(row.quantity_delta ?? 0)
      drawRow([
        fmtDateTime(row.created_at),
        delta >= 0 ? `+${delta}` : String(delta),
        delta >= 0 ? 'Entrada' : 'Salida',
        variantLabel(row),
        row.reason ?? '',
        row.note ?? '',
      ])
    }

    resolveRunlyWatermarkBuffer().then((watermarkBuffer) => {
      const range = doc.bufferedPageRange()
      for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(range.start + i)
        drawPdfFooter(doc, { branding, pageNumber: i + 1, totalPages: range.count, watermarkBuffer })
      }
      doc.end()
    }, reject)
  })
}
