// Connections between custom modules and core entities (spec
// 2026-10-03-rme3-module-platform-v2 §13).
const id = (value) => encodeURIComponent(value)

export function createConnectionsDomain({ request, withAuthHeaders, toQueryString }) {
  const send = (method, path, data, token) => request(path, {
    method,
    headers: withAuthHeaders(token),
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  return {
    // Conexiones screen of a core module (manage permission).
    list: (targetType, token) => send('GET', `/connections${toQueryString({ targetType })}`, undefined, token),
    update: (connectionId, patch, token) => send('PATCH', `/connections/${id(connectionId)}`, patch, token),
    activate: (connectionId, token) => send('PATCH', `/connections/${id(connectionId)}`, { status: 'active' }, token),
    // Sections of one core record (surface: 'detail' | 'form').
    records: (targetType, targetId, surface, token) => send('GET', `/connections/records${toQueryString({ targetType, targetId, surface })}`, undefined, token),
    recordsBatch: (targetType, targetIds, token) => send('POST', '/connections/records/batch', { targetType, targetIds }, token),
    rebuild: (body, token) => send('POST', '/connections/rebuild', body ?? {}, token),
  }
}
