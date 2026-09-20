#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Fingerprints avoid repeating previously removed deployment names in this policy.
const privateDomains = new Set([
  '7698bb0b45555209f94cba1d2edf04c151ffc954f765ed65f999237d76f7f517',
  'c3c4eaad5a54854cd33ae7b43e935948a1b1f6bb2d46cf19737fe7404257375f',
  'a0417ebdf4d646fd1c239d30365586d337f7bd9add5e508fffc2b291b37bb449',
])
const brandingFiles = new Set([
  'packages/ui/src/components/BrandFooter.jsx',
  'packages/ui/src/components/ModuleSidebar.jsx',
])
const hash = (value) => createHash('sha256').update(value).digest('hex')
const reservedHost = (host) => /(?:^|\.)(?:example\.(?:com|net|org)|example|test|invalid|localhost)$/.test(host)

export function inspectFile(file, content) {
  const findings = []
  const add = (line, rule) => findings.push({ file, line, rule })
  if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !/\.example$/.test(file)) add(1, 'private-env-file')
  if (/(?:^|\/)(?:\.mcp\.json|google-services\.json|[^/]*firebase-adminsdk[^/]*\.json)$|\.(?:pem|key|p12|pfx|jks|keystore|dump|backup)$|(?:^|\/)(?:\.secrets|\.codebase-memory|docs\/private)\//i.test(file)) add(1, 'private-artifact')
  if (content.includes('\0')) return findings
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const number = index + 1
    // SVG path data can look like IPv4; it is geometry, not an address.
    const addressText = line.replace(/\bd=["'][^"']*["']/g, '')
    for (const match of addressText.matchAll(/(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])/g)) {
      const ip = match[0], octets = ip.split('.').map(Number)
      if (octets.some((n) => n > 255)) continue
      if (/^(?:127\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(ip) || ip === '0.0.0.0' || ip === '10.0.2.2') continue
      // This test specifically verifies rejection of public IPs and acceptance of LAN hosts.
      if (file === 'apps/desktop/src/native/__tests__/native-host.test.js' && ['8.8.' + '8.8', '192.168.' + '1.5'].includes(ip)) continue
      add(number, 'non-example-ipv4')
    }
    for (const match of line.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi)) {
      const host = match[0].toLowerCase()
      if (reservedHost(host)) continue
      const parts = host.split('.')
      const isPrivate = parts.some((_, i) => privateDomains.has(hash(parts.slice(i).join('.'))))
      const brandLink = brandingFiles.has(file) && privateDomains.has(hash(host)) && line.includes(`href="https://${host}"`)
      if (isPrivate && !brandLink) add(number, 'private-deployment-domain')
      if (host.split('.').length > 2 && /^(?:supabase|studio|db|office|erp|atlas|rtc)\./.test(host) && /\.(?:com|net|org|mx|co)$/.test(host)
        && !['supabase.com', 'db.prisma.io'].includes(host)
        && !/\.(?:tudominio|midominio|yourdomain)\./.test(host)) add(number, 'infrastructure-domain')
      if (host.endsWith('.supabase.co') && host !== 'your-project.supabase.co') add(number, 'supabase-project-domain')
    }
    if (/\b[A-Z0-9._%+-]+@(?:gmail|hotmail|outlook|yahoo)\.[A-Z.]+\b/i.test(line)) add(number, 'personal-email')
    if (/[A-Za-z]:[/\\]Users[/\\](?!<|Public\b|USER\b|your-user\b|example\b)[^/\\\s`]+|(?<![\w/])\/Users\/(?!<|your-user\/|example\/)[^/\s`]+/.test(line)) add(number, 'personal-workstation-path')
    if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(line)) add(number, 'private-key')
    if (/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,})\b/.test(line)) add(number, 'credential-pattern')
  }
  return findings
}

export function checkRepository({ cwd = process.cwd(), staged = false, secrets = false } = {}) {
  const git = (args, options = {}) => execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, ...options })
  const args = staged ? ['ls-files', '-z'] : ['ls-files', '-z', '--cached', '--others', '--exclude-standard']
  const files = [...new Set(git(args).toString('utf8').split('\0').filter(Boolean))]
  const findings = [], snapshot = secrets ? mkdtempSync(join(tmpdir(), 'runly-privacy-')) : null
  try {
    for (const file of files) {
      let data
      if (staged) data = git(['show', `:${file}`])
      else {
        try { data = readFileSync(join(cwd, file)) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
      }
      findings.push(...inspectFile(file, data.toString('utf8')))
      if (snapshot) {
        const target = join(snapshot, file)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, data)
      }
    }
    // Never print the matched value or source line; CI logs are public too.
    for (const { file, line, rule } of findings) console.error(`${file}:${line}: ${rule} (valor oculto)`)
    let failed = findings.length > 0
    if (snapshot) {
      const result = spawnSync('gitleaks', ['dir', snapshot, '--redact', '--no-banner', '--config', join(cwd, '.gitleaks.toml')], { cwd, stdio: 'inherit' })
      if (result.error) console.error('Instala Gitleaks y añádelo a PATH para ejecutar --secrets.')
      failed ||= result.status !== 0
    }
    console.log(`Privacidad: ${files.length} archivos revisados; ${findings.length} hallazgos de política.`)
    return failed ? 1 : 0
  } finally {
    if (snapshot) rmSync(snapshot, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = checkRepository({ staged: process.argv.includes('--staged'), secrets: process.argv.includes('--secrets') })
}
