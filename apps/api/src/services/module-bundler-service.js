import path from 'node:path'
import { createModuleComponentWatcher } from './module-component-watcher.js'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import esbuild from 'esbuild'
import { resolveModuleRoots } from './module-root-resolver.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUNDLES_DIR = path.resolve(__dirname, '..', '..', 'bundles')
const STORAGE_BUCKET = 'module-bundles'

import { BUNDLE_EXTERNALS, BUNDLE_EXTERNAL_URL_PATTERNS } from '@runly/preview-runtime/externals';
import { CUSTOM_BUNDLE_CONTRACT } from '@runly/preview-runtime/custom-bundles';
export { BUNDLE_EXTERNALS, BUNDLE_EXTERNAL_URL_PATTERNS };

const ESBUILD_EXTERNALS = [...BUNDLE_EXTERNALS, ...BUNDLE_EXTERNAL_URL_PATTERNS]

// "bundled" libraries in @runly/module-compiler's runtime-catalog.json (motion,
// react-hook-form) are inlined into the module bundle. Module sources live in
// modules/custom/* (or a staging dir) with no node_modules of their own, so
// esbuild must resolve them from the API's dependencies.
const BUNDLE_NODE_PATHS = [path.resolve(__dirname, '..', '..', 'node_modules')]

// Format/JSX/loaders come from the bundle contract shared with preview hosts.
const ESBUILD_OPTIONS = {
  bundle: true,
  format: CUSTOM_BUNDLE_CONTRACT.format,
  jsx: CUSTOM_BUNDLE_CONTRACT.jsx,
  loader: { ...CUSTOM_BUNDLE_CONTRACT.loader },
  external: ESBUILD_EXTERNALS,
  nodePaths: BUNDLE_NODE_PATHS,
}

export async function computeSourceHash(dir) {
  const entries = await collectFiles(dir)
  const hash = createHash('sha256')
  for (const filePath of entries.sort()) {
    const content = await fs.readFile(filePath)
    hash.update(filePath.replace(dir, '').split(path.sep).join('/'))
    hash.update(content)
  }
  return hash.digest('hex')
}

async function collectFiles(dir) {
  const result = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...(await collectFiles(full)))
    } else {
      result.push(full)
    }
  }
  return result
}

async function resolveModuleBaseDir(key) {
  const roots = await resolveModuleRoots({ sourceDir: __dirname })
  const candidate = path.join(roots.customModulesDir, key)
  try {
    await fs.access(candidate)
    return candidate
  } catch {
    return null
  }
}

