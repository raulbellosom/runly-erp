import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

test('installer package.json exposes simple cross-platform scripts for local, external, docs, and stop flows', async () => {
  const packageJsonPath = path.resolve('infra/installer/package.json')
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'))
  const scripts = packageJson.scripts ?? {}

  assert.equal(packageJson.name, 'runlyerp-installer')
  assert.equal(packageJson.private, true)
  assert.equal(packageJson.type, 'module')
  for (const key of ['local', 'local:docs', 'external', 'external:docs', 'stop:local', 'stop:external']) {
    assert.equal(typeof scripts[`runly:${key}`], 'string')
    assert.equal(scripts[`atlas:${key}`], undefined, `legacy atlas:${key} script must not be reintroduced`)
  }

  assert.equal(scripts['runly:local'], 'node ./setup-local.mjs')
  assert.equal(scripts['runly:local:docs'], 'node ./setup-local.mjs --docs-only')
  assert.equal(scripts['runly:external'], 'node ./setup-external.mjs')
  assert.equal(scripts['runly:external:docs'], 'node ./setup-external.mjs --docs-only')
  assert.equal(scripts['runly:stop:local'], 'node ./stop-local.mjs')
  assert.equal(scripts['runly:stop:external'], 'node ./stop-external.mjs')
})

test('installer README advertises npm script shortcuts after bootstrap download', async () => {
  const readme = await fs.readFile(path.resolve('infra/installer/README.md'), 'utf8')

  assert.match(readme, /npm run runly:local/i, 'installer README must advertise npm run runly:local')
  assert.match(readme, /npm\.cmd run runly:local/i, 'installer README must show npm.cmd for PowerShell users')
  assert.match(readme, /npm run runly:external/i, 'installer README must advertise npm run runly:external')
  assert.match(readme, /npm run runly:local:docs/i, 'installer README must advertise npm run runly:local:docs')
})

test('installer quick-start docs use bootstrap scripts instead of hardcoded file lists or fixed drive paths', async () => {
  const installerReadme = await fs.readFile(path.resolve('infra/installer/README.md'), 'utf8')
  const rootReadme = await fs.readFile(path.resolve('README.md'), 'utf8')

  assert.match(installerReadme, /bootstrap-local\.ps1/i, 'installer README must expose a PowerShell bootstrap script')
  assert.match(installerReadme, /bootstrap-local\.sh/i, 'installer README must expose a shell bootstrap script')
  assert.doesNotMatch(installerReadme, /mkdir\s+C:\\atlaserp-installer/i, 'installer README must not force a fixed C: path')

  assert.match(rootReadme, /bootstrap-local\.ps1/i, 'root README must expose the PowerShell bootstrap script')
  assert.doesNotMatch(rootReadme, /mkdir\s+C:\\atlaserp-installer/i, 'root README must not force a fixed C: path')
})

test('bootstrap entry scripts download every local library imported by setup', async () => {
  const setupLocal = await fs.readFile(path.resolve('infra/installer/setup-local.mjs'), 'utf8')
  const setupExternal = await fs.readFile(path.resolve('infra/installer/setup-external.mjs'), 'utf8')
  const bootstrapLocal = await fs.readFile(path.resolve('infra/installer/bootstrap-local.sh'), 'utf8')
  const bootstrapExternal = await fs.readFile(path.resolve('infra/installer/bootstrap-external.sh'), 'utf8')

  for (const [setup, bootstrap, label] of [
    [setupLocal, bootstrapLocal, 'local'],
    [setupExternal, bootstrapExternal, 'external'],
  ]) {
    const imports = [...setup.matchAll(/from\s+["']\.\/(lib\/[^"']+)["']/g)]
      .map((match) => match[1])
    assert.ok(imports.length > 0, `${label} setup must declare its shared installer libraries`)
    for (const importedFile of imports) {
      assert.ok(
        bootstrap.includes(importedFile),
        `${label} bootstrap must download imported file ${importedFile}`
      )
    }
  }
})

