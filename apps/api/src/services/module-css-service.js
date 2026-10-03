// Utilities-only Tailwind CSS for a module's components/. Module bundles are
// compiled with esbuild, so classes the app itself never uses would not exist
// in the app stylesheet (spec 2026-10-03-rme3-module-platform-v2 §3.3). This
// scans the module's sources and builds just those utilities with the shared
// Runly theme (packages/ui/src/tailwind-theme.css).
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { compile, optimize } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'

const require = createRequire(import.meta.url)
const TAILWIND_BASE = path.dirname(require.resolve('tailwindcss/package.json'))
const THEME_FILE = fileURLToPath(new URL('../../../../packages/ui/src/tailwind-theme.css', import.meta.url))
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs'])

let inputCssPromise = null
function inputCss() {
  // Tokens are referenced, not re-emitted: the app stylesheet already defines
  // them, so module CSS only adds utility rules.
  inputCssPromise ??= fs.readFile(THEME_FILE, 'utf8').then((theme) => [
    '@import "tailwindcss/theme.css" theme(reference);',
    theme.replace(/@theme\s*\{/g, '@theme reference {'),
    '@import "tailwindcss/utilities.css" layer(utilities);',
  ].join('\n'))
  return inputCssPromise
}

async function collectSources(dir) {
  const out = []
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        out.push({ content: await fs.readFile(full, 'utf8'), extension: path.extname(entry.name).slice(1) })
      }
    }
  }
  await walk(dir)
  return out
}

export async function compileModuleCss(componentsDir) {
  const sources = await collectSources(componentsDir)
  if (!sources.length) return ''
  const candidates = new Scanner({ sources: [] }).scanFiles(sources)
  if (!candidates.length) return ''
  const compiler = await compile(await inputCss(), { base: TAILWIND_BASE, onDependency: () => {} })
  // optimize() (Lightning CSS) flattens nested @media rules for older WebViews
  // and minifies, the same pass the app build applies.
  return optimize(compiler.build(candidates), { minify: true }).code
}

// Same sources -> same CSS for the life of the process.
export function createModuleCssCache({ computeSourceHash }) {
  const cache = new Map()
  return async function cssFor(componentsDir) {
    const hash = await computeSourceHash(componentsDir).catch(() => null)
    const key = `${componentsDir}@${hash}`
    if (!cache.has(key)) {
      const pending = compileModuleCss(componentsDir).catch((error) => {
        cache.delete(key)
        throw error
      })
      cache.set(key, pending)
    }
    return cache.get(key)
  }
}
