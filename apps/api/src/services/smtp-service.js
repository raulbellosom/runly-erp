import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import nodemailer from 'nodemailer'

const ALGORITHM = 'aes-256-gcm'
const SALT = 'atlas-smtp-v1'

// Raised when a stored SMTP secret cannot be read back — almost always because
// JWT_SECRET changed since it was saved (the AES key is derived from it), so the
// GCM auth tag no longer validates. Callers should treat this as "not usable"
// and surface the re-save instruction rather than a raw Node crypto message.
export class SmtpConfigError extends Error {
  constructor(message, reason = 'smtp_error') {
    super(message)
    this.name = 'SmtpConfigError'
    this.reason = reason
  }
}

const UNDECRYPTABLE_MESSAGE =
  'No se pudo descifrar la contraseña SMTP. Es probable que JWT_SECRET haya cambiado '
  + 'desde que se guardó; vuelve a introducirla y guardar en Ajustes -> SMTP.'

function safeDecryptPassword(ciphertext) {
  if (!ciphertext) return ''
  try {
    return decryptPassword(ciphertext)
  } catch {
    throw new SmtpConfigError(UNDECRYPTABLE_MESSAGE, 'undecryptable_password')
  }
}

function deriveKey() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET is not set')
  return scryptSync(secret, SALT, 32)
}