export function createModuleBundlerService({ prisma, supabaseAdmin }) {
  async function ensureBundlesDir() {
    await fs.mkdir(BUNDLES_DIR, { recursive: true })
  }

  async function ensureStorageBucket() {
    const { data: buckets } = await supabaseAdmin.storage.listBuckets()
    if (!buckets?.find((b) => b.name === STORAGE_BUCKET)) {
      await supabaseAdmin.storage.createBucket(STORAGE_BUCKET, { public: false })
    }
  }

  async function buildBundleFromDirectory(key, moduleBaseDir, { outputDir } = {}) {
    const entryPoint = path.join(moduleBaseDir, 'components', 'index.js')
    try {
      await fs.access(entryPoint)
    } catch {
      return { built: false, reason: 'no-components', hash: null, artifactPath: null }
    }
    const hash = await computeSourceHash(path.join(moduleBaseDir, 'components'))
    const artifactDir = outputDir ?? path.join(moduleBaseDir, '.bundle')
    await fs.mkdir(artifactDir, { recursive: true })
    const artifactPath = path.join(artifactDir, `${key}.js`)
    await esbuild.build({
      ...ESBUILD_OPTIONS,
      entryPoints: [entryPoint],
      outfile: artifactPath,
      sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
    })
    return { built: true, hash, artifactPath }
  }

  async function snapshotPublishedBundle(key) {
    const bundlePath = path.join(BUNDLES_DIR, `${key}.js`)
    const content = await fs.readFile(bundlePath).catch((error) => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    const row = await prisma.runlyModule.findUnique({
      where: { key },
      select: { hasBundle: true, bundleHash: true },
    }).catch(() => null)
    return { content, hasBundle: row?.hasBundle === true, bundleHash: row?.bundleHash ?? null }
  }

  async function writePublishedBundle(key, content) {
    await ensureBundlesDir()
    const target = path.join(BUNDLES_DIR, `${key}.js`)
    const temporary = path.join(BUNDLES_DIR, `.${key}.${randomSuffix()}.tmp`)
    await fs.writeFile(temporary, content)
    await fs.rename(temporary, target).catch(async (error) => {
      await fs.rm(temporary, { force: true }).catch(() => {})
      throw error
    })
  }

  function randomSuffix() {
    return `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  }

  async function publishStagedBundle(key, stagedBundle) {
    const hasBundle = stagedBundle?.built === true
    const content = hasBundle ? await fs.readFile(stagedBundle.artifactPath) : null
    if (content) await writePublishedBundle(key, content)
    else await fs.rm(path.join(BUNDLES_DIR, `${key}.js`), { force: true })

    await ensureStorageBucket()
    const storage = supabaseAdmin.storage.from(STORAGE_BUCKET)
    if (content) {
      const { error } = await storage.upload(`${key}.js`, content, {
        contentType: 'application/javascript',
        upsert: true,
      })
      if (error) throw error
    } else {
      const { error } = await storage.remove([`${key}.js`])
      if (error) throw error
    }
    await prisma.runlyModule.update({
      where: { key },
      data: { hasBundle, bundleHash: hasBundle ? stagedBundle.hash : null },
    }).catch((error) => {
      if (error?.code !== 'P2025') throw error
    })
    return { published: true, hasBundle, hash: stagedBundle?.hash ?? null }
  }

  async function restorePublishedBundle(key, snapshot) {
    const storage = supabaseAdmin.storage.from(STORAGE_BUCKET)
    if (snapshot?.content) {
      await writePublishedBundle(key, snapshot.content)
      const { error } = await storage.upload(`${key}.js`, snapshot.content, {
        contentType: 'application/javascript',
        upsert: true,
      })
      if (error) throw error
    } else {
      await fs.rm(path.join(BUNDLES_DIR, `${key}.js`), { force: true })
      const { error } = await storage.remove([`${key}.js`])
      if (error) throw error
    }
    await prisma.runlyModule.update({
      where: { key },
      data: { hasBundle: snapshot?.hasBundle === true, bundleHash: snapshot?.bundleHash ?? null },
    }).catch((error) => {
      if (error?.code !== 'P2025') throw error
    })
    return { restored: true }
  }

  async function buildModuleBundle(key, { force = false } = {}) {
    const moduleBaseDir = await resolveModuleBaseDir(key)
    if (!moduleBaseDir) {
      return { built: false, reason: 'module-not-found' }
    }
    const componentsDir = path.join(moduleBaseDir, 'components')
    const entryPoint = path.join(componentsDir, 'index.js')

    try {
      await fs.access(entryPoint)
    } catch {
      return { built: false, reason: 'no-components' }
    }

    const newHash = await computeSourceHash(componentsDir)

    if (!force) {
      const row = await prisma.runlyModule.findUnique({
        where: { key },
        select: { bundleHash: true },
      })
      if (row?.bundleHash === newHash) {
        return { built: false, reason: 'unchanged', hash: newHash }
      }
    }

    await ensureBundlesDir()
    const outfile = path.join(BUNDLES_DIR, `${key}.js`)

    await esbuild.build({
      ...ESBUILD_OPTIONS,
      entryPoints: [entryPoint],
      outfile,
      sourcemap: process.env.NODE_ENV === 'development' ? 'inline' : false,
    })

    try {
      await ensureStorageBucket()
      const bundleContent = await fs.readFile(outfile)
      await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .upload(`${key}.js`, bundleContent, {
          contentType: 'application/javascript',
          upsert: true,
        })
    } catch (storageErr) {
      console.warn(`[bundler] Storage upload failed for ${key}:`, storageErr.message)
    }

    await prisma.runlyModule.update({
      where: { key },
      data: { hasBundle: true, bundleHash: newHash },
    })

    console.log(`[bundler] built ${key} (hash: ${newHash.slice(0, 8)})`)
    return { built: true, hash: newHash }
  }

  async function inspectModuleBundle(key) {
    const bundlePath = path.join(BUNDLES_DIR, `${key}.js`)

    let localExists = false
    try {
      await fs.access(bundlePath)
      localExists = true
    } catch {
      // Missing is a valid inventory state.
    }

    let storageExists = false
    let storageInspectable = Boolean(supabaseAdmin?.storage)
    let storageError = null
    if (storageInspectable) {
      try {
        const { data, error } = await supabaseAdmin.storage
          .from(STORAGE_BUCKET)
          .list('', { search: `${key}.js`, limit: 100 })
        if (error) throw error
        storageExists = Array.isArray(data) && data.some((entry) => entry?.name === `${key}.js`)
      } catch (error) {
        storageInspectable = false
        storageError = error?.message ?? String(error)
      }
    }

    return {
      key,
      local: { exists: localExists },
      storage: {
        bucket: STORAGE_BUCKET,
        objectKey: `${key}.js`,
        exists: storageExists,
        inspectable: storageInspectable,
        error: storageError,
      },
    }
  }

  async function deleteModuleBundle(key, { strict = false, updateMetadata = true } = {}) {
    const bundlePath = path.join(BUNDLES_DIR, `${key}.js`)
    let localDeleted = false
    let storageDeleted = false

    try {
      await fs.unlink(bundlePath)
      localDeleted = true
    } catch (error) {
      if (error?.code !== 'ENOENT' && strict) throw error
    }

    try {
      const { error } = await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([`${key}.js`])
      if (error) throw error
      storageDeleted = true
    } catch (err) {
      if (strict) throw err
      console.warn(`[bundler] Storage delete failed for ${key}:`, err.message)
    }

    if (updateMetadata) {
      try {
        await prisma.runlyModule.update({
          where: { key },
          data: { hasBundle: false, bundleHash: null },
        })
      } catch (err) {
        if (strict && err?.code !== 'P2025') throw err
        console.warn(`[bundler] DB update failed for ${key}:`, err.message)
      }
    }

    return { localDeleted, storageDeleted }
  }

  let _devWatcher = null

  async function restoreModuleBundlesOnBoot() {
    await ensureBundlesDir()

    let modules
    try {
      modules = await prisma.runlyModule.findMany({
        where: { status: 'INSTALLED', enabled: true, hasBundle: true },
        select: { key: true },
      })
    } catch (err) {
      console.warn('[bundler] restoreModuleBundlesOnBoot: DB query failed:', err.message)
      return
    }

    for (const { key } of modules) {
      const bundlePath = path.join(BUNDLES_DIR, `${key}.js`)
      try {
        await fs.access(bundlePath)
      } catch {
        try {
          const { data, error } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .download(`${key}.js`)

          if (error || !data) {
            console.warn(`[bundler] Could not restore bundle for ${key}: ${error?.message ?? 'no data'}`)
            await prisma.runlyModule.update({
              where: { key },
              data: { hasBundle: false, bundleHash: null },
            })
            continue
          }

          const buffer = Buffer.from(await data.arrayBuffer())
          await fs.writeFile(bundlePath, buffer)
          console.log(`[bundler] restored ${key} from Storage`)
        } catch (restoreErr) {
          console.warn(`[bundler] restore failed for ${key}:`, restoreErr.message)
          try {
            await prisma.runlyModule.update({ where: { key }, data: { hasBundle: false, bundleHash: null } })
          } catch {
            // ignore secondary DB failure
          }
        }
      }
    }

    // Auto-build bundles for installed modules that have components/ but has_bundle=false
    let modulesWithoutBundle
    try {
      modulesWithoutBundle = await prisma.runlyModule.findMany({
        where: { status: 'INSTALLED', enabled: true, hasBundle: false },
        select: { key: true },
      })
    } catch (err) {
      console.warn('[bundler] restoreModuleBundlesOnBoot: auto-build query failed:', err.message)
      return
    }

    for (const { key } of modulesWithoutBundle) {
      try {
        const result = await buildModuleBundle(key)
        if (result.built) {
          console.log(`[bundler] auto-built bundle for ${key} on boot`)
        }
      } catch (err) {
        console.warn(`[bundler] auto-build failed for ${key}:`, err.message)
      }
    }
  }

  function startDevWatcher() {
    if (process.env.NODE_ENV === 'production') return
    if (_devWatcher) return
    _devWatcher = true
    const debouncers = new Map()

    resolveModuleRoots({ sourceDir: __dirname }).then(async ({ customModulesDir }) => {
      const watcher = createModuleComponentWatcher({
        root: customModulesDir,
        onError: error => console.warn('[bundler:watch] watcher error:', error.message),
        onChange: key => {
          clearTimeout(debouncers.get(key))
          debouncers.set(key, setTimeout(async () => {
            try {
              const result = await buildModuleBundle(key, { force: true })
              if (result.built) console.log(`[bundler:watch] rebuilt ${key}`)
            } catch (error) {
              console.error(`[bundler:watch] rebuild failed for ${key}:`, error.message)
            } finally { debouncers.delete(key) }
          }, 200))
        },
      })
      await watcher.start()
      console.log(`[bundler] watching installed components in ${customModulesDir}`)
    }).catch(error => console.warn('[bundler:watch] startup failed:', error.message))
  }

  return {
    buildModuleBundle,
    buildBundleFromDirectory,
    snapshotPublishedBundle,
    publishStagedBundle,
    restorePublishedBundle,
    inspectModuleBundle,
    deleteModuleBundle,
    restoreModuleBundlesOnBoot,
    startDevWatcher,
  }
}
