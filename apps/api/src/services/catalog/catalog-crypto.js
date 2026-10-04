// Official catalog package signatures (spec 2026-10-03-rme3-module-platform-v2
// §12.5, plan Task 6.3). A package is trusted when its bytes match the
// catalog's size + SHA-256 and an Ed25519 signature over
// `<key>@<version>:<sha256>` verifies with a trusted public key. Keys are
// base64 DER (SPKI); the private key never lives in this repository.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

export class CatalogVerificationError extends Error {
  constructor(message, code = 'package_not_authentic') {
    super(message)
    this.status = 422
    this.code = code
  }
}

export const signedPayload = ({ key, version, sha256 }) => Buffer.from(`${key}@${version}:${sha256}`, 'utf8')

export function sha256Of(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

export function signEntry({ key, version, sha256 }, privateKeyPem) {
  return sign(null, signedPayload({ key, version, sha256 }), createPrivateKey(privateKeyPem)).toString('base64')
}

function publicKeyOf(base64) {
  return createPublicKey({ key: Buffer.from(String(base64).trim(), 'base64'), format: 'der', type: 'spki' })
}

// Throws CatalogVerificationError unless the buffer is the signed package of `entry`.
export function verifyPackage({ buffer, entry, publicKeys }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new CatalogVerificationError('El paquete descargado está vacío.')
  if (entry.size && buffer.length !== Number(entry.size)) throw new CatalogVerificationError('El paquete no es auténtico: el tamaño no coincide con el catálogo.')
  const sha256 = sha256Of(buffer)
  if (sha256 !== String(entry.sha256 ?? '').toLowerCase()) throw new CatalogVerificationError('El paquete no es auténtico: su huella no coincide con el catálogo.')
  const signature = Buffer.from(String(entry.signature ?? ''), 'base64')
  const payload = signedPayload({ key: entry.key, version: entry.version, sha256 })
  const trusted = (publicKeys ?? []).some((key) => {
    try { return verify(null, payload, publicKeyOf(key), signature) } catch { return false }
  })
  if (!trusted) throw new CatalogVerificationError('El paquete no es auténtico: la firma no es del catálogo oficial.')
  return { sha256 }
}
