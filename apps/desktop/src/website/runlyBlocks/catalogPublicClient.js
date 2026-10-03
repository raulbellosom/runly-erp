// apps/desktop/src/website/runlyBlocks/catalogPublicClient.js
//
// Minimal, dependency-free client for the public catalog endpoints
// (GET /public/catalog/*), shared by ProductsGridRenderer and
// ProductCardRenderer. These blocks render both inside the Website
// Builder's own live preview and on the actual published site, so this
// reads window.RUNLY_CONFIG (window.ATLAS_CONFIG as legacy fallback) exactly
// like the storefront IIFE does — see docs/ai-context/runly-storefront-sdk.md.
export function readAtlasConfig() {
  if (typeof window === 'undefined') return null
  return window.RUNLY_CONFIG ?? window.ATLAS_CONFIG ?? null
}

export async function fetchPublicCatalog(path, params = {}) {
  const cfg = readAtlasConfig()
  if (!cfg?.apiUrl || !cfg?.company) {
    throw new Error('config-missing')
  }
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value))
  }
  const qs = query.toString()
  const res = await fetch(`${cfg.apiUrl}/public/catalog/${path}${qs ? `?${qs}` : ''}`, {
    headers: { 'X-Runly-Company': cfg.company },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function formatCatalogPrice(amount, currency) {
  const value = Number(amount ?? 0)
  const code = currency && /^[A-Z]{3}$/i.test(currency) ? currency.toUpperCase() : 'USD'
  try {
    return value.toLocaleString('es-MX', { style: 'currency', currency: code })
  } catch {
    return value.toLocaleString('es-MX', { style: 'currency', currency: 'USD' })
  }
}
