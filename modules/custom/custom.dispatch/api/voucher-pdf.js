import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'

const COPY_LABELS = ['COPIA BÁSCULA — ARCHIVO', 'COPIA CHOFER', 'COPIA CARGADOR']
const VOUCHER_LABEL = { SCALE: 'Vale con báscula', VOLUME: 'Vale por volumen' }
const PAYMENT_LABEL = { CASH: 'Efectivo', DEPOSIT: 'Depósito', OTHER: 'Otro' }

function toSafeText(value, fallback = '-') {
  const normalized = String(value ?? '').trim()
  return normalized.length > 0 ? normalized : fallback
}

function compact(values = []) {
  return values.map((item) => String(item ?? '').trim()).filter(Boolean)
}

function normalizeHexColor(color, fallback) {
  const raw = String(color ?? '').trim()
  return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw.toUpperCase() : fallback
}

function formatDateTimeEs(value) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
}

// Self-contained branding lookup — see docs/2026-09-20-custom-dispatch-phase2c-pdf.md
// for why this doesn't reach into apps/api/src/services/pdf-branding-service.js.
export async function resolveVoucherBranding({ prisma, companyId }) {
  const [company, brandingConfig] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }).catch(() => null),
    prisma.brandingConfig.findUnique({ where: { companyId } }).catch(() => null),
  ])

  const streetLine = compact([
    company?.street,
    company?.extNumber ? `No. ${company.extNumber}` : '',
    company?.intNumber ? `Int. ${company.intNumber}` : '',
  ]).join(', ')
  const cityLine = compact([
    company?.colony ? `Col. ${company.colony}` : '',
    company?.city,
    company?.state,
  ]).join(', ')
  const addressLines = compact([streetLine, cityLine])

  return {
    companyName: toSafeText(company?.name, 'Runly ERP'),
    rfc: toSafeText(company?.rfc, ''),
    addressLines,
    primaryColor: normalizeHexColor(brandingConfig?.primaryColor, '#D97706'),
  }
}

