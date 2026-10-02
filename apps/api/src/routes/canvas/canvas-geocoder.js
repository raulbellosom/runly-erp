// Geocoding proxy for map pages. Nominatim's policy asks for an identifying
// User-Agent, at most one request per second and caching, so every search
// goes through one queue and a 24 h in-memory cache.
const DEFAULT_GEOCODER = 'https://nominatim.openstreetmap.org'
const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/liberty'
const DAY_MS = 86_400_000
const fail = (message, status) => Object.assign(new Error(message), { status })

export function createGeocoder({ env = process.env, fetchImpl = fetch, minIntervalMs = 1000 } = {}) {
  const enabled = env.CANVAS_MAPS !== 'false'
  const base = (env.CANVAS_GEOCODER_URL || DEFAULT_GEOCODER).replace(/\/+$/, '')
  const cache = new Map()
  let queue = Promise.resolve(), lastAt = 0

  function mapConfig() {
    return { enabled, styleUrl: env.CANVAS_MAP_STYLE_URL || DEFAULT_STYLE, attribution: '© OpenStreetMap' }
  }

  async function request(q) {
    const wait = Math.max(0, lastAt + minIntervalMs - Date.now())
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
    lastAt = Date.now()
    const url = `${base}/search?${new URLSearchParams({ format: 'jsonv2', limit: '5', q })}`
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'RunlyERP/1.0', 'Accept-Language': 'es' } })
    if (!response.ok) throw fail('El servicio de mapas no respondió.', 503)
    const rows = await response.json()
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      label: row.display_name, lat: Number(row.lat), lng: Number(row.lon),
      bbox: Array.isArray(row.boundingbox) ? row.boundingbox.map(Number) : null,
    }))
  }

  async function search(input) {
    if (!enabled) throw fail('Los mapas están desactivados en esta instancia.', 503)
    const q = String(input ?? '').trim()
    if (!q || q.length > 200) throw fail('Escribe una dirección o lugar (máximo 200 caracteres).', 400)
    const key = q.toLowerCase()
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < DAY_MS) return hit.rows
    const job = queue.then(() => request(q))
    queue = job.catch(() => {})
    let rows
    try { rows = await job } catch (error) { throw error.status ? error : fail('El servicio de mapas no respondió.', 503) }
    cache.set(key, { at: Date.now(), rows })
    if (cache.size > 500) cache.delete(cache.keys().next().value)
    return rows
  }

  return { search, mapConfig }
}
