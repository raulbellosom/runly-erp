// Folio formats per document kind (mirror of formatFolio in the API's
// purchases-shared.js, used here only for the live preview). The folio is
// user data; the template only fills it when the user leaves it empty.
export const NUMBERING_KINDS = [
  { kind: 'orders', label: 'Órdenes de compra', capability: 'purchaseOrders' },
  { kind: 'invoices', label: 'Facturas (cuando no se captura el folio del proveedor)', capability: 'invoices' },
  { kind: 'requests', label: 'Solicitudes', capability: 'requests' },
  { kind: 'receipts', label: 'Recepciones', capability: 'receipts' },
  { kind: 'cases', label: 'Expedientes', capability: null },
]

export const NUMBERING_TOKENS = [
  { token: '{N:6}', meaning: 'Consecutivo con 6 dígitos (000012)' },
  { token: '{N}', meaning: 'Consecutivo sin ceros (12)' },
  { token: '{AAAA}', meaning: 'Año (2026)' },
  { token: '{AA}', meaning: 'Año corto (26)' },
  { token: '{MM}', meaning: 'Mes (09)' },
]

export const hasSequenceToken = (template) => /\{N(?::\d{1,2})?\}/.test(String(template ?? ''))

export function formatFolio(template, sequence, date = new Date()) {
  const year = String(date.getFullYear())
  return String(template || '{N:6}')
    .replace(/\{N(?::(\d{1,2}))?\}/g, (_, pad) => String(sequence).padStart(Math.min(12, Number(pad) || 0), '0'))
    .replace(/\{AAAA\}/g, year)
    .replace(/\{AA\}/g, year.slice(2))
    .replace(/\{MM\}/g, String(date.getMonth() + 1).padStart(2, '0'))
}
