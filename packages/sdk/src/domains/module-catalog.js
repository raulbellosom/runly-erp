// Official module catalog (spec 2026-10-03-rme3-module-platform-v2 §13; served
// at /module-catalog to avoid confusion with the product catalog module).
// Phase 7 adds the parallel opt-in v2 feed (official/community/managed) under
// /module-catalog/v2; the v1 methods are unchanged.
const id = (value) => encodeURIComponent(value)

export function createModuleCatalogDomain({ request, withAuthHeaders }) {
  const send = (method, path, data, token) => request(path, {
    method,
    headers: withAuthHeaders(token),
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  const v2Payload = ({ version, confirmation = '', acceptCommunity = false, grants = [], decisions } = {}) => ({ version, confirmation, acceptCommunity, grants, decisions })
  return {
    list: (token) => send('GET', '/module-catalog', undefined, token),
    install: (key, { grants = [], decisions } = {}, token) => send('POST', `/module-catalog/${id(key)}/install`, { grants, decisions }, token),
    update: (key, { grants = [], decisions } = {}, token) => send('POST', `/module-catalog/${id(key)}/update`, { grants, decisions }, token),
    listV2: (token, { key } = {}) => send('GET', `/module-catalog/v2${key ? `?key=${id(key)}` : ''}`, undefined, token),
    installV2: (key, payload, token) => send('POST', `/module-catalog/v2/${id(key)}/install`, v2Payload(payload), token),
    updateV2: (key, payload, token) => send('POST', `/module-catalog/v2/${id(key)}/update`, v2Payload(payload), token),
  }
}
