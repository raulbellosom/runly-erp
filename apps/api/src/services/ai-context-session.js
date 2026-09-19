import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Opaque, short-lived context carried by the browser. No chat rows or shared
// server memory required, and a token cannot be replayed across users/scopes.
export function createAiContextSession({ secret }) {
  const key = secret ? createHash('sha256').update(`runly-context-session:${secret}`).digest() : null;
  function seal({ context, messages, recordIds = [] }) {
    if (!key) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    // Never retain text after dropping the IDs needed to reauthorize that text.
    const overflow = recordIds.length > 200;
    const data = JSON.stringify({ context, messages: overflow ? [] : messages.slice(-8), recordIds: overflow ? [] : recordIds, expires: Date.now() + 30 * 60_000 });
    const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
  function open(token, context) {
    if (!token) return { messages: [], recordIds: [] };
    try {
      if (!key || typeof token !== 'string' || token.length > 100000) throw new Error();
      const data = Buffer.from(token, 'base64url');
      if (data.toString('base64url') !== token) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      const parsed = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8'));
      if (parsed.context !== context || parsed.expires < Date.now()) throw new Error();
      return parsed;
    } catch {
      const err = new Error('El contexto de la conversación cambió o venció. Inicia una conversación nueva.'); err.status = 409; throw err;
    }
  }
  return { seal, open };
}
