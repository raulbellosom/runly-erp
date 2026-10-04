// Credential ownership remains in the ERP wrapper. Hub never imports this adapter.
export function createErpAdapters({ baseUrl, getToken, getCompanyId, fetch: fetchImpl = (...args) => globalThis.fetch(...args), resolveResource } = {}) {
  const origin = new URL(baseUrl);
  const fetch = (url, options = {}) => {
    const target = new URL(url, baseUrl);
    if (target.origin !== origin.origin || !target.pathname.startsWith(origin.pathname.replace(/\/$/, '') + '/')) throw new Error('ERP_TRANSPORT_TARGET_MISMATCH');
    const headers = new Headers(options.headers);
    const token = getToken?.(), companyId = getCompanyId?.();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (companyId) headers.set('X-Runly-Company-Id', companyId);
    return fetchImpl(target.href, { ...options, headers });
  };
  const preference = async (key, method, body) => {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/profile/me/table-preferences/${encodeURIComponent(key)}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(`ERP_PREFERENCES_${response.status}`);
    return response.status === 204 ? null : (await response.json()).data;
  };
  return { transport: { fetch }, preferences: { get: (key) => preference(key, 'GET'), set: (key, value) => preference(key, 'PUT', value), remove: (key) => preference(key, 'DELETE') }, resources: { resolve: resolveResource ?? (() => { throw new Error('ERP_RESOURCE_ADAPTER_REQUIRED'); }) } };
}
