// Utilities-only Tailwind CSS for a module's components/. Module bundles are
// compiled with esbuild, so classes the app itself never uses would not exist
// in the app stylesheet (spec 2026-10-03-rme3-module-platform-v2 §3.3). This
// scans the module's sources and builds just those utilities with the shared
// Runly theme (packages/ui/src/tailwind-theme.css).
//
// The result must never restyle the app: a stylesheet loaded after the app's
// re-emitting `.hidden` would beat the app's `lg:flex` (same specificity,
// later wins) and break responsive layouts. So (1) classes @runly/ui already
// uses are not emitted (the app stylesheet has them), and (2) the utilities
// are scoped to the module's own screens with
// :where([data-runly-module="<key>"]) — no extra specificity.
import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { compile, optimize } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'

const require = createRequire(import.meta.url)
const TAILWIND_BASE = path.dirname(require.resolve('tailwindcss/package.json'))
const THEME_FILE = fileURLToPath(new URL('../../../../packages/ui/src/tailwind-theme.css', import.meta.url))
const UI_SOURCE_DIR = path.dirname(THEME_FILE)
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs'])
const SCOPE_KEY_RE = /^[\w.-]+$/

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

let uiCandidates = null
function appUiCandidates() {
  uiCandidates ??= new Set(new Scanner({ sources: [{ base: UI_SOURCE_DIR, pattern: '**/*', negated: false }] }).scan())
  return uiCandidates
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

// Nests the body of the `@layer utilities { ... }` block under the module
// scope; @property rules stay top-level (they cannot be nested).
import { scopeUtilities } from '@runly/preview-runtime/css';
export { scopeUtilities };

// scope: the module key whose screens these utilities belong to. Required for
// anything loaded into the app (only tests omit it).
export async function compileModuleCss(componentsDir, { scope = null } = {}) {
  if (scope !== null && !SCOPE_KEY_RE.test(scope)) throw new Error(`Invalid module scope "${scope}"`)
  const sources = await collectSources(componentsDir)
  if (!sources.length) return ''
  const known = appUiCandidates()
  const candidates = new Scanner({ sources: [] }).scanFiles(sources).filter((candidate) => !known.has(candidate))
  if (!candidates.length) return ''
  const compiler = await compile(await inputCss(), { base: TAILWIND_BASE, onDependency: () => {} })
  const css = compiler.build(candidates)
  // optimize() (Lightning CSS) flattens the nesting and the @media rules for
  // older WebViews and minifies, the same pass the app build applies.
  return optimize(scope ? scopeUtilities(css, scope) : css, { minify: true }).code
}

// Same sources and scope -> same CSS for the life of the process.
export function createModuleCssCache({ computeSourceHash }) {
  const cache = new Map()
  return async function cssFor(componentsDir, scope) {
    const hash = await computeSourceHash(componentsDir).catch(() => null)
    const key = `${scope}:${componentsDir}@${hash}`
    if (!cache.has(key)) {
      const pending = compileModuleCss(componentsDir, { scope }).catch((error) => {
        cache.delete(key)
        throw error
      })
      cache.set(key, pending)
    }
    return cache.get(key)
  }
}
