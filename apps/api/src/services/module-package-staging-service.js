import { randomUUID, createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { Prisma } from '@prisma/client'
import {
  loadModuleManifest,
  loadModuleModels,
  loadModuleViews,
} from './module-discovery-service.js'
import { hasActiveLock } from './module-package-lock-service.js'

const MAX_COMPRESSED_BYTES = 50 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024
const MAX_FILE_COUNT = 2_000
const MAX_COMPRESSION_RATIO = 200
// Must accept everything @runly/module-compiler's own MODULE_KEY pattern
// accepts (packages/module-compiler/src/definition.js allows underscores in
// the slug, e.g. `custom.vehicle_control`) — this used to be hyphen-only,
// so a Builder-compiled package with an underscored key passed the
// Builder's own compile-time validation and then failed here at publish
// time with a bare INVALID_MODULE_KEY. Keeping hyphens too for existing
// on-disk custom modules that may already use them.
const MODULE_KEY_PATTERN = /^custom\.[a-z][a-z0-9_-]*$/
const TABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/
const CORE_TABLE_NAMES = new Set(
  (Prisma.dmmf?.datamodel?.models ?? []).flatMap((model) => [model.name, model.dbName].filter(Boolean)),
)

export class ModulePackageStageError extends Error {
  constructor(message, { code = message, stage = 'VALIDATE', statusCode = 422, details = null } = {}) {
    super(message)
    this.name = 'ModulePackageStageError'
    this.code = code
    this.stage = stage
    this.statusCode = statusCode
    this.details = details
  }
}

function normalizeEntryName(name) {
  return String(name).replaceAll('\\', '/')
}

function validateEntryName(name) {
  if (!name || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false
  const parts = name.split('/')
  return !parts.some((part) => part === '..' || part === '.')
}

function detectRootPrefix(names) {
  if (names.includes('module.manifest.js')) return ''
  const roots = [...new Set(names.map((name) => name.split('/')[0]).filter(Boolean))]
  if (roots.length === 1 && names.includes(`${roots[0]}/module.manifest.js`)) return `${roots[0]}/`
  return null
}

async function hashDirectory(directory) {
  const files = []
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) files.push(absolute)
    }
  }
  await walk(directory)
  const hash = createHash('sha256')
  for (const file of files.sort()) {
    hash.update(`/${path.relative(directory, file).split(path.sep).join('/')}`)
    hash.update(await fs.readFile(file))
  }
  return hash.digest('hex')
}

function validateDeclarations(models) {
  const names = new Set()
  const tables = new Set()
  for (const model of models) {
    if (names.has(model.name)) throw new ModulePackageStageError('DUPLICATE_MODEL_NAME')
    names.add(model.name)
    const tableName = model.tableName ?? model.table
    if (!TABLE_NAME_PATTERN.test(tableName ?? '')) {
      throw new ModulePackageStageError('INVALID_MODEL_TABLE', { details: { tableName } })
    }
    if (tables.has(tableName)) throw new ModulePackageStageError('DUPLICATE_TABLE_NAME')
    if (CORE_TABLE_NAMES.has(tableName)) {
      throw new ModulePackageStageError('CORE_TABLE_OWNERSHIP_FORBIDDEN', { details: { tableName } })
    }
    tables.add(tableName)
  }
}

