import { unsupported } from './contracts.js';

export function createRuntimeSession({ id, transport, preferences, resources } = {}) {
  if (!id || typeof transport?.fetch !== 'function') throw new TypeError('Runtime session requires id and transport.fetch');
  if (!['get', 'set', 'remove'].every((key) => typeof preferences?.[key] === 'function') || typeof resources?.resolve !== 'function') throw new TypeError('Runtime session requires preferences and resources adapters');
  const registry = new Map();
  let disposed = false;
  const requireLive = () => { if (disposed) throw unsupported('disposed-session'); };
  const fetch = async (url, options = {}) => {
    requireLive();
    const target = new URL(url, 'https://preview.invalid');
    const match = target.pathname.match(/^\/profile\/me\/table-preferences\/([^/]+)$/);
    if (match) {
      const key = decodeURIComponent(match[1]), method = options.method ?? 'GET';
      let data;
      if (method === 'GET') data = await preferences.get(key);
      else if (method === 'PUT') data = await preferences.set(key, JSON.parse(options.body));
      else if (method === 'DELETE') data = await preferences.remove(key);
      else throw unsupported(`preferences.${method}`);
      requireLive();
      return Response.json({ data: data ?? null });
    }
    const response = await transport.fetch(url, options);
    requireLive();
    return response;
  };
  return {
    id, adapters: { sessionId: id, transport: { fetch }, preferences, resources },
    registry: { register(key, component) { requireLive(); registry.set(key, component); }, resolve(key) { requireLive(); return registry.get(key) ?? null; } },
    dispose() { disposed = true; registry.clear(); transport.dispose?.(); preferences.dispose?.(); resources.dispose?.(); },
  };
}
