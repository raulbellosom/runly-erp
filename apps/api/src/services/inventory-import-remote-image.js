// Downloads an image referenced by URL in an inventory import row. Guards
// against SSRF: http(s) only, every hop's host must resolve to a public
// address, redirects are followed manually (max 3) and re-validated, and the
// body is capped at MAX_IMAGE_BYTES with a timeout.
import { lookup } from 'node:dns/promises';
import net from 'node:net';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 3;

export function isPrivateAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || a >= 224;
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

export async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('URL no válida'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Solo se aceptan enlaces http o https');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new Error('No se pudo resolver el dominio');
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('El enlace apunta a una dirección interna');
  return url;
}

// "a.jpg, b.jpg" / one per line -> ['a.jpg', 'b.jpg'] (http(s) only).
export function splitImageUrls(value) {
  return String(value ?? '').split(/[\s,;|]+/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s));
}

export async function fetchRemoteImage(rawUrl, { fetchImpl = fetch } = {}) {
  let url = await assertPublicUrl(rawUrl);
  let response;
  for (let hop = 0; ; hop++) {
    response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get('location');
    if (!location || hop >= MAX_REDIRECTS) throw new Error('Demasiadas redirecciones');
    url = await assertPublicUrl(new URL(location, url).toString());
  }
  if (!response.ok) throw new Error(`El servidor respondió ${response.status}`);
  const type = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!type.startsWith('image/')) throw new Error('El enlace no es una imagen');
  if (Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) throw new Error('La imagen supera 10 MB');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_IMAGE_BYTES) throw new Error('La imagen supera 10 MB');
    chunks.push(chunk);
  }
  const ext = type.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'img';
  const base = decodeURIComponent(url.pathname.split('/').pop() || '').replace(/[^\w.-]/g, '') || `imagen.${ext}`;
  return { buffer: Buffer.concat(chunks), type, name: base.includes('.') ? base : `${base}.${ext}` };
}