export function createModulePackageStagingService({ now = () => Date.now() } = {}) {
  async function cleanupStaleStaging(modulesDir, { maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
    const removed = []
    // Any lock directory used to be treated as "some publish might still be
    // using .staging/.backups, skip cleanup entirely" — including one
    // abandoned by a crashed process for an unrelated module key, which
    // then blocked staging/backup cleanup for every module indefinitely.
    // hasActiveLock only counts a lock that module-package-lock-service.js
    // actually classifies as live.
    if (await hasActiveLock(modulesDir)) return removed
    for (const rootName of ['.staging', '.backups']) {
      const root = path.join(modulesDir, rootName)
      let entries = []
      try { entries = await fs.readdir(root, { withFileTypes: true }) } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const target = path.join(root, entry.name)
        const stat = await fs.stat(target)
        if (now() - stat.mtimeMs < maxAgeMs) continue
        if (rootName === '.backups') {
          const moduleBackups = await fs.readdir(target, { withFileTypes: true })
          for (const moduleBackup of moduleBackups) {
            if (!moduleBackup.isDirectory()) continue
            const backupPath = path.join(target, moduleBackup.name)
            const canonicalPath = path.join(modulesDir, moduleBackup.name)
            if (!(await fs.access(canonicalPath).then(() => true, () => false))) {
              await fs.rename(backupPath, canonicalPath)
            }
          }
        }
        await fs.rm(target, { recursive: true, force: true })
        removed.push(target)
      }
    }
    return removed
  }

  async function stageZipPackage({ key, fileBuffer, modulesDir }) {
    if (!MODULE_KEY_PATTERN.test(key)) {
      throw new ModulePackageStageError('INVALID_MODULE_KEY')
    }
    if (fileBuffer.length > MAX_COMPRESSED_BYTES) {
      throw new ModulePackageStageError('ZIP_TOO_LARGE', { stage: 'UPLOAD', statusCode: 413 })
    }
    let zip
    try { zip = await JSZip.loadAsync(fileBuffer) } catch {
      throw new ModulePackageStageError('INVALID_ZIP', { stage: 'EXTRACT' })
    }
    const entries = Object.entries(zip.files)
      .filter(([, entry]) => !entry.dir)
      .map(([storedName, entry]) => {
        const rawName = entry.unsafeOriginalName ?? storedName
        return { rawName, name: normalizeEntryName(rawName), entry }
      })
    if (entries.length > MAX_FILE_COUNT) {
      throw new ModulePackageStageError('ZIP_FILE_COUNT_EXCEEDED', { statusCode: 413 })
    }
    const normalizedKeys = entries.map(({ name }) => name.toLowerCase())
    if (new Set(normalizedKeys).size !== normalizedKeys.length) {
      throw new ModulePackageStageError('DUPLICATE_ZIP_ENTRY')
    }
    for (const item of entries) {
      if (!validateEntryName(item.name)) {
        throw new ModulePackageStageError('UNSAFE_ZIP_ENTRY', { details: { entry: item.rawName } })
      }
      const mode = item.entry.unixPermissions
      if (typeof mode === 'number' && (mode & 0o170000) === 0o120000) {
        throw new ModulePackageStageError('ZIP_SYMLINK_FORBIDDEN', { details: { entry: item.rawName } })
      }
      const compressed = item.entry._data?.compressedSize ?? 0
      const uncompressed = item.entry._data?.uncompressedSize ?? 0
      if (uncompressed > 1024 * 1024 && compressed > 0 && uncompressed / compressed > MAX_COMPRESSION_RATIO) {
        throw new ModulePackageStageError('ZIP_COMPRESSION_RATIO_EXCEEDED', {
          statusCode: 413,
          details: { entry: item.rawName },
        })
      }
    }
    const prefix = detectRootPrefix(entries.map(({ name }) => name))
    if (prefix === null) throw new ModulePackageStageError('AMBIGUOUS_ZIP_STRUCTURE')
    const manifestCount = entries.filter(({ name }) => name.endsWith('/module.manifest.js') || name === 'module.manifest.js').length
    if (manifestCount !== 1) throw new ModulePackageStageError('AMBIGUOUS_MANIFEST')

    const operationId = randomUUID()
    const operationDir = path.join(modulesDir, '.staging', operationId)
    const packageDir = path.join(operationDir, 'package')
    await fs.mkdir(packageDir, { recursive: true })
    try {
      let total = 0
      for (const { name, entry } of entries) {
        const relative = prefix ? name.slice(prefix.length) : name
        if (!relative) continue
        const output = path.resolve(packageDir, ...relative.split('/'))
        if (!output.startsWith(`${path.resolve(packageDir)}${path.sep}`)) {
          throw new ModulePackageStageError('PATH_TRAVERSAL_DETECTED')
        }
        const declaredSize = entry._data?.uncompressedSize ?? 0
        total += declaredSize
        if (total > MAX_UNCOMPRESSED_BYTES) {
          throw new ModulePackageStageError('UNCOMPRESSED_SIZE_EXCEEDED', { statusCode: 413 })
        }
        const content = await entry.async('nodebuffer')
        total += declaredSize ? 0 : content.length
        if (total > MAX_UNCOMPRESSED_BYTES) {
          throw new ModulePackageStageError('UNCOMPRESSED_SIZE_EXCEEDED', { statusCode: 413 })
        }
        await fs.mkdir(path.dirname(output), { recursive: true })
        await fs.writeFile(output, content, { flag: 'wx' })
      }

      const loaded = await loadModuleManifest({
        manifestPath: path.join(packageDir, 'module.manifest.js'),
        source: 'custom',
      })
      if (loaded.status !== 'VALID' || !loaded.manifest) {
        throw new ModulePackageStageError('INVALID_MANIFEST', { details: loaded.error })
      }
      if (loaded.manifest.key !== key) {
        throw new ModulePackageStageError('MANIFEST_KEY_MISMATCH', {
          details: { expected: key, found: loaded.manifest.key },
        })
      }
      const models = await loadModuleModels({ moduleDir: packageDir, manifest: loaded.manifest })
      const views = await loadModuleViews({ moduleDir: packageDir, manifest: loaded.manifest })
      validateDeclarations(models)
      const packageHash = await hashDirectory(packageDir)
      const hasComponents = await fs.access(path.join(packageDir, 'components', 'index.js')).then(() => true, () => false)
      const hasApi = await fs.access(path.join(packageDir, 'api', 'index.js')).then(() => true, () => false)
      return {
        operationId,
        operationDir,
        packageDir,
        packageHash,
        manifest: loaded.manifest,
        models,
        views,
        inspection: {
          moduleKey: key,
          version: loaded.manifest.version,
          files: entries.length,
          models: models.length,
          views: views.length,
          hasComponents,
          hasApi,
          dependencies: loaded.manifest.dependencies ?? [],
          ownedTables: loaded.manifest.lifecycle?.ownedTables ?? [],
          packageHash,
        },
      }
    } catch (error) {
      await fs.rm(operationDir, { recursive: true, force: true }).catch(() => {})
      if (error instanceof ModulePackageStageError) throw error
      throw new ModulePackageStageError(error?.message ?? 'PACKAGE_VALIDATION_FAILED', {
        code: error?.code ?? 'PACKAGE_VALIDATION_FAILED',
        details: { cause: error?.message ?? String(error) },
      })
    }
  }

  async function cleanupStage(staged) {
    if (staged?.operationDir) await fs.rm(staged.operationDir, { recursive: true, force: true })
  }

  return { stageZipPackage, cleanupStage, cleanupStaleStaging }
}
