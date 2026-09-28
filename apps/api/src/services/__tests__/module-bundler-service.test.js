import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Will be imported once service exists
let computeSourceHash

describe('module-bundler-service', () => {
  describe('computeSourceHash', () => {
    let tmpDir

    before(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-bundler-test-'))
      await fs.writeFile(path.join(tmpDir, 'index.js'), 'export function register() {}')
      await fs.writeFile(path.join(tmpDir, 'Comp.jsx'), 'export default function Comp() { return null }')
    })

    after(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true })
    })

    it('returns a 64-char hex string', async () => {
      ;({ computeSourceHash } = await import('../module-bundler-service.js'))
      const hash = await computeSourceHash(tmpDir)
      assert.match(hash, /^[0-9a-f]{64}$/)
    })

    it('returns the same hash on repeated calls', async () => {
      const h1 = await computeSourceHash(tmpDir)
      const h2 = await computeSourceHash(tmpDir)
      assert.equal(h1, h2)
    })

    it('returns a different hash when a file changes', async () => {
      const before = await computeSourceHash(tmpDir)
      await fs.writeFile(path.join(tmpDir, 'index.js'), 'export function register() { /* changed */ }')
      const after = await computeSourceHash(tmpDir)
      assert.notEqual(before, after)
    })
  })

  describe('buildModuleBundle', () => {
    let tmpModulesDir
    let tmpBundlesDir
    let mockPrisma
    let mockSupabase

    before(async () => {
      tmpModulesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-modules-'))
      tmpBundlesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-bundles-'))

      const compDir = path.join(tmpModulesDir, 'custom', 'custom.test', 'components')
      await fs.mkdir(compDir, { recursive: true })
      await fs.writeFile(
        path.join(compDir, 'index.js'),
        `export async function register(registry) {
           if (typeof window === 'undefined') return
         }`
      )

      mockPrisma = {
        runlyModule: {
          findUnique: async () => ({ bundleHash: null }),
          update: async () => ({}),
        },
      }
      mockSupabase = {
        storage: {
          listBuckets: async () => ({ data: [{ name: 'module-bundles' }] }),
          from: () => ({
            list: async () => ({ data: [{ name: 'custom.test.js' }], error: null }),
            upload: async () => ({ error: null }),
            download: async () => ({ data: null, error: new Error('not found') }),
            remove: async () => ({ error: null }),
          }),
        },
      }
    })

    after(async () => {
      await fs.rm(tmpModulesDir, { recursive: true, force: true })
      await fs.rm(tmpBundlesDir, { recursive: true, force: true })
    })

    it('esbuild smoke test: compiles a minimal JSX entry to an ESM bundle', async () => {
      const { computeSourceHash: hashFn } = await import('../module-bundler-service.js')
      const compDir = path.join(tmpModulesDir, 'custom', 'custom.test', 'components')
      const hash = await hashFn(compDir)
      assert.match(hash, /^[0-9a-f]{64}$/)

      const { build } = await import('esbuild')
      const entry = path.join(compDir, 'index.js')
      const outfile = path.join(tmpBundlesDir, 'custom.test.js')
      await build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        jsx: 'automatic',
        outfile,
        external: ['react'],
      })

      const content = await fs.readFile(outfile, 'utf8')
      assert.match(content, /register/, 'bundle should contain the register function')
      assert.ok(content.length > 100, 'bundle should have substantial content (not just empty)')
    })

    it('preserves HTTPS ESM CDN imports for the browser', async () => {
      const { build } = await import('esbuild')
      const { BUNDLE_EXTERNALS, BUNDLE_EXTERNAL_URL_PATTERNS } = await import('../module-bundler-service.js')
      const outfile = path.join(tmpBundlesDir, 'cdn-import.js')
      await build({
        stdin: {
          contents: `import confetti from 'https://esm.sh/canvas-confetti@1.9.4'; export default confetti`,
          resolveDir: tmpModulesDir,
          sourcefile: 'cdn-import.js',
        },
        bundle: true,
        format: 'esm',
        outfile,
        external: [...BUNDLE_EXTERNALS, ...BUNDLE_EXTERNAL_URL_PATTERNS],
      })

      const content = await fs.readFile(outfile, 'utf8')
      assert.match(content, /from \"https:\/\/esm\.sh\/canvas-confetti@1\.9\.4\"/)
    })

    it('builds a module bundle from RUNLY_MODULES_DIR', async () => {
      const externalRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'atlas-bundler-external-'))
      const moduleDir = path.join(externalRoot, 'custom.externalbundle', 'components')
      const previousModulesDir = process.env.RUNLY_MODULES_DIR
      await fs.mkdir(moduleDir, { recursive: true })
      await fs.writeFile(
        path.join(moduleDir, 'index.js'),
        `export async function register(registry) {
          const { default: ExternalScreen } = await import('./ExternalScreen.jsx')
          registry.register('custom.externalbundle:ExternalScreen', ExternalScreen)
        }`,
        'utf8'
      )
      await fs.writeFile(
        path.join(moduleDir, 'ExternalScreen.jsx'),
        `export default function ExternalScreen() {
          return null
        }`,
        'utf8'
      )
      process.env.RUNLY_MODULES_DIR = externalRoot

      const { createModuleBundlerService } = await import('../module-bundler-service.js')
      const svc = createModuleBundlerService({ prisma: mockPrisma, supabaseAdmin: mockSupabase })
      const result = await svc.buildModuleBundle('custom.externalbundle', { force: true })

      assert.equal(result.built, true)
      assert.match(result.hash ?? '', /^[0-9a-f]{64}$/)

      if (typeof previousModulesDir === 'string') {
        process.env.RUNLY_MODULES_DIR = previousModulesDir
      } else {
        delete process.env.RUNLY_MODULES_DIR
      }
      await fs.rm(externalRoot, { recursive: true, force: true })
      await fs.rm(path.resolve(__dirname, '../../../bundles/custom.externalbundle.js'), { force: true }).catch(() => {})
    })

    it('returns { built: false, reason: "module-not-found" } when module directory is missing', async () => {
      const { createModuleBundlerService } = await import('../module-bundler-service.js')
      const svc = createModuleBundlerService({ prisma: mockPrisma, supabaseAdmin: mockSupabase })
      const result = await svc.buildModuleBundle('custom.nonexistent')
      assert.equal(result.built, false)
      assert.equal(result.reason, 'module-not-found')
    })

    it('inspects the persisted Storage bundle and treats a missing local file as clean', async () => {
      const { createModuleBundlerService } = await import('../module-bundler-service.js')
      const svc = createModuleBundlerService({ prisma: mockPrisma, supabaseAdmin: mockSupabase })
      const result = await svc.inspectModuleBundle('custom.test')
      assert.equal(result.local.exists, false)
      assert.equal(result.storage.exists, true)
      assert.equal(result.storage.inspectable, true)
    })

    it('surfaces Storage deletion failures in strict purge mode', async () => {
      const { createModuleBundlerService } = await import('../module-bundler-service.js')
      const failingStorage = {
        storage: {
          from: () => ({ remove: async () => ({ error: new Error('storage unavailable') }) }),
        },
      }
      const svc = createModuleBundlerService({ prisma: mockPrisma, supabaseAdmin: failingStorage })
      await assert.rejects(
        svc.deleteModuleBundle('custom.test', { strict: true, updateMetadata: false }),
        /storage unavailable/,
      )
    })
  })
})

