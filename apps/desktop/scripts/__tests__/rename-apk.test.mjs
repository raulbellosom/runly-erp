import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FIXED_APK_NAME, renameApk, resolveApkPaths } from '../rename-apk.mjs'

test('renameApk renames the newest arch/variant APK to the fixed name', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'runly-apk-'))
  const debugDir = path.join(
    tempDir,
    'src-tauri',
    'gen',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'arm64',
    'debug',
  )
  mkdirSync(debugDir, { recursive: true })

  const sourceApk = path.join(debugDir, 'app-arm64-debug.apk')
  writeFileSync(sourceApk, 'apk')

  const renamedPath = renameApk(tempDir)

  assert.equal(path.basename(renamedPath), FIXED_APK_NAME)
  assert.equal(existsSync(renamedPath), true)
  assert.equal(existsSync(sourceApk), false)
})

test('resolveApkPaths prefers a release build over a debug build', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'runly-apk-variant-'))
  const apkRoot = path.join(
    tempDir,
    'src-tauri',
    'gen',
    'android',
    'app',
    'build',
    'outputs',
    'apk',
  )
  const releaseDir = path.join(apkRoot, 'universal', 'release')
  const debugDir = path.join(apkRoot, 'universal', 'debug')
  mkdirSync(releaseDir, { recursive: true })
  mkdirSync(debugDir, { recursive: true })
  writeFileSync(path.join(releaseDir, 'app-universal-release.apk'), 'apk')
  writeFileSync(path.join(debugDir, 'app-universal-debug.apk'), 'apk')

  const { apkDir } = resolveApkPaths(tempDir)

  assert.equal(apkDir, releaseDir)
})

test('resolveApkPaths returns nulls when no Android build output exists', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'runly-apk-missing-'))

  const result = resolveApkPaths(tempDir)

  assert.deepEqual(result, { apkDir: null, fixedApkPath: null, sourceApkPath: null })
})
