const COMPANY_HEADER = 'X-Runly-Company-Id';

function scopeError(code, message) {
  return Object.assign(new Error(message), { code, status: 409 });
}

// For authenticated company API calls only. Public websites, signed storage URLs
// and resource-scoped guest capabilities use their own transports.
export function createCompanyFetch({ getBaseUrl, getCompanyId, fetchImpl = (...args) => globalThis.fetch(...args) }) {
  return async function companyFetch(input, options = {}) {
    const baseUrl = new URL(getBaseUrl(), globalThis.location?.origin);
    const url = new URL(input instanceof Request ? input.url : input, baseUrl);
    const basePath = baseUrl.pathname.replace(/\/$/, '');
    if (url.origin !== baseUrl.origin || (basePath && url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))) {
      throw scopeError('invalid_api_origin', 'La solicitud no pertenece a la API de Runly.');
    }
    const companyId = getCompanyId();
    if (!companyId) throw scopeError('company_required', 'Selecciona una empresa activa.');
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    const requestedCompany = headers.get(COMPANY_HEADER);
    if (requestedCompany && requestedCompany !== companyId) {
      throw scopeError('company_changed', 'La empresa activa cambió. Repite la operación.');
    }
    headers.set(COMPANY_HEADER, companyId);
    const response = await fetchImpl(input instanceof Request ? input : url.href, { ...options, headers });
    function assertScope() {
      if (companyId !== getCompanyId()) throw scopeError('company_changed', 'La empresa activa cambió. Repite la operación.');
    }
    assertScope();
    // Headers may arrive before the body. Recheck after consuming JSON/files as
    // well, so a slow download cannot populate the next company's screen/cache.
    function scopedResponse(target) {
      return new Proxy(target, { get(object, key) {
        const value = Reflect.get(object, key, object);
        if (key === 'clone') return () => scopedResponse(object.clone());
        if (['json', 'text', 'blob', 'arrayBuffer', 'formData'].includes(key) && typeof value === 'function') {
          return async (...args) => { const body = await value.apply(object, args); assertScope(); return body; };
        }
        return typeof value === 'function' ? value.bind(object) : value;
      } });
    }
    return scopedResponse(response);
  };
}
