import crypto from 'node:crypto'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2h

export class ImportTokenError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImportTokenError'
    this.status = 403
  }
}

function getSecret(env) {
  const secret = env.LEDGER_IMPORT_SIGNING_SECRET || env.GROQ_API_KEY
  if (!secret) throw new ImportTokenError('Importacion con IA no configurada.')
  return secret
}

// Signs {companyId, actorId, rowsHash} — rowsHash is a hash of the recognized
// rows + detected account, NOT the rows themselves, so the token stays small
// even for a statement with hundreds of movements.
export function signImportProof(payload, env = process.env, { nowMs = Date.now() } = {}) {
  const secret = getSecret(env)
  const body = { ...payload, iat: nowMs }
  const json = JSON.stringify(body)
  const b64 = Buffer.from(json).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export function verifyImportProof(token, env = process.env) {
  const secret = getSecret(env)
  const [b64, sig] = String(token ?? '').split('.')
  if (!b64 || !sig) throw new ImportTokenError('Token de importacion invalido.')
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new ImportTokenError('Token de importacion invalido.')
  }
  const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
  if (Date.now() - payload.iat > TOKEN_TTL_MS) throw new ImportTokenError('El token de importacion expiro, vuelve a analizar el archivo.')
  return payload
}
