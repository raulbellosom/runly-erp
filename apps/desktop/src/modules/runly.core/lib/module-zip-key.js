// Module key of an uploaded ZIP. The manifest inside the ZIP is the source of
// truth; the file name is only a fallback. Builder downloads are named
// "<key>-<version>.zip" (custom.prestamos-1.0.0.zip), so the version suffix
// must be stripped — it used to end up in the key (INVALID_MODULE_KEY).

const MODULE_KEY_RE = /^(?:custom|community)\.[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*$/
const KEY_ENTRY_RE = /\bkey\s*:\s*['"`]([^'"`]+)['"`]/g

export function guessKeyFromFilename(filename) {
  const base = String(filename ?? '')
    .replace(/\.zip$/i, '')
    .replace(/\s*\(\d+\)$/, '') // "custom.x (1).zip" from repeated downloads
    .replace(/[-_ ]v?\d+\.\d+\.\d+(?:[-+][\w.]+)?$/i, '')
  const match = base.match(/^([a-z][a-z0-9]*\.[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)*)/)
  return match ? match[1] : base
}

// The module key from module.manifest.js source (read as text, never
// executed). Other `key:` entries can come first (connections, permissions,
// views), so the first value shaped like a module key wins.
export function keyFromManifestSource(source) {
  for (const match of String(source ?? '').matchAll(KEY_ENTRY_RE)) {
    if (MODULE_KEY_RE.test(match[1])) return match[1]
  }
  return null
}

export async function readModuleKeyFromZip(file) {
  try {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(file)
    // module.manifest.js at the root, or inside a single top-level folder.
    const entry = zip.file('module.manifest.js') ?? zip.file(/^[^/]+\/module\.manifest\.js$/)[0] ?? null
    return entry ? keyFromManifestSource(await entry.async('string')) : null
  } catch {
    return null
  }
}