function drawCopy(doc, { branding, ticket, weighings, qrImageBuffer, copyLabel }) {
  const pageWidth = doc.page.width
  const pageHeight = doc.page.height
  const MARGIN = 40
  const left = MARGIN
  const right = pageWidth - MARGIN
  const contentWidth = right - left
  const brandColor = branding.primaryColor
  const C_BORDER = '#E2E8F0'
  const C_MUTED = '#64748B'
  const C_DARK = '#0F172A'
  const C_LABEL_BG = '#F8FAFC'

  // ─── Header ───
  const HEADER_H = 76
  doc.rect(0, 0, pageWidth, HEADER_H).fill('#FFFFFF')
  doc.rect(0, 0, 6, HEADER_H).fill(brandColor)

  const BADGE = 46
  const badgeX = left + 4
  const badgeY = Math.floor((HEADER_H - BADGE) / 2)
  doc.roundedRect(badgeX, badgeY, BADGE, BADGE, 8).fill(brandColor)
  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .fillColor('#FFFFFF')
    .text(branding.companyName.slice(0, 2).toUpperCase(), badgeX, badgeY + 14, { width: BADGE, align: 'center', lineBreak: false })

  const compX = badgeX + BADGE + 14
  const compW = contentWidth * 0.45
  doc
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(brandColor)
    .text(branding.companyName, compX, 12, { width: compW, lineBreak: false, ellipsis: true })
  const meta = compact([branding.rfc ? `RFC: ${branding.rfc}` : null, ...branding.addressLines])
  if (meta.length) {
    doc.font('Helvetica').fontSize(7.5).fillColor(C_MUTED).text(meta.join('\n'), compX, 29, { width: compW, lineBreak: true })
  }

  const rBlockW = contentWidth * 0.4
  const rBlockX = right - rBlockW
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(C_DARK)
    .text(copyLabel, rBlockX, 10, { width: rBlockW, align: 'right', lineBreak: false })
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor(brandColor)
    .text(ticket.folio, rBlockX, 24, { width: rBlockW, align: 'right', lineBreak: false })
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(C_MUTED)
    .text(VOUCHER_LABEL[ticket.voucher_type] ?? ticket.voucher_type, rBlockX, 48, { width: rBlockW, align: 'right', lineBreak: false })

  doc.lineWidth(1).moveTo(0, HEADER_H).lineTo(pageWidth, HEADER_H).stroke(brandColor)

  let y = HEADER_H + 22

  // ─── QR + folio block ───
  const QR_SIZE = 108
  doc.image(qrImageBuffer, left, y, { width: QR_SIZE, height: QR_SIZE })
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor(C_MUTED)
    .text('Escanea este código en la pluma de salida.', left, y + QR_SIZE + 4, { width: QR_SIZE + 20, lineBreak: true })

  const infoX = left + QR_SIZE + 24
  const infoW = right - infoX

  function row(label, value, x, rowY, w) {
    const ROW_H = 22
    doc.rect(x, rowY, w, ROW_H).fill(C_LABEL_BG)
    doc.lineWidth(0.4).rect(x, rowY, w, ROW_H).stroke(C_BORDER)
    doc.font('Helvetica').fontSize(7).fillColor(C_MUTED).text(label, x + 6, rowY + 4, { width: w * 0.36, lineBreak: false })
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(C_DARK)
      .text(toSafeText(value), x + w * 0.38, rowY + 4, { width: w * 0.58, lineBreak: false, ellipsis: true })
    return rowY + ROW_H + 2
  }

  let infoY = y
  infoY = row('Sitio', ticket.site_name, infoX, infoY, infoW)
  infoY = row('Material', ticket.material_name, infoX, infoY, infoW)
  infoY = row('Placa', ticket.vehicle_plate, infoX, infoY, infoW)
  infoY = row('Chofer', ticket.driver_name, infoX, infoY, infoW)
  infoY = row(
    ticket.sold_to_type === 'CUSTOMER' ? 'Cliente' : 'Comprador',
    ticket.customer_name,
    infoX, infoY, infoW,
  )
  if (ticket.external_voucher_reference) {
    infoY = row('Referencia externa', ticket.external_voucher_reference, infoX, infoY, infoW)
  }

  y = Math.max(y + QR_SIZE + 22, infoY + 10)

  // ─── Measurement section ───
  doc.font('Helvetica-Bold').fontSize(9).fillColor(brandColor).text('MEDICIÓN', left, y, { lineBreak: false })
  doc.lineWidth(0.5).moveTo(left, y + 13).lineTo(right, y + 13).stroke(C_BORDER)
  y += 20

  const colW = (contentWidth - 16) / 3

  if (ticket.voucher_type === 'VOLUME') {
    y = row('Volumen vendido', ticket.sold_volume_m3 ? `${ticket.sold_volume_m3} m³` : null, left, y, contentWidth)
    const aux = weighings.find((w) => w.reading_type === 'AUXILIARY_EXIT_GROSS')
    if (aux) {
      y = row('Peso bruto observado (no es el peso del material)', `${Number(aux.weight_kg).toLocaleString('es-MX')} kg`, left, y, contentWidth)
    }
  } else {
    const tare = weighings.find((w) => w.reading_type === 'TARE')
    const gross = weighings.find((w) => w.reading_type === 'GROSS')
    if (tare || gross) {
      row('Tara', tare ? `${Number(tare.weight_kg).toLocaleString('es-MX')} kg` : 'Pendiente', left, y, colW)
      row('Bruto', gross ? `${Number(gross.weight_kg).toLocaleString('es-MX')} kg` : 'Pendiente', left + colW + 8, y, colW)
      row(
        'Neto',
        tare && gross ? `${(Number(gross.weight_kg) - Number(tare.weight_kg)).toLocaleString('es-MX')} kg` : '—',
        left + (colW + 8) * 2, y, colW,
      )
      y += 26
    } else if (ticket.weighing_exception) {
      y = row('Pesaje', 'Excepción autorizada', left, y, contentWidth)
    } else {
      y = row('Pesaje', 'Pendiente de captura', left, y, contentWidth)
    }
  }

  if (ticket.payment_method) {
    y = row('Método de pago', PAYMENT_LABEL[ticket.payment_method] ?? ticket.payment_method, left, y, colW * 1.5)
  }

  y += 14
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(C_MUTED)
    .text(`Generado: ${formatDateTimeEs(new Date())}`, left, y, { lineBreak: false })

  // ─── Footer ───
  const FOOTER_Y = pageHeight - 30
  doc.lineWidth(0.4).moveTo(MARGIN, FOOTER_Y - 6).lineTo(pageWidth - MARGIN, FOOTER_Y - 6).stroke(C_BORDER)
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor('#94A3B8')
    .text(`Generado por ${branding.companyName} · ${new Date().toLocaleDateString('es-MX')}`, MARGIN, FOOTER_Y, {
      width: contentWidth,
      lineBreak: false,
    })
  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor('#CBD5E1')
    .text('Hecho con Runly ERP', MARGIN, FOOTER_Y, { width: contentWidth, align: 'right', lineBreak: false })
}

export async function buildVoucherPdfBuffer({ branding, ticket, weighings = [], qrValue }) {
  const qrImageBuffer = await QRCode.toBuffer(qrValue, {
    type: 'png',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
    color: { dark: '#000000FF', light: '#FFFFFFFF' },
  })

  const doc = new PDFDocument({ margin: 0, size: 'LETTER', layout: 'portrait', bufferPages: true })
  const chunks = []
  const done = new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  COPY_LABELS.forEach((copyLabel, index) => {
    if (index > 0) doc.addPage({ margin: 0, size: 'LETTER', layout: 'portrait' })
    drawCopy(doc, { branding, ticket, weighings, qrImageBuffer, copyLabel })
  })

  doc.end()
  return done
}
