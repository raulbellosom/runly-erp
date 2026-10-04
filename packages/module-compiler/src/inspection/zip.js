import { inflateRawSync } from 'node:zlib'
import { fail } from './limits.js'

const utf8 = new TextDecoder('utf-8', { fatal: true })
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
export function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function safePackagePath(name, directory = false) {
  const value = directory && name.endsWith('/') ? name.slice(0, -1) : name
  if (typeof name !== 'string' || !value || name.length > 512 || name !== name.normalize('NFC') ||
      /[\\:<>"|?*\x00-\x1f\x7f]/.test(name) || name.startsWith('/') ||
      value.split('/').some((p) => !p || p === '.' || p === '..' || /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) {
    fail('ZIP_UNSAFE_PATH', name, 'Ruta ZIP no canónica o insegura.')
  }
  return value
}

function extras(bytes, path) {
  let at = 0
  while (at < bytes.length) {
    if (at + 4 > bytes.length) fail('ZIP_EXTRA_INVALID', path, 'Extra field truncado.')
    const id = bytes.readUInt16LE(at), length = bytes.readUInt16LE(at + 2)
    at += 4
    if (at + length > bytes.length) fail('ZIP_EXTRA_INVALID', path, 'Extra field fuera de límites.')
    if ([1, 0x7075].includes(id)) fail('ZIP_FORMAT_UNSUPPORTED', path, 'ZIP64 y nombres alternos Unicode no están soportados.')
    at += length
  }
}

// Read original central-directory entries BEFORE any map/library can overwrite
// duplicates. Only single-disk, non-encrypted STORE/DEFLATE ZIPs are accepted.
// No extraction to disk; bounded actual inflation and CRC validation per entry.
export function readZip(bytes, limits) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new TypeError('ZIP must be bytes')
  if (bytes.byteLength > limits.zipBytes) fail('ZIP_SIZE_LIMIT', '', 'ZIP excede el límite comprimido.')
  const zip = Buffer.from(bytes) // own the inspected snapshot, including caller mutations
  const range = (at, size) => {
    if (at < 0 || at + size > zip.length) fail('ZIP_TRUNCATED', '', 'ZIP truncado o con offsets inválidos.')
  }
  let end = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) { end = i; break }
  }
  if (end < 0) fail('ZIP_EOCD_INVALID', '', 'No existe un cierre ZIP válido.')
  const count = zip.readUInt16LE(end + 10), centralSize = zip.readUInt32LE(end + 12), central = zip.readUInt32LE(end + 16)
  if (zip.readUInt16LE(end + 4) || zip.readUInt16LE(end + 6) || count !== zip.readUInt16LE(end + 8) ||
      count === 0xffff || central === 0xffffffff || centralSize === 0xffffffff) fail('ZIP_FORMAT_UNSUPPORTED', '', 'ZIP multidisco/ZIP64 no soportado.')
  if (count > limits.entries) fail('ZIP_ENTRY_LIMIT', '', 'Demasiadas entradas ZIP.')
  if (central + centralSize !== end) fail('ZIP_CENTRAL_INVALID', '', 'Directorio central inconsistente.')
  range(central, centralSize)
  const records = [], seen = new Map()
  let at = central, declared = 0
  for (let i = 0; i < count; i++) {
    range(at, 46)
    if (zip.readUInt32LE(at) !== 0x02014b50) fail('ZIP_CENTRAL_INVALID', '', 'Entrada central inválida.')
    const flags = zip.readUInt16LE(at + 8), method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16), packed = zip.readUInt32LE(at + 20), size = zip.readUInt32LE(at + 24)
    const nameSize = zip.readUInt16LE(at + 28), extraSize = zip.readUInt16LE(at + 30), commentSize = zip.readUInt16LE(at + 32)
    range(at + 46, nameSize + extraSize + commentSize)
    if (flags & ~0x080e || ![0, 8].includes(method) || zip.readUInt16LE(at + 34) ||
        [size, packed, zip.readUInt32LE(at + 42)].includes(0xffffffff)) fail('ZIP_FORMAT_UNSUPPORTED', '', 'ZIP cifrado, método o flags no soportados.')
    const rawName = zip.subarray(at + 46, at + 46 + nameSize)
    if (!(flags & 0x800) && rawName.some((b) => b > 127)) fail('ZIP_ENCODING_UNSUPPORTED', '', 'Los nombres no ASCII necesitan el flag UTF-8.')
    let name
    try { name = utf8.decode(rawName) } catch { fail('ZIP_ENCODING_INVALID', '', 'Nombre ZIP no es UTF-8 válido.') }
    const mode = zip.readUInt32LE(at + 38) >>> 16, type = mode & 0xf000
    const dir = name.endsWith('/')
    if ((zip.readUInt32LE(at + 38) & 0x10) && !dir) fail('ZIP_SPECIAL_FILE', name, 'Atributo de directorio sin ruta de directorio.')
    if (![0, 0x8000, 0x4000].includes(type) || (type === 0x4000 && !dir) || (type === 0x8000 && dir)) fail('ZIP_SPECIAL_FILE', name, 'Symlinks y archivos especiales no admitidos.')
    const path = safePackagePath(name, dir), folded = path.toLowerCase()
    if (seen.has(folded)) fail('ZIP_DUPLICATE_PATH', name, 'Colisión de rutas ZIP (incluye casefold y directorios).')
    seen.set(folded, dir)
    extras(zip.subarray(at + 46 + nameSize, at + 46 + nameSize + extraSize), name)
    if (size > limits.entryBytes || (dir && size)) fail('ZIP_ENTRY_SIZE_LIMIT', name, 'Entrada demasiado grande o directorio con datos.')
    declared += size
    if (declared > limits.expandedBytes || (size >= limits.ratioThreshold && size / Math.max(1, packed) > limits.ratio)) fail('ZIP_EXPANSION_LIMIT', name, 'ZIP excede presupuesto de expansión o ratio.')
    records.push({ path, name, rawName, flags, method, crc, packed, size, offset: zip.readUInt32LE(at + 42), dir })
    at += 46 + nameSize + extraSize + commentSize
  }
  if (at !== end) fail('ZIP_CENTRAL_INVALID', '', 'Conteo central inconsistente.')
  for (const { path } of records) {
    const parts = path.toLowerCase().split('/')
    parts.pop()
    while (parts.length) {
      if (seen.get(parts.join('/')) === false) fail('ZIP_PATH_CONFLICT', path, 'Un archivo ocupa la ruta de un directorio.')
      parts.pop()
    }
  }
  const files = new Map()
  let previousEnd = 0, actualTotal = 0
  records.sort((a, b) => a.offset - b.offset)
  for (const r of records) {
    const p = r.offset
    if (p !== previousEnd) fail('ZIP_LOCAL_INVALID', r.name, 'Entradas superpuestas, prefijos o huecos no admitidos.')
    range(p, 30)
    if (zip.readUInt32LE(p) !== 0x04034b50 || zip.readUInt16LE(p + 6) !== r.flags || zip.readUInt16LE(p + 8) !== r.method) fail('ZIP_LOCAL_INVALID', r.name, 'Header local y central no coinciden.')
    const ns = zip.readUInt16LE(p + 26), es = zip.readUInt16LE(p + 28), data = p + 30 + ns + es
    range(p + 30, ns + es + r.packed)
    if (!zip.subarray(p + 30, p + 30 + ns).equals(r.rawName)) fail('ZIP_LOCAL_INVALID', r.name, 'Nombre local distinto al central.')
    extras(zip.subarray(p + 30 + ns, data), r.name)
    const values = [r.crc, r.packed, r.size]
    for (let j = 0; j < 3; j++) {
      const v = zip.readUInt32LE(p + 14 + j * 4)
      if (v !== values[j] && (!(r.flags & 8) || v !== 0)) fail('ZIP_LOCAL_INVALID', r.name, 'Tamaños/CRC locales inconsistentes.')
    }
    let stop = data + r.packed
    if (stop > central) fail('ZIP_LOCAL_INVALID', r.name, 'Datos fuera del área local.')
    if (r.flags & 8) {
      range(stop, 12)
      if (zip.readUInt32LE(stop) === 0x08074b50) stop += 4
      range(stop, 12)
      if (values.some((v, j) => zip.readUInt32LE(stop + j * 4) !== v)) fail('ZIP_LOCAL_INVALID', r.name, 'Descriptor de datos inconsistente.')
      stop += 12
    }
    if (stop > central) fail('ZIP_LOCAL_INVALID', r.name, 'Descriptor fuera del área local.')
    const compressed = zip.subarray(data, data + r.packed)
    let output
    try {
      if (r.method === 0) output = Buffer.from(compressed)
      else {
        const inflated = inflateRawSync(compressed, { maxOutputLength: Math.min(limits.entryBytes, r.size) + 1, info: true })
        if (inflated.engine.bytesWritten !== r.packed) fail('ZIP_DEFLATE_INVALID', r.name, 'Bytes sobrantes en DEFLATE.')
        output = inflated.buffer
      }
    } catch (error) {
      if (error.diagnostic) throw error
      fail('ZIP_DEFLATE_INVALID', r.name, 'DEFLATE inválido o excede el tamaño permitido.')
    }
    if (output.length !== r.size || crc32(output) !== r.crc) fail('ZIP_INTEGRITY_INVALID', r.name, 'Tamaño real o CRC no coincide.')
    actualTotal += output.length
    if (actualTotal > limits.expandedBytes) fail('ZIP_EXPANSION_LIMIT', r.name, 'Expansión real excede el presupuesto.')
    if (!r.dir) files.set(r.path, output)
    previousEnd = stop
  }
  if (previousEnd !== central) fail('ZIP_LOCAL_INVALID', '', 'Hay datos locales sin declarar.')
  return { files, bytes: zip, expandedBytes: actualTotal, entries: count }
}
