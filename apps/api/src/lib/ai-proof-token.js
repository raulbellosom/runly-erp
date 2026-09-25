import crypto from 'node:crypto'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2h

export class AiProofTokenError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AiProofTokenError'
    this.status = 403
  }
}

function getSecret(env) {
  // LEDGER_IMPORT_SIGNING_SECRET kept first for zero behavior change on
  // existing runly.ledger installs; AI_PROOF_SIGNING_SECRET is the new,
  // module-agnostic name for anything else that adopts this (this plan's
  // transcript analysis included).
  const secret = env.LEDGER_IMPORT_SIGNING_SECRET || env.AI_PROOF_SIGNING_SECRET || env.GROQ_API_KEY
  if (!secret) throw new AiProofTokenError('Prueba de IA no configurada.')
  return secret
}

// Signs an arbitrary payload object with HMAC + a short TTL. The payload is
// never a lock on content integrity by itself (see docs/TRANSCRIPTION_SPEC.md
// §7 for why rowsHash in the ledger's original use was never a real hash) —
// its real job is proving the caller recently paid the cost/latency of an AI
// call before being allowed to run the endpoint that writes real data.
export function signAiProof(payload, env = process.env, { nowMs = Date.now() } = {}) {
  const secret = getSecret(env)
  const body = { ...payload, iat: nowMs }
  const json = JSON.stringify(body)
  const b64 = Buffer.from(json).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export function verifyAiProof(token, env = process.env) {
  const secret = getSecret(env)
  const [b64, sig] = String(token ?? '').split('.')
  if (!b64 || !sig) throw new AiProofTokenError('Token de prueba invalido.')
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new AiProofTokenError('Token de prueba invalido.')
  }
  const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
  if (Date.now() - payload.iat > TOKEN_TTL_MS) throw new AiProofTokenError('El token de prueba expiro, vuelve a analizar primero.')
  return payload
}
