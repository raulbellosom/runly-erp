import { renameSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUNLY_MOBILE_RELEASE_ASSET_NAME } from '../src/lib/appConfig.js'

export const FIXED_APK_NAME = RUNLY_MOBILE_RELEASE_ASSET_NAME

const PREFERRED_ARCH_ORDER = ['universal', 'arm64', 'armv7', 'x86_64', 'x86']
const PREFERRED_VARIANT_ORDER = ['release', 'debug']

function findApkDir(baseDir) {
  const apkRoot = path.join(
    baseDir,
    'src-tauri',
    'gen',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
  )

  if (!existsSync(apkRoot)) return null

  const archDirs = readdirSync(apkRoot).filter((name) =>
    statSync(path.join(apkRoot, name)).isDirectory(),
  )
  const orderedArchDirs = [
    ...PREFERRED_ARCH_ORDER.filter((arch) => archDirs.includes(arch)),
    ...archDirs.filter((arch) => !PREFERRED_ARCH_ORDER.includes(arch)),
  ]

  for (const arch of orderedArchDirs) {
    for (const variant of PREFERRED_VARIANT_ORDER) {
      const dir = path.join(apkRoot, arch, variant)
      if (existsSync(dir)) return dir
    }
  }

  return null
}

export function resolveApkPaths(baseDir) {
  const apkDir = findApkDir(baseDir)

  if (!apkDir) {
    return { apkDir: null, fixedApkPath: null, sourceApkPath: null }
  }

  const fixedApkPath = path.join(apkDir, FIXED_APK_NAME)

  const candidates = readdirSync(apkDir)
    .filter((name) => name.toLowerCase().endsWith('.apk'))
    .filter((name) => name !== FIXED_APK_NAME)
    .map((name) => ({
      name,
      fullPath: path.join(apkDir, name),
      mtimeMs: statSync(path.join(apkDir, name)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)

  return {
    apkDir,
    fixedApkPath,
    sourceApkPath: candidates[0]?.fullPath ?? null,
  }
}

export function renameApk(baseDir) {
  const { apkDir, fixedApkPath, sourceApkPath } = resolveApkPaths(baseDir)

  if (!apkDir) {
    throw new Error(
      `Android APK output directory not found under ${baseDir}. Run the Android build first.`,
    )
  }

  if (!sourceApkPath) {
    if (existsSync(fixedApkPath)) {
      return fixedApkPath
    }
    throw new Error(`No .apk file found in ${apkDir}`)
  }

  if (existsSync(fixedApkPath)) {
    rmSync(fixedApkPath, { force: true })
  }

  renameSync(sourceApkPath, fixedApkPath)
  return fixedApkPath
}

const currentFilePath = fileURLToPath(import.meta.url)
const currentDir = path.dirname(currentFilePath)
const desktopDir = path.resolve(currentDir, '..')

if (process.argv[1] === currentFilePath) {
  const apkPath = renameApk(desktopDir)
  console.log(`APK renamed to: ${apkPath}`)
}
