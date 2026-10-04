// Desactivados: deactivated records of each module (spec 2026-10-03-records-trash-design §8).
const id = (value) => encodeURIComponent(value)

export function createTrashDomain({ request, withAuthHeaders, toQueryString }) {
  const send = (method, path, data, token) => request(path, {
    method,
    headers: withAuthHeaders(token),
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  return {
    providers: (moduleKey, token) => send('GET', `/trash/providers${toQueryString({ moduleKey })}`, undefined, token),
    items: (providerId, { search, page } = {}, token) => send('GET', `/trash/${id(providerId)}/items${toQueryString({ search, page })}`, undefined, token),
    restore: (providerId, recordId, token) => send('POST', `/trash/${id(providerId)}/items/${id(recordId)}/restore`, {}, token),
    // unlink: clear nullable references that point to the record (see dependents).
    purge: (providerId, recordId, token, { unlink = false } = {}) => send('DELETE', `/trash/${id(providerId)}/items/${id(recordId)}`, { confirmation: 'ELIMINAR', unlink }, token),
    dependents: (providerId, recordId, token) => send('GET', `/trash/${id(providerId)}/items/${id(recordId)}/dependents`, undefined, token),
    retention: (token) => send('GET', '/trash/retention', undefined, token),
    setRetention: (days, token) => send('PUT', '/trash/retention', { days }, token),
  }
}