// The developer guide promises every "bundled" catalog library (motion,
// react-hook-form); a module importing one must compile even though its
// sources live outside any node_modules tree.
describe('module-bundler-service bundled catalog libraries', () => {
  it('compiles components that import each bundled library', async () => {
    const catalogPath = path.resolve(__dirname, '../../../../../packages/module-compiler/src/runtime-catalog.json')
    const { libraries } = JSON.parse(await fs.readFile(catalogPath, 'utf8'))
    const bundled = libraries.filter((lib) => lib.category === 'bundled').map((lib) => lib.name)
    assert.ok(bundled.includes('motion'))

    const moduleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runly-bundled-libs-'))
    try {
      await fs.mkdir(path.join(moduleDir, 'components'))
      const imports = { motion: "import { motion } from 'motion/react'", 'react-hook-form': "import { useForm } from 'react-hook-form'" }
      const lines = bundled.map((name) => imports[name] ?? `import * as lib from '${name}'`)
      await fs.writeFile(path.join(moduleDir, 'components', 'index.js'), `${lines.join('\n')}\nexport default {}\n`)
      const { createModuleBundlerService } = await import('../module-bundler-service.js')
      const svc = createModuleBundlerService({ prisma: null, supabaseAdmin: null })
      const result = await svc.buildBundleFromDirectory('custom.bundled', moduleDir, { outputDir: path.join(moduleDir, '.out') })
      assert.equal(result.built, true)
    } finally {
      await fs.rm(moduleDir, { recursive: true, force: true })
    }
  })
})
