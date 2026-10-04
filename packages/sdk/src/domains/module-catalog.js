// Official module catalog (spec 2026-10-03-rme3-module-platform-v2 §13; served
// at /module-catalog to avoid confusion with the product catalog module).
const id = (value) => encodeURIComponent(value)

export function createModuleCatalogDomain({ request, withAuthHeaders }) {
  const send = (method, path, data, token) => request(path, {
    method,
    headers: withAuthHeaders(token),
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  return {
    list: (token) => send('GET', '/module-catalog', undefined, token),
    install: (key, { grants = [], decisions } = {}, token) => send('POST', `/module-catalog/${id(key)}/install`, { grants, decisions }, token),
    update: (key, { grants = [], decisions } = {}, token) => send('POST', `/module-catalog/${id(key)}/update`, { grants, decisions }, token),
  }
}
