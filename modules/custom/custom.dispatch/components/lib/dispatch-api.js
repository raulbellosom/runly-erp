const API_BASE_URL = (() => {
  try {
    return new URL(import.meta.url).origin
  } catch {
    return ''
  }
})()

async function request(path, token, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || `Error HTTP ${response.status}`)
    error.status = response.status
    error.code = body.code
    error.details = body.details
    throw error
  }
  return response.json()
}

export async function printTicket({ token, id }) {
  const response = await fetch(`${API_BASE_URL}/dispatch/tickets/${encodeURIComponent(id)}/pdf`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error || `Error HTTP ${response.status}`)
    error.status = response.status
    error.code = body.code
    throw error
  }
  return response.blob()
}

export function getDispatchSetup(token) {
  return request('/dispatch/catalog/setup', token).then((result) => result.data)
}

export function saveCatalogRecord({ token, resource, record, data }) {
  const path = record
    ? `/dispatch/catalog/${resource}/${encodeURIComponent(record.id)}`
    : `/dispatch/catalog/${resource}`
  return request(path, token, {
    method: record ? 'PATCH' : 'POST',
    body: JSON.stringify(data),
  }).then((result) => result.data)
}

export function setCatalogRecordEnabled({ token, resource, id, enabled }) {
  return request(`/dispatch/catalog/${resource}/${encodeURIComponent(id)}/enabled`, token, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  }).then((result) => result.data)
}

export function listTickets({ token, filters = {} }) {
  const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, value]) => value)))
  const query = params.toString()
  return request(`/dispatch/tickets${query ? `?${query}` : ''}`, token).then((result) => result.data)
}

export function getTicket({ token, id }) {
  return request(`/dispatch/tickets/${encodeURIComponent(id)}`, token).then((result) => result.data)
}

export function createVolumeTicket({ token, data }) {
  return request('/dispatch/tickets/volume', token, {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((result) => result.data)
}

export function createScaleTicket({ token, data }) {
  return request('/dispatch/tickets/scale', token, {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((result) => result.data)
}

export function updateTicket({ token, id, data }) {
  return request(`/dispatch/tickets/${encodeURIComponent(id)}`, token, {
    method: 'PATCH',
    body: JSON.stringify(data),
  }).then((result) => result.data)
}

export function cancelTicket({ token, id, reason }) {
  return request(`/dispatch/tickets/${encodeURIComponent(id)}/cancel`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }).then((result) => result.data)
}

export function listWeighings({ token, ticketId }) {
  return request(`/dispatch/tickets/${encodeURIComponent(ticketId)}/weighings`, token).then((result) => result.data)
}

export function captureTare({ token, ticketId, data }) {
  return request(`/dispatch/tickets/${encodeURIComponent(ticketId)}/weighings/tare`, token, {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((result) => result.data)
}

export function captureGross({ token, ticketId, data }) {
  return request(`/dispatch/tickets/${encodeURIComponent(ticketId)}/weighings/gross`, token, {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((result) => result.data)
}

export function captureAuxiliaryExit({ token, ticketId, data }) {
  return request(`/dispatch/tickets/${encodeURIComponent(ticketId)}/weighings/auxiliary-exit`, token, {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((result) => result.data)
}

export function correctWeighing({ token, weighingId, data }) {
  return request(`/dispatch/weighings/${encodeURIComponent(weighingId)}/correct`, token, {
    method: 'POST',
    body: JSON.stringify(data),
  }).then((result) => result.data)
}

export function authorizeWeighingException({ token, ticketId, reason }) {
  return request(`/dispatch/tickets/${encodeURIComponent(ticketId)}/weighing-exception`, token, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  }).then((result) => result.data)
}

export function scanGate({ token, gateStationId, qrValue }) {
  return request('/dispatch/gate/scan', token, {
    method: 'POST',
    body: JSON.stringify({ gate_station_id: gateStationId, qr_value: qrValue }),
  })
}

export function listPendingExits({ token }) {
  return request('/dispatch/exits/pending', token).then((result) => result.data)
}

export function getExit({ token, id }) {
  return request(`/dispatch/exits/${encodeURIComponent(id)}`, token).then((result) => result.data)
}

export function approveExit({ token, id }) {
  return request(`/dispatch/exits/${encodeURIComponent(id)}/approve`, token, { method: 'POST' }).then((result) => result.data)
}

export function rejectExit({ token, id, reason }) {
  return request(`/dispatch/exits/${encodeURIComponent(id)}/reject`, token, {
    method: 'POST',
    body: JSON.stringify({ rejection_reason: reason }),
  }).then((result) => result.data)
}

export function recordGuardNotified({ token, id, communicationMethod, notes }) {
  return request(`/dispatch/exits/${encodeURIComponent(id)}/guard-notified`, token, {
    method: 'POST',
    body: JSON.stringify({ communication_method: communicationMethod, notes }),
  }).then((result) => result.data)
}
