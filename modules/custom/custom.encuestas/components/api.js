import { buildApiHeaders } from '@runly/ui'

export async function apiRequest({ apiBaseUrl, token, companyId, path, method = 'GET', body }) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      ...buildApiHeaders(token, companyId),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.error ?? 'La operación no pudo completarse.')
  return payload
}

export const statusLabel = (status) => ({
  borrador: 'Borrador',
  publicada: 'Publicada',
  cerrada: 'Cerrada',
}[status] ?? status)

export const questionTypeLabel = (type) => ({
  texto_corto: 'Texto corto',
  texto_largo: 'Texto largo',
  opcion_unica: 'Opción única',
  opcion_multiple: 'Opción múltiple',
  si_no: 'Sí / No',
  numero: 'Número',
  calificacion: 'Calificación 1–5',
}[type] ?? type)