export function encryptPassword(plaintext) {
  const key = deriveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

export function decryptPassword(ciphertext) {
  const key = deriveKey()
  const buf = Buffer.from(ciphertext, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

// Keep legacy instance SMTP for identity-level messages only. Company mail never
// falls back to it: a missing company configuration must not use another sender.
export function createSmtpConfigStore({ prisma, companyId = null }) {
  const prefix = companyId ? `company:${companyId}:` : '';
  return {
    async findMany({ where }) {
      const rows = await prisma.instanceConfig.findMany({
        where: { key: { in: where.key.in.map(key => `${prefix}${key}`) } },
      });
      return rows.map(row => ({ ...row, key: row.key.slice(prefix.length) }));
    },
    async save(entries) {
      await prisma.$transaction(entries.map(({ key, value }) =>
        prisma.instanceConfig.upsert({
          where: { key: `${prefix}${key}` },
          create: { key: `${prefix}${key}`, value },
          update: { value },
        }),
      ));
    },
  };
}

// Bootstrap fallback for the platform/identity SMTP slot only — read directly
// from the environment, never encrypted/stored. Lets critical system mail
// (password reset, etc.) work before an admin has ever opened Ajustes -> SMTP.
// Self-hosted operators point these at their own mail provider in their own
// .env; nothing here implies Runly Inc relays anyone's mail. Company-scoped
// SMTP (a specific companyId) never reads this — see createSmtpConfigStore's
// "Company mail never falls back to it" comment above.
function getEnvFallbackConfig(env = process.env) {
  const host = env.SMTP_HOST
  const user = env.SMTP_USER
  if (!host || !user) return null
  return {
    host,
    port:      Number(env.SMTP_PORT ?? 587),
    user,
    pass:      env.SMTP_PASS ?? '',
    fromName:  env.SMTP_FROM_NAME ?? '',
    fromEmail: env.SMTP_FROM_EMAIL ?? user,
    tls:       env.SMTP_TLS === 'true',
  }
}

export function createSmtpService({ prisma, companyId: defaultCompanyId = null, env = process.env }) {
  async function getConfig(companyId = defaultCompanyId) {
    // Identity-level mail (password reset, etc.) is not any one company's
    // business — a recipient may belong to several companies, or to none yet.
    // SMTP_* env vars are an explicit, infra-level choice by whoever runs
    // this instance, so for this slot they win outright, before even looking
    // at the database. This also means a stale DB row saved under an old
    // JWT_SECRET (undecryptable now) can never block a working env config —
    // it simply gets skipped instead of throwing.
    if (!companyId) {
      const envConfig = getEnvFallbackConfig(env)
      if (envConfig) return envConfig
    }

    const rows = await createSmtpConfigStore({ prisma, companyId }).findMany({
      where: {
        key: {
          in: ['smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass',
               'smtp.from_name', 'smtp.from_email', 'smtp.tls'],
        },
      },
    })
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    if (!cfg['smtp.host'] || !cfg['smtp.user']) return null

    return {
      host:      cfg['smtp.host'],
      port:      Number(cfg['smtp.port'] ?? 587),
      user:      cfg['smtp.user'],
      pass:      safeDecryptPassword(cfg['smtp.pass']),
      fromName:  cfg['smtp.from_name'] ?? '',
      fromEmail: cfg['smtp.from_email'] ?? cfg['smtp.user'],
      tls:       cfg['smtp.tls'] === 'true',
    }
  }

  // `fromName` lets a caller show e.g. "Acme Inc. via Runly ERP" for a
  // company-branded transactional email — the from-EMAIL always stays the
  // SMTP-authenticated address (config.fromEmail), never the override, so
  // SPF/DKIM/DMARC alignment for that domain is never broken by branding.
  async function sendEmail({ to, subject, html, text, fromName, companyId = defaultCompanyId }) {
    const config = await getConfig(companyId)
    if (!config) throw new Error('SMTP no configurado')

    const transporter = nodemailer.createTransport({
      host:   config.host,
      port:   config.port,
      // Ports 587/25 upgrade via STARTTLS; 465 starts with TLS immediately.
      // Keep the legacy implicit-TLS choice for custom ports.
      secure: config.port === 465 || (config.tls && ![25, 587].includes(config.port)),
      requireTLS: config.tls,
      auth:   { user: config.user, pass: config.pass },
    })

    // Strip header-injection characters from a caller-supplied display name
    // (ultimately sourced from Company.name, admin-editable text).
    const safeFromName = String(fromName ?? config.fromName).replace(/[\r\n]/g, ' ').trim()

    await transporter.sendMail({
      from:    `"${safeFromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
      text,
    })
  }

  async function isConfigured(companyId = defaultCompanyId) {
    try {
      const config = await getConfig(companyId)
      return Boolean(config)
    } catch {
      // A stored-but-undecryptable password is not "configured" for the
      // purposes of every boolean caller. getStatus() exposes the real reason.
      return false
    }
  }

  // Richer variant of isConfigured() for admin/diagnostic surfaces: tells apart
  // "no SMTP saved" from "SMTP saved but the password can't be decrypted".
  async function getStatus(companyId = defaultCompanyId) {
    try {
      const config = await getConfig(companyId)
      return config
        ? { configured: true, reason: null }
        : { configured: false, reason: 'not_configured' }
    } catch (err) {
      if (err instanceof SmtpConfigError) {
        return { configured: false, reason: err.reason, message: err.message }
      }
      return { configured: false, reason: 'error', message: err?.message ?? String(err) }
    }
  }

  return { sendEmail, isConfigured, getStatus, getConfig }
}

export function createWebsiteSmtpService({ prisma, companyId = null }) {
  const configStore = createSmtpConfigStore({ prisma, companyId });
  async function getConfig() {
    const keys = [
      'website.smtp.host', 'website.smtp.port', 'website.smtp.user', 'website.smtp.pass',
      'website.smtp.from_name', 'website.smtp.from_email', 'website.smtp.tls',
      'smtp.host', 'smtp.port', 'smtp.user', 'smtp.pass',
      'smtp.from_name', 'smtp.from_email', 'smtp.tls',
    ]
    const rows = await configStore.findMany({ where: { key: { in: keys } } })
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))

    const host = cfg['website.smtp.host'] || cfg['smtp.host']
    const user = cfg['website.smtp.user'] || cfg['smtp.user']
    if (!host || !user) return null

    const useWebsite = Boolean(cfg['website.smtp.host'] && cfg['website.smtp.user'])
    const prefix = useWebsite ? 'website.smtp' : 'smtp'

    const passRaw = cfg[`${prefix}.pass`]
    return {
      host:      cfg[`${prefix}.host`],
      port:      Number(cfg[`${prefix}.port`] ?? 587),
      user:      cfg[`${prefix}.user`],
      pass:      safeDecryptPassword(passRaw),
      fromName:  cfg[`${prefix}.from_name`] ?? '',
      fromEmail: cfg[`${prefix}.from_email`] ?? cfg[`${prefix}.user`],
      tls:       cfg[`${prefix}.tls`] === 'true',
      source:    useWebsite ? 'website' : 'platform',
    }
  }

  async function sendEmail({ to, subject, html, text }) {
    const config = await getConfig()
    if (!config) throw new Error('SMTP no configurado (website ni plataforma)')

    const transporter = nodemailer.createTransport({
      host:   config.host,
      port:   config.port,
      // Match platform SMTP, including existing saved TLS settings on port 587.
      secure: config.port === 465 || (config.tls && ![25, 587].includes(config.port)),
      requireTLS: config.tls,
      auth:   { user: config.user, pass: config.pass },
    })

    await transporter.sendMail({
      from:    `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
      text,
    })
  }

  async function isConfigured() {
    try {
      const config = await getConfig()
      return Boolean(config)
    } catch {
      return false
    }
  }

  async function getStatus() {
    try {
      const config = await getConfig()
      return config
        ? { configured: true, reason: null }
        : { configured: false, reason: 'not_configured' }
    } catch (err) {
      if (err instanceof SmtpConfigError) {
        return { configured: false, reason: err.reason, message: err.message }
      }
      return { configured: false, reason: 'error', message: err?.message ?? String(err) }
    }
  }

  async function getWebsiteOnlyConfig() {
    const keys = [
      'website.smtp.host', 'website.smtp.port', 'website.smtp.user',
      'website.smtp.from_name', 'website.smtp.from_email', 'website.smtp.tls',
    ]
    const rows = await configStore.findMany({ where: { key: { in: keys } } })
    const cfg = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return {
      host:       cfg['website.smtp.host']       ?? '',
      port:       Number(cfg['website.smtp.port'] ?? 587),
      user:       cfg['website.smtp.user']       ?? '',
      from_name:  cfg['website.smtp.from_name']  ?? '',
      from_email: cfg['website.smtp.from_email'] ?? '',
      tls:        cfg['website.smtp.tls'] === 'true',
      configured: Boolean(cfg['website.smtp.host'] && cfg['website.smtp.user']),
    }
  }

  return { sendEmail, isConfigured, getStatus, getConfig, getWebsiteOnlyConfig }
}
