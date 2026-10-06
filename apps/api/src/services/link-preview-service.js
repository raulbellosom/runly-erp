// WhatsApp-style link previews for chat messages. Fetches the page server-side
// (same SSRF guard as inventory remote images: http(s) only, public hosts,
// manual re-validated redirects), reads at most MAX_HTML_BYTES of HTML and
// extracts Open Graph / Twitter / <title> metadata. Results (including
// misses) are cached in memory so a busy conversation never re-fetches.
import { assertPublicUrl } from './inventory-import-remote-image.js';

const MAX_HTML_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 500;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function clean(value, max) {
  if (!value) return null;
  const text = decodeEntities(String(value)).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function readAttr(tag, name) {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
}

export function parseLinkPreview(html, pageUrl) {
  const head = html.slice(0, MAX_HTML_BYTES);
  const meta = {};
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const key = (readAttr(tag, 'property') ?? readAttr(tag, 'name') ?? '').toLowerCase();
    const content = readAttr(tag, 'content');
    if (key && content != null && !(key in meta)) meta[key] = content;
  }
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  let image = meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'] ?? meta['twitter:image:src'] ?? null;
  if (image) {
    try {
      const resolved = new URL(decodeEntities(image), pageUrl);
      image = resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.toString() : null;
    } catch { image = null; }
  }
  const preview = {
    url: pageUrl,
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? titleTag, 200),
    description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta.description, 300),
    siteName: clean(meta['og:site_name'], 80) ?? new URL(pageUrl).hostname.replace(/^www\./, ''),
    image,
  };
  return preview.title || preview.description || preview.image ? preview : null;
}

async function readCapped(response) {
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    chunks.push(chunk);
    size += chunk.length;
    if (size >= MAX_HTML_BYTES) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createLinkPreviewService({ fetchImpl = fetch } = {}) {
  const cache = new Map();

  async function fetchPreview(rawUrl) {
    let url = await assertPublicUrl(rawUrl);
    let response;
    for (let hop = 0; ; hop++) {
      response = await fetchImpl(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          // Many sites (and most social networks) only serve OG tags to
          // crawlers they recognize; this UA is widely allow-listed.
          'user-agent': 'Mozilla/5.0 (compatible; RunlyLinkPreview/1.0; +facebookexternalhit/1.1)',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'es,en;q=0.8',
        },
      });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) return null;
      url = await assertPublicUrl(new URL(location, url).toString());
    }
    if (!response.ok) return null;
    const type = String(response.headers.get('content-type') ?? '').toLowerCase();
    if (!type.includes('html')) return null;
    return parseLinkPreview(await readCapped(response), url.toString());
  }

  async function getPreview(rawUrl) {
    const key = String(rawUrl);
    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
    let value = null;
    try { value = await fetchPreview(key); } catch { value = null; }
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  return { getPreview };
}
