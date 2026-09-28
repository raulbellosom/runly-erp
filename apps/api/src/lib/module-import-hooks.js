// ESM loader hooks registered by module-import-revision.js. Node caches ES
// modules by URL for the life of the process, so re-importing a replaced
// module's api/index.js returned the old code. Module entry points are
// imported with a `?runly-rev=<revision>` query; this hook copies that query
// onto every relative import made from such a file, so the module's own
// files (services, validators, helpers) are re-evaluated as well. Bare
// specifiers (hono, zod, ...) and node_modules keep their shared cache.
const PARAM = 'runly-rev'

export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context)
  const parentURL = context.parentURL
  if (!parentURL || !parentURL.includes(`${PARAM}=`)) return result
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return result
  if (!result.url.startsWith('file:') || result.url.includes('/node_modules/')) return result

  const revision = new URL(parentURL).searchParams.get(PARAM)
  const url = new URL(result.url)
  url.searchParams.set(PARAM, revision)
  return { ...result, url: url.href }
}
