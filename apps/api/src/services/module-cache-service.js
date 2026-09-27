import { del as defaultCacheDel } from '../lib/cache.js'

export const MODULE_CACHE_KEYS = Object.freeze([
  'modules:list',
  'blueprints:raw',
  'runtime:modules:raw',
  'public:modules:raw',
])

export async function invalidateModuleCaches(cacheDel = defaultCacheDel) {
  const results = []
  for (const key of MODULE_CACHE_KEYS) {
    try {
      await cacheDel(key)
      results.push({ key, invalidated: true })
    } catch (error) {
      results.push({ key, invalidated: false, error: error?.message ?? String(error) })
    }
  }
  return results
}
