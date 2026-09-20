import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectFile } from '../check-repository-privacy.mjs'

test('permite ejemplos reservados, loopback y emulador Android', () => {
  assert.deepEqual(inspectFile('docs/example.md', 'https://studio.supabase.example.com 192.0.2.10 203.0.113.2 127.0.0.1 10.0.2.2'), [])
  assert.deepEqual(inspectFile('.env.external.example', 'SUPABASE_SERVICE_ROLE_KEY='), [])
  assert.deepEqual(inspectFile('routes.js', 'app.get("/users/:id")'), [])
})

test('rechaza IP pública y privada, sin revelar su valor', () => {
  for (const ip of [[45, 12, 34, 56], [172, 30, 4, 5]].map((parts) => parts.join('.'))) {
    const findings = inspectFile('docs/example.md', `ssh deploy@${ip}`)
    assert.equal(findings[0].rule, 'non-example-ipv4')
    assert.equal(JSON.stringify(findings).includes(ip), false)
  }
})

test('rechaza dominios de infraestructura nuevos y datos personales', () => {
  const host = ['studio', 'customer', 'com'].join('.')
  assert.ok(inspectFile('docs/guide.md', `https://${host}`).some((f) => f.rule === 'infrastructure-domain'))
  const email = 'someone@' + 'gmail.com'
  assert.equal(inspectFile('docs/guide.md', email)[0].rule, 'personal-email')
  const path = ['C:', 'Users', 'someone', 'project'].join('/')
  assert.equal(inspectFile('docs/guide.md', path)[0].rule, 'personal-workstation-path')
})

test('rechaza archivos privados y credenciales reconocibles', () => {
  for (const file of ['.env.production', 'infra/.env.external', '.mcp.json', 'credentials.pem', 'docs/private/ops.md']) {
    assert.ok(inspectFile(file, '').length > 0)
  }
  const credential = 'gh' + 'p_' + 'A'.repeat(36)
  assert.equal(inspectFile('docs/guide.md', credential)[0].rule, 'credential-pattern')
})

test('la comprobación staged lee el índice, aunque el archivo de trabajo esté limpio', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'runly-privacy-test-'))
  const cli = fileURLToPath(new URL('../check-repository-privacy.mjs', import.meta.url))
  try {
    execFileSync('git', ['init', '-q', cwd])
    const ip = [45, 12, 34, 56].join('.')
    writeFileSync(join(cwd, 'guide.md'), `ssh deploy@${ip}`)
    execFileSync('git', ['add', 'guide.md'], { cwd })
    writeFileSync(join(cwd, 'guide.md'), 'https://example.com')
    assert.throws(() => execFileSync(process.execPath, [cli, '--staged'], { cwd, stdio: 'pipe' }), (error) => {
      assert.equal(error.status, 1)
      assert.match(error.stderr.toString(), /guide.md:1: non-example-ipv4/)
      assert.equal(error.stderr.toString().includes(ip), false)
      return true
    })
    assert.doesNotThrow(() => execFileSync(process.execPath, [cli], { cwd, stdio: 'pipe' }))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
