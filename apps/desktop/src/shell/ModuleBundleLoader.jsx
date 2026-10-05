import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { componentRegistry } from '../lib/moduleComponentRegistry'
import { runly } from '../lib/runly'
import { useAuth } from '../auth/AuthProvider'
import { getApiUrl } from '../lib/runtimeConfig.js'

// Module utilities CSS (spec 2026-10-03-rme3-module-platform-v2 §12.1): one
// <link> per id, replaced when the href changes so a republished module gets
// fresh CSS. Returns the element so a caller can remove it (previews).
import { ensureModuleStylesheet } from '@runly/preview-runtime/styles';
import { createBundleLoader } from '@runly/preview-runtime/custom-bundles';
export { ensureModuleStylesheet };

// Module-scope so remounts and StrictMode double effects share one load per
// bundle version instead of importing and registering it again. A load
// without a known version is cached for the page session: a fresh
// `?v=Date.now()` URL is a new ES module instance, whose components would
// re-register as duplicates on every remount. The digest-keyed cache and
// register() contract are shared with isolated preview hosts.
const sessionVersion = String(Date.now())
const installedBundles = createBundleLoader({
  importModule: (url) => import(/* @vite-ignore */ url),
  ensureStylesheet: ensureModuleStylesheet,
  onDiagnostic: (diagnostic) => console.error(`[ModuleBundleLoader] failed to load bundle for ${diagnostic.module}:`, diagnostic.message),
})

export function loadBundle(key, bundleVersion) {
  const version = String(bundleVersion ?? sessionVersion)
  const bundleUrl = new URL(`${getApiUrl()}/modules/${key}/bundle.js`)
  bundleUrl.searchParams.set('web_origin', window.location.origin)
  // Bust stale browser module cache entries after runtime rewriting changes.
  bundleUrl.searchParams.set('v', version)
  return installedBundles.load({
    key,
    version,
    url: bundleUrl.toString(),
    cssUrl: `${getApiUrl()}/modules/${key}/bundle.css?v=${encodeURIComponent(version)}`,
    registry: componentRegistry,
  }).then(({ key: loadedKey, loaded }) => ({ key: loadedKey, loaded }))
}

async function loadModuleBundles(blueprints) {
  const seen = new Set()
  const modulesWithBundles = []

  for (const bp of blueprints) {
    const key = bp.module?.key
    const hasBundle = bp.module?.has_bundle
    if (key && hasBundle && !seen.has(key)) {
      seen.add(key)
      const bundleVersion =
        bp.module?.bundle_hash ??
        bp.module?.bundleHash ??
        bp.module?.updated_at ??
        bp.module?.updatedAt ??
        bp.module?.version ??
        null
      modulesWithBundles.push({ key, bundleVersion })
    }
  }

  return Promise.all(
    modulesWithBundles.map(({ key, bundleVersion }) => loadBundle(key, bundleVersion))
  )
}

export function ModuleBundleLoader({ children }) {
  const { session } = useAuth()
  const token = session?.access_token ?? null
  const loadedRef = useRef(new Set())

  const { data: blueprintData } = useQuery({
    queryKey: ['blueprints', token],
    queryFn: () => runly.blueprints.list(token),
    enabled: Boolean(token),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!blueprintData?.data) return
    const toLoad = blueprintData.data.filter(
      (bp) => bp.module?.has_bundle && bp.module?.key && !loadedRef.current.has(bp.module.key)
    )
    if (!toLoad.length) return
    let cancelled = false

    ;(async () => {
      const results = await loadModuleBundles(toLoad)
      if (cancelled) return
      for (const result of results) {
        if (result?.loaded) {
          loadedRef.current.add(result.key)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [blueprintData])

  return children
}