test('bootstrap-local downloads docker-compose.supabase.yml and every file it mounts as a volume', async () => {
  // Regression (2026-09-22): docker-compose.supabase.yml itself, plus every
  // ./supabase/... path it bind-mounts (kong.yml, kong-entrypoint.sh, the
  // *.sql init scripts), was entirely absent from bootstrap-local.sh's file
  // list. update-local.sh kept re-downloading everything else while silently
  // leaving whatever stale copies of these already happened to be on a VPS
  // untouched — a fix to docker-compose.supabase.yml (S3_PROTOCOL_ACCESS_
  // KEY_ID/SECRET, confirmed live against a real VPS) never actually reached
  // it, and the failure mode gave no error at all, just an update that
  // silently did nothing for that file.
  const compose = await fs.readFile(path.resolve('infra/installer/supabase/docker-compose.supabase.yml'), 'utf8')
  const mounted = [...compose.matchAll(/-\s+\.\/(supabase\/[^:]+):/g)].map((m) => m[1])
  assert.ok(mounted.length > 0, 'expected docker-compose.supabase.yml to bind-mount at least one ./supabase/... file')

  const bootstrapLocalSh = await fs.readFile(path.resolve('infra/installer/bootstrap-local.sh'), 'utf8')
  const bootstrapLocalPs1 = await fs.readFile(path.resolve('infra/installer/bootstrap-local.ps1'), 'utf8')
  for (const bootstrap of [bootstrapLocalSh, bootstrapLocalPs1]) {
    assert.ok(bootstrap.includes('supabase/docker-compose.supabase.yml'), 'bootstrap-local must download supabase/docker-compose.supabase.yml itself')
    for (const mountedFile of mounted) {
      assert.ok(bootstrap.includes(mountedFile), `bootstrap-local must download ${mountedFile} (mounted by docker-compose.supabase.yml)`)
    }
  }
})

test('bootstrap scripts download the full installer file set for local and external flows', async () => {
  const bootstrapLocalPs1 = await fs.readFile(path.resolve('infra/installer/bootstrap-local.ps1'), 'utf8')
  const bootstrapLocalSh = await fs.readFile(path.resolve('infra/installer/bootstrap-local.sh'), 'utf8')
  const bootstrapExternalPs1 = await fs.readFile(path.resolve('infra/installer/bootstrap-external.ps1'), 'utf8')
  const bootstrapExternalSh = await fs.readFile(path.resolve('infra/installer/bootstrap-external.sh'), 'utf8')

  for (const content of [bootstrapLocalPs1, bootstrapLocalSh]) {
    assert.match(content, /docker-compose\.yml/i)
    assert.match(content, /package\.json/i)
    assert.match(content, /setup-local\.mjs/i)
    assert.match(content, /stop-local\.mjs/i)
  }

  for (const content of [bootstrapExternalPs1, bootstrapExternalSh]) {
    assert.match(content, /docker-compose\.yml/i)
    assert.match(content, /package\.json/i)
    assert.match(content, /setup-external\.mjs/i)
    assert.match(content, /stop-external\.mjs/i)
    assert.match(content, /\.env\.external\.example/i)
  }
})

test('every file referenced by the bootstrap scripts exists in infra/installer', async () => {
  const requiredFiles = [
    'docker-compose.yml',
    'docker-compose.linux.yml',
    'lib/devkit-installer.mjs',
    'package.json',
    'setup-local.mjs',
    'setup-local.ps1',
    'setup-local.sh',
    'stop-local.mjs',
    'stop-local.ps1',
    'stop-local.sh',
    'setup-external.mjs',
    'setup-external.sh',
    'stop-external.mjs',
    'stop-external.ps1',
    'stop-external.sh',
    '.env.external.example',
  ]

  for (const relativePath of requiredFiles) {
    await fs.access(path.resolve('infra/installer', relativePath))
  }
})
